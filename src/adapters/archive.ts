import { HubError } from "../errors";
import { fetchJson } from "../http";
import { withCache } from "../cache";
import type { AdapterContext, CatalogItem, HubAdapter } from "./types";

/**
 * Internet Archive 公共影视库适配器。
 *
 * 只用官方公开接口：
 * - 检索：`https://archive.org/advancedsearch.php?...&output=json`
 * - 文件清单：`https://archive.org/metadata/<identifier>`
 * - 播放：`https://archive.org/download/<identifier>/<file>`
 *
 * 站点上并非每个条目都有可播放文件（有的只有元数据、有的被限制），因此实现会**逐条探测**、
 * 跳过无用条目，并对"文件清单"做缓存，避免重复请求。
 */

const SEARCH_BASE = "https://archive.org/advancedsearch.php";
const METADATA_BASE = "https://archive.org/metadata/";
const DOWNLOAD_BASE = "https://archive.org/download/";
const IMAGE_BASE = "https://archive.org/services/img/";

/**
 * 默认检索：限定在经典影片/剧集合集，避免混入公共影库里的成人/剥削片合集。
 * 想换范围就改 `query` 参数，例如 `collection:(feature_films)` 或 `year:1954`。
 */
export const DEFAULT_ARCHIVE_QUERY =
  "collection:(silent_films OR film_noir OR sci-fi_horror OR classic_tv) AND mediatype:movies AND format:(MPEG4)";

/** 可播放文件格式，按优先级排序 */
const PLAYABLE_FORMATS = [
  "h.264",
  "MPEG4",
  "512Kb MPEG4",
  "Ogg Video",
  "WebM",
  "Matroska",
];
const PLAYABLE_EXTENSIONS = [".mp4", ".m4v", ".webm", ".ogv", ".mkv"];

/** 每次列表最多探测多少个候选条目（搜索行数会按 2 倍放大以抵消空条目） */
const MAX_PROBES = 12;
const PROBE_CONCURRENCY = 4;

export interface ArchiveDoc {
  identifier: string;
  title: string;
  year?: string;
  description?: string;
}

export interface ArchiveFile {
  name?: string;
  format?: string;
  size?: string;
  length?: string;
}

/** 解析检索响应；非 JSON 结构直接判失败，坏条目逐条跳过。 */
export function parseArchiveSearch(payload: unknown): ArchiveDoc[] {
  if (payload === null || typeof payload !== "object") {
    throw new HubError("INVALID_PAYLOAD", "Internet Archive 检索结果不是对象");
  }
  const response = (payload as { response?: unknown }).response;
  if (response === null || typeof response !== "object") {
    throw new HubError(
      "INVALID_PAYLOAD",
      "Internet Archive 检索结果缺少 response"
    );
  }
  const docs = (response as { docs?: unknown }).docs;
  if (!Array.isArray(docs)) {
    throw new HubError("INVALID_PAYLOAD", "Internet Archive 检索结果缺少 docs");
  }

  const parsed: ArchiveDoc[] = [];
  for (const candidate of docs.slice(0, 100)) {
    if (candidate === null || typeof candidate !== "object") {
      continue;
    }
    const raw = candidate as Record<string, unknown>;
    const identifier =
      typeof raw.identifier === "string" ? raw.identifier.trim() : "";
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (identifier === "" || title === "") {
      continue;
    }
    parsed.push({
      identifier,
      title,
      year:
        raw.year === undefined || raw.year === null
          ? undefined
          : String(raw.year),
      description:
        typeof raw.description === "string" && raw.description.trim() !== ""
          ? raw.description.trim().slice(0, 500)
          : undefined,
    });
  }
  return parsed;
}

/** 从文件清单里挑一个最适合直接播放的文件（优先 h.264 MP4）。 */
export function pickVideoFile(files: unknown): ArchiveFile | null {
  if (!Array.isArray(files)) {
    return null;
  }
  const videos = files.filter((file): file is ArchiveFile => {
    if (file === null || typeof file !== "object") {
      return false;
    }
    const name = (file as ArchiveFile).name;
    return (
      typeof name === "string" &&
      PLAYABLE_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext))
    );
  });
  if (videos.length === 0) {
    return null;
  }
  videos.sort((left, right) => {
    const leftRank = PLAYABLE_FORMATS.indexOf(String(left.format ?? ""));
    const rightRank = PLAYABLE_FORMATS.indexOf(String(right.format ?? ""));
    const normalizedLeft = leftRank === -1 ? PLAYABLE_FORMATS.length : leftRank;
    const normalizedRight =
      rightRank === -1 ? PLAYABLE_FORMATS.length : rightRank;
    return normalizedLeft - normalizedRight;
  });
  return videos[0] ?? null;
}

export function buildDownloadUrl(identifier: string, fileName: string): string {
  return `${DOWNLOAD_BASE}${encodeURIComponent(identifier)}/${fileName
    .split("/")
    .map(part => encodeURIComponent(part))
    .join("/")}`;
}

export function buildPosterUrl(identifier: string): string {
  return `${IMAGE_BASE}${encodeURIComponent(identifier)}`;
}

function buildSearchUrl(query: string, limit: number, page: number): string {
  const rows = Math.min(50, Math.max(limit * 2, limit));
  const params: Array<[string, string]> = [
    ["q", query],
    ["rows", String(rows)],
    ["page", String(page)],
    ["output", "json"],
    ["sort[]", "downloads desc"],
    ["fl[]", "identifier"],
    ["fl[]", "title"],
    ["fl[]", "year"],
    ["fl[]", "description"],
  ];
  const queryString = params
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join("&");
  return `${SEARCH_BASE}?${queryString}`;
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        const item = items[index];
        if (item === undefined) {
          continue;
        }
        results[index] = await task(item);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function resolveItems(
  docs: ArchiveDoc[],
  ctx: AdapterContext
): Promise<CatalogItem[]> {
  const probes = docs.slice(0, MAX_PROBES);
  const resolved = await mapLimited(probes, PROBE_CONCURRENCY, async doc => {
    try {
      const meta = await withCache(ctx.cache, `meta:${doc.identifier}`, () =>
        fetchJson(
          `${METADATA_BASE}${encodeURIComponent(doc.identifier)}`,
          ctx.limits,
          ctx.headers
        )
      );
      const files = (meta as { files?: unknown } | null)?.files;
      const file = pickVideoFile(files);
      if (!file?.name) {
        return null;
      }
      const item: CatalogItem = {
        id: buildDownloadUrl(doc.identifier, file.name),
        title: doc.title,
        type: "movie",
        url: buildDownloadUrl(doc.identifier, file.name),
        poster: buildPosterUrl(doc.identifier),
        group: "公共领域",
      };
      if (doc.year !== undefined) {
        item.year = doc.year;
      }
      if (doc.description !== undefined) {
        item.description = doc.description;
      }
      return item;
    } catch {
      // 单个条目失败（下架、限制、超时）直接跳过
      return null;
    }
  });

  return resolved
    .filter((item): item is CatalogItem => item !== null)
    .slice(0, ctx.limit);
}

async function query(
  endpoint: string,
  ctx: AdapterContext,
  condition: string
): Promise<CatalogItem[]> {
  const queryText = [DEFAULT_ARCHIVE_QUERY, condition]
    .filter(part => part.trim() !== "")
    .join(" AND ");
  const page = Math.max(1, ctx.page ?? 1);
  const url =
    endpoint.trim() === ""
      ? buildSearchUrl(queryText, ctx.limit, page)
      : endpoint;

  const payload = await withCache(ctx.cache, `search:${url}`, () =>
    fetchJson(url, ctx.limits, ctx.headers)
  );
  return resolveItems(parseArchiveSearch(payload), ctx);
}

export const archiveAdapter: HubAdapter = {
  id: "archive",
  title: "Internet Archive 公共影库",
  description: "公共领域/开放授权影片，按热度检索，支持分页与关键词过滤",
  requiresEndpoint: false,
  async list(endpoint, ctx) {
    return query(endpoint, ctx, "");
  },
  async search(endpoint, keyword, ctx) {
    const needle = keyword.replace(/["\\]/g, " ").trim();
    if (needle === "") {
      return [];
    }
    return query(
      endpoint,
      ctx,
      `(title:(${needle}) OR description:(${needle}))`
    );
  },
};
