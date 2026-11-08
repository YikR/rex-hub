import { HubError } from "../errors";
import { fetchJson } from "../http";
import type {
  AdapterContext,
  CatalogItem,
  HubAdapter,
  SubtitleEntry,
} from "./types";

/**
 * 通用 JSON 目录协议 `rex-hub/1`（由本模块定义并维护，见 docs/json-feed.md）。
 *
 * ```json
 * {
 *   "version": 1,
 *   "name": "家庭媒体库",
 *   "items": [
 *     {
 *       "id": "demo-movie",
 *       "title": "示例影片",
 *       "type": "movie",
 *       "url": "https://cdn.example.com/demo.m3u8",
 *       "poster": "https://cdn.example.com/demo.jpg",
 *       "year": "2024",
 *       "group": "电影",
 *       "subtitles": [{ "title": "简体中文", "lang": "zh", "url": "https://cdn.example.com/demo.zh.vtt" }]
 *     }
 *   ]
 * }
 * ```
 *
 * 允许 `episodes: [{ "title": "第 1 集", "url": "…" }]` 把一个剧集展开成多条。
 */
export interface FeedItem {
  id?: string;
  title: string;
  type?: "movie" | "tv";
  url: string;
  poster?: string;
  backdrop?: string;
  description?: string;
  year?: string | number;
  group?: string;
  subtitles?: SubtitleEntry[];
  episodes?: Array<{ title?: string; url: string }>;
}

export interface FeedDocument {
  version: 1;
  name?: string;
  items: FeedItem[];
}

const MAX_ITEMS = 5_000;

function asHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function asSubtitles(value: unknown): SubtitleEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const subtitles: SubtitleEntry[] = [];
  for (const candidate of value.slice(0, 50)) {
    if (candidate === null || typeof candidate !== "object") {
      continue;
    }
    const raw = candidate as Record<string, unknown>;
    const url = asHttpUrl(raw.url);
    if (!url) {
      continue;
    }
    subtitles.push({
      title: asOptionalString(raw.title) ?? "字幕",
      lang: asOptionalString(raw.lang) ?? "und",
      url,
    });
  }
  return subtitles.length > 0 ? subtitles : undefined;
}

/** 严格校验：任何一条不合法都跳过，而不是让整个来源失败。 */
export function parseFeed(payload: unknown): CatalogItem[] {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new HubError("INVALID_PAYLOAD", "目录数据必须是 JSON 对象");
  }
  const doc = payload as Record<string, unknown>;
  if (doc.version !== 1) {
    throw new HubError(
      "INVALID_PAYLOAD",
      "不支持的目录协议版本，需要 version=1"
    );
  }
  if (!Array.isArray(doc.items)) {
    throw new HubError("INVALID_PAYLOAD", "目录缺少 items 数组");
  }

  const items: CatalogItem[] = [];
  for (const candidate of (doc.items as unknown[]).slice(0, MAX_ITEMS)) {
    if (candidate === null || typeof candidate !== "object") {
      continue;
    }
    const raw = candidate as Record<string, unknown>;
    const title = asOptionalString(raw.title);
    const playUrl = asHttpUrl(raw.url);
    if (!title || !playUrl) {
      continue;
    }

    const common = {
      title,
      type: raw.type === "tv" ? ("tv" as const) : ("movie" as const),
      description: asOptionalString(raw.description),
      poster: asHttpUrl(raw.poster) ?? undefined,
      backdrop: asHttpUrl(raw.backdrop) ?? undefined,
      year: raw.year === undefined ? undefined : String(raw.year),
      group: asOptionalString(raw.group),
      subtitles: asSubtitles(raw.subtitles),
    };

    const episodes = Array.isArray(raw.episodes) ? raw.episodes : [];
    if (episodes.length === 0) {
      items.push({ ...common, id: playUrl, url: playUrl });
      continue;
    }

    episodes.slice(0, 200).forEach((episode, index) => {
      if (episode === null || typeof episode !== "object") {
        return;
      }
      const rawEpisode = episode as Record<string, unknown>;
      const episodeUrl = asHttpUrl(rawEpisode.url);
      if (!episodeUrl) {
        return;
      }
      items.push({
        ...common,
        title: `${title} · ${asOptionalString(rawEpisode.title) ?? `第 ${index + 1} 集`}`,
        type: "tv",
        id: episodeUrl,
        url: episodeUrl,
      });
    });
  }
  return items;
}

export const feedAdapter: HubAdapter = {
  id: "feed",
  title: "JSON 目录",
  description: "读取自部署服务按 rex-hub/1 协议输出的目录",
  requiresEndpoint: true,
  async list(endpoint, ctx: AdapterContext) {
    const payload = await fetchJson(endpoint, ctx.limits, ctx.headers);
    return parseFeed(payload).slice(0, ctx.limit);
  },
  async search(endpoint, keyword, ctx: AdapterContext) {
    const needle = keyword.trim().toLowerCase();
    if (needle === "") {
      return [];
    }
    const payload = await fetchJson(endpoint, ctx.limits, ctx.headers);
    return parseFeed(payload)
      .filter(
        item =>
          item.title.toLowerCase().includes(needle) ||
          (item.group ?? "").toLowerCase().includes(needle)
      )
      .slice(0, ctx.limit);
  },
};
