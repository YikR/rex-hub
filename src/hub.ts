import type {
  AdapterContext,
  CatalogItem,
  SubtitleEntry,
} from "./adapters/types";
import { collectAcross, type SourceFailure } from "./aggregate";
import { type HubConfig, readConfig } from "./config";
import { HubError } from "./errors";
import { assertAllowedUrl } from "./http";
import { DEFAULT_SOURCE, getAdapter } from "./registry";

export type HubParams = Record<string, unknown> & {
  keyword?: string;
  link?: string;
  videoUrl?: string;
  id?: string;
  title?: string;
};

export interface ListResult {
  items: VideoItem[];
  failures: SourceFailure[];
}

function contextOf(config: HubConfig): AdapterContext {
  return {
    limits: {
      timeoutMs: config.timeoutMs,
      maxBytes: config.maxBytes,
      allowPrivateHost: config.allowPrivateHost,
    },
    limit: config.limit,
    headers: config.headers,
  };
}

function requireEndpoints(config: HubConfig): void {
  if (config.endpoints.length === 0) {
    throw new HubError(
      "MISSING_ENDPOINT",
      "请先在模块设置中填写至少一个来源地址"
    );
  }
}

/** 内部模型 → Rex 的 VideoItem。type=url 表示客户端可直接播放该地址。 */
export function toVideoItems(items: CatalogItem[]): VideoItem[] {
  return items.map(item => ({
    id: item.url,
    type: "url" as const,
    title: item.title,
    coverUrl: item.poster,
    posterPath: item.poster,
    backdropPath: item.backdrop,
    detailPoster: item.poster,
    description: item.description,
    releaseDate: item.year,
    mediaType: item.type,
    genreTitle: item.group,
    videoUrl: item.url,
    link: item.url,
  }));
}

export async function listItems(params?: HubParams): Promise<ListResult> {
  const config = readConfig(params, DEFAULT_SOURCE);
  requireEndpoints(config);
  const adapter = getAdapter(config.source);
  const ctx = contextOf(config);
  const { items, failures } = await collectAcross(
    config.endpoints,
    ctx,
    endpoint => adapter.list(endpoint.url, ctx)
  );
  return { items: toVideoItems(items), failures };
}

export async function searchItems(params?: HubParams): Promise<ListResult> {
  const keyword =
    typeof params?.keyword === "string" ? params.keyword.trim() : "";
  const config = readConfig(params, DEFAULT_SOURCE);
  requireEndpoints(config);
  const adapter = getAdapter(config.source);
  if (!adapter.search || keyword === "") {
    return { items: [], failures: [] };
  }
  const ctx = contextOf(config);
  const { items, failures } = await collectAcross(
    config.endpoints,
    ctx,
    endpoint =>
      adapter.search
        ? adapter.search(endpoint.url, keyword, ctx)
        : Promise.resolve([])
  );
  return { items: toVideoItems(items), failures };
}

/** 取流：Rex 会把上次返回的 videoUrl/link 回传，这里做最后一道协议校验。 */
export function streamSources(params?: HubParams): StreamSourceItem[] {
  const config = readConfig(params, DEFAULT_SOURCE);
  const raw = [params?.videoUrl, params?.link, params?.id].find(
    (value): value is string => typeof value === "string" && value.trim() !== ""
  );
  if (!raw) {
    throw new HubError("NOT_FOUND", "缺少播放地址，请从列表进入");
  }
  const url = assertAllowedUrl(raw, {
    timeoutMs: config.timeoutMs,
    maxBytes: config.maxBytes,
    allowPrivateHost: config.allowPrivateHost,
  });
  return [{ name: "直连", url: url.toString() }];
}

/** 字幕：仅 JSON 目录协议携带字幕信息，M3U 列表没有字幕。 */
export async function subtitleEntries(
  params?: HubParams
): Promise<SubtitleEntry[]> {
  const config = readConfig(params, DEFAULT_SOURCE);
  requireEndpoints(config);
  const adapter = getAdapter(config.source);
  if (!adapter.search) {
    return [];
  }
  const title = typeof params?.title === "string" ? params.title.trim() : "";
  if (title === "") {
    return [];
  }
  const ctx = contextOf(config);
  for (const endpoint of config.endpoints) {
    try {
      const items = await adapter.search(endpoint.url, title, ctx);
      const matched = items.find(
        item => item.subtitles && item.subtitles.length > 0
      );
      if (matched?.subtitles) {
        return matched.subtitles;
      }
    } catch {
      // 单个来源失败时继续尝试下一个，最终由调用方降级为空列表。
    }
  }
  return [];
}

export function toSubtitleItems(entries: SubtitleEntry[]): SubtitleItem[] {
  return entries.map((entry, index) => ({
    id: `hub-sub-${index}`,
    title: entry.title,
    lang: entry.lang,
    count: 1,
    url: entry.url,
  }));
}
