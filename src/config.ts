import { HubError } from "./errors";
import type { HttpLimits } from "./http";
import { DEFAULT_PRESET } from "./presets";

/** 模块参数（Rex 会把 globalParams 合并进每次模块调用）。 */
export type RawParams = Record<string, unknown>;

export const DEFAULTS = {
  limit: 60,
  timeoutMs: 8000,
  maxBytes: 4 * 1024 * 1024,
  maxEndpoints: 8,
  page: 1,
  cacheTtl: 600,
} as const;

export interface EndpointEntry {
  /** 展示用名称，默认取主机名 */
  name: string;
  url: string;
}

export interface HubConfig extends HttpLimits {
  /** 适配器 id，见 src/registry.ts */
  source: string;
  /** 已解析的多来源列表（已合并预设） */
  endpoints: EndpointEntry[];
  /** 单次列表/搜索结果上限 */
  limit: number;
  /** 附加请求头（自定义 Headers JSON） */
  headers: Record<string, string>;
  /** 内置来源预设 id */
  preset: string;
  /** 适配器自带检索条件（archive 使用） */
  query: string;
  /** 页码，从 1 开始 */
  page: number;
  /** 响应缓存时长（秒），0 表示关闭 */
  cacheTtl: number;
}

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

function readString(params: RawParams, key: string): string | undefined {
  const value = params[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function readNumber(
  params: RawParams,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = readString(params, key);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new HubError("INVALID_CONFIG", `参数 ${key} 不是数字`);
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** 解析「一行一个来源」的地址表，支持 `名称=地址` 形式。 */
export function parseEndpoints(
  raw: string | undefined,
  max = DEFAULTS.maxEndpoints
): EndpointEntry[] {
  if (!raw) {
    return [];
  }
  const entries: EndpointEntry[] = [];
  const seen = new Set<string>();

  for (const line of raw.split(/\r?\n|;|,(?=\s*https?:)/)) {
    const item = line.trim();
    if (item === "" || item.startsWith("#")) {
      continue;
    }

    let name = "";
    let url = item;
    const eq = item.indexOf("=");
    if (eq > 0 && !/^https?:/i.test(item)) {
      name = item.slice(0, eq).trim();
      url = item.slice(eq + 1).trim();
    }

    if (seen.has(url)) {
      continue;
    }
    seen.add(url);

    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      throw new HubError(
        "INVALID_CONFIG",
        `来源地址不是合法 URL：${item.slice(0, 120)}`
      );
    }
    entries.push({ name: name || host, url });
    if (entries.length >= max) {
      break;
    }
  }
  return entries;
}

/** 校验自定义请求头：拒绝 CRLF 注入与超长值。 */
export function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HubError(
      "INVALID_CONFIG",
      '请求头必须是 JSON 对象，例如 {"Authorization":"Bearer xxx"}'
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HubError("INVALID_CONFIG", "请求头必须是 JSON 对象");
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>
  )) {
    if (!HEADER_NAME.test(key)) {
      throw new HubError(
        "INVALID_CONFIG",
        `请求头名称非法：${key.slice(0, 40)}`
      );
    }
    if (typeof value !== "string" && typeof value !== "number") {
      throw new HubError("INVALID_CONFIG", `请求头 ${key} 的值必须是字符串`);
    }
    const text = String(value);
    if (/[\r\n]/.test(text) || text.includes("\u0000") || text.length > 512) {
      throw new HubError("INVALID_CONFIG", `请求头 ${key} 的值非法`);
    }
    headers[key] = text;
  }
  return headers;
}

/** 从模块参数构建运行配置。所有取值都带边界，避免宿主传入离谱数值。 */
export function readConfig(
  params: RawParams | undefined,
  defaultSource: string
): HubConfig {
  const input = params ?? {};
  const allowPrivateHost = readString(input, "allowPrivateHost") !== "false";

  return {
    source: readString(input, "source") ?? defaultSource,
    endpoints: parseEndpoints(readString(input, "endpoint")),
    limit: readNumber(input, "limit", DEFAULTS.limit, 1, 200),
    timeoutMs: readNumber(input, "timeout", DEFAULTS.timeoutMs, 1000, 20000),
    maxBytes: readNumber(
      input,
      "maxBytes",
      DEFAULTS.maxBytes,
      64 * 1024,
      16 * 1024 * 1024
    ),
    allowPrivateHost,
    headers: parseHeaders(readString(input, "headers")),
    preset: readString(input, "preset") ?? DEFAULT_PRESET,
    query: readString(input, "query") ?? "",
    page: readNumber(input, "page", DEFAULTS.page, 1, 100),
    cacheTtl: readNumber(input, "cacheTtl", DEFAULTS.cacheTtl, 0, 86_400),
  };
}
