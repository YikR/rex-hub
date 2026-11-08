import { HubError } from "./errors";

/**
 * 网络访问的唯一出口。
 *
 * 安全策略（全部在测试中覆盖）：
 * 1. 只允许 http/https；其它协议（file:、data:、javascript:）直接拒绝。
 * 2. 云元数据地址永久拉黑，即使调用方配置指向它。
 * 3. 私有网段默认放行（自部署媒体服务通常位于局域网），可用 `allowPrivateHost=false` 关闭。
 * 4. 请求体大小、单次超时都有上限，避免拖死宿主。
 * 5. 不跟随重定向（Rex 宿主不暴露重定向策略，见 docs/security-review.md），
 *    因此 3xx 视为失败，避免被重定向到内网或元数据地址。
 */
export interface HttpLimits {
  /** 单次请求超时（毫秒） */
  timeoutMs: number;
  /** 单次响应最大字节数 */
  maxBytes: number;
  /** 是否允许访问私有网段（RFC1918 / 回环 / 链路本地） */
  allowPrivateHost: boolean;
}

/** 云厂商元数据端点：任何配置下都不允许访问。 */
const METADATA_HOSTS = new Set([
  "169.254.169.254", // AWS / GCP / Azure / OpenStack
  "100.100.100.200", // 阿里云
  "metadata", // 部分容器内 DNS 别名
  "metadata.google.internal",
]);

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
];

const PRIVATE_V6 = [/^\[?::1\]?$/, /^\[?f[cd][0-9a-f]{2}:/i, /^\[?fe80:/i];

export function isBlockedHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    METADATA_HOSTS.has(normalized) ||
    normalized.endsWith(".metadata.google.internal")
  );
}

export function isPrivateHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    return true;
  }
  if (PRIVATE_V4.some(re => re.test(normalized))) {
    return true;
  }
  return PRIVATE_V6.some(re => re.test(normalized));
}

/** 校验并归一化一个用户提供的地址。 */
export function assertAllowedUrl(raw: string, limits: HttpLimits): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HubError("INVALID_CONFIG", `地址不是合法 URL：${truncate(raw)}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HubError(
      "BLOCKED_PROTOCOL",
      `只允许 http/https，收到 ${url.protocol}`
    );
  }
  if (isBlockedHost(url.hostname)) {
    throw new HubError("BLOCKED_HOST", "拒绝访问云元数据地址");
  }
  if (!limits.allowPrivateHost && isPrivateHost(url.hostname)) {
    throw new HubError(
      "BLOCKED_HOST",
      "已禁用私有网段访问，可在模块设置中开启"
    );
  }
  if (url.username || url.password) {
    throw new HubError(
      "INVALID_CONFIG",
      "不要在地址中内联账号密码，请使用请求头配置"
    );
  }
  return url;
}

function truncate(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

interface HostResponse<T> {
  data: T;
  statusCode: number;
  headers: Record<string, string>;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new HubError("TIMEOUT", `${label} 超时（${timeoutMs}ms）`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }) as Promise<T>;
}

function headersLength(headers: Record<string, string>): number {
  let total = 0;
  for (const [key, value] of Object.entries(headers)) {
    total += key.length + value.length + 4;
  }
  return total;
}

async function request(
  url: string,
  limits: HttpLimits,
  headers?: Record<string, string>
): Promise<unknown> {
  const target = assertAllowedUrl(url, limits);
  const response = await withTimeout(
    Widget.http.get<unknown>(
      target.toString(),
      headers ? { headers } : undefined
    ) as Promise<HostResponse<unknown>>,
    limits.timeoutMs,
    "HTTP 请求"
  );

  if (response.statusCode >= 300 && response.statusCode < 400) {
    throw new HubError(
      "HTTP_STATUS",
      `不允许重定向（HTTP ${response.statusCode}）`
    );
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new HubError("HTTP_STATUS", `上游返回 HTTP ${response.statusCode}`);
  }

  const size =
    typeof response.data === "string"
      ? new TextEncoder().encode(response.data).length
      : headersLength(response.headers);
  if (size > limits.maxBytes) {
    throw new HubError("TOO_LARGE", `响应超过上限 ${limits.maxBytes} 字节`);
  }
  return response.data;
}

/** 获取文本资源（M3U 等）。宿主可能已把 JSON 解析成对象，这里统一序列化回文本。 */
export async function fetchText(
  url: string,
  limits: HttpLimits,
  headers?: Record<string, string>
): Promise<string> {
  const data = await request(url, limits, headers);
  if (typeof data === "string") {
    return data;
  }
  if (data === null || data === undefined) {
    return "";
  }
  return JSON.stringify(data);
}

/** 获取 JSON 资源。 */
export async function fetchJson(
  url: string,
  limits: HttpLimits,
  headers?: Record<string, string>
): Promise<unknown> {
  const data = await request(url, limits, headers);
  if (typeof data !== "string") {
    return data;
  }
  try {
    return JSON.parse(data) as unknown;
  } catch {
    throw new HubError("INVALID_PAYLOAD", "上游返回的不是合法 JSON");
  }
}
