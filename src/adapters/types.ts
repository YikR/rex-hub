import type { HttpLimits } from "../http";
import type { CacheOptions } from "../cache";

/** 适配器统一输出的条目模型（内部模型，与 Rex 的 VideoItem 解耦）。 */
export interface CatalogItem {
  /** 稳定标识：对 URL 类资源直接使用播放地址 */
  id: string;
  title: string;
  type: "movie" | "tv";
  /** 播放地址（m3u8 / mp4 / HLS 主 playlist） */
  url: string;
  description?: string;
  poster?: string;
  backdrop?: string;
  year?: string;
  /** 分组/分类名，映射到 VideoItem.genreTitle */
  group?: string;
  subtitles?: SubtitleEntry[];
}

export interface SubtitleEntry {
  title: string;
  lang: string;
  url: string;
}

export interface AdapterContext {
  limits: HttpLimits;
  /** 单次结果上限 */
  limit: number;
  /** 附加请求头（例如自部署服务的 Authorization） */
  headers: Record<string, string>;
  /** 站内搜索关键词 */
  keyword?: string;
  /** 适配器自带的检索条件（archive 等按关键词检索的来源使用） */
  query?: string;
  /** 页码，从 1 开始 */
  page?: number;
  /** 可选响应缓存 */
  cache?: CacheOptions;
}

export interface HubAdapter {
  id: string;
  title: string;
  description: string;
  /** 是否需要 endpoint；false 表示来源内置检索地址 */
  requiresEndpoint: boolean;
  /** 列表来源；返回上限由 ctx.limit 控制 */
  list(endpoint: string, ctx: AdapterContext): Promise<CatalogItem[]>;
  /** 站内搜索；缺省表示该适配器不支持搜索 */
  search?(
    endpoint: string,
    keyword: string,
    ctx: AdapterContext
  ): Promise<CatalogItem[]>;
}
