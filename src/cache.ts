/**
 * 轻量响应缓存。
 *
 * Rex 宿主提供 `Widget.sharedCache`（跨模块共享、由宿主落盘）。它适合缓存**公开**的上游响应：
 * 这里只缓存目录/检索结果，不缓存请求头、不缓存任何凭据。
 *
 * 宿主可能不提供该能力（测试环境、旧版本），因此所有调用都先做能力探测并静默降级。
 */
export interface CacheOptions {
  /** 0 表示不缓存 */
  ttlSeconds: number;
  namespace: string;
}

interface CacheEntry<T> {
  /** 写入时间（毫秒） */
  at: number;
  value: T;
}

function store(): {
  get?: (namespace: string, key: string) => unknown;
  set?: (namespace: string, key: string, value?: unknown) => unknown;
} | null {
  const widget = (globalThis as { Widget?: { sharedCache?: unknown } }).Widget;
  const shared = widget?.sharedCache;
  if (!shared || typeof shared !== "object") {
    return null;
  }
  return shared as {
    get?: (namespace: string, key: string) => unknown;
    set?: (namespace: string, key: string, value?: unknown) => unknown;
  };
}

export function cacheAvailable(): boolean {
  const shared = store();
  return typeof shared?.get === "function" && typeof shared?.set === "function";
}

/** 读取缓存；过期、缺失或宿主不支持都返回 null。 */
export function readCache<T>(options: CacheOptions, key: string): T | null {
  if (options.ttlSeconds <= 0 || !cacheAvailable()) {
    return null;
  }
  try {
    const raw = store()?.get?.(options.namespace, key);
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const entry = raw as CacheEntry<T>;
    if (typeof entry.at !== "number" || !("value" in entry)) {
      return null;
    }
    if (Date.now() - entry.at > options.ttlSeconds * 1000) {
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

/** 写入缓存；失败（配额、序列化、宿主不支持）静默忽略。 */
export function writeCache<T>(
  options: CacheOptions,
  key: string,
  value: T
): void {
  if (options.ttlSeconds <= 0 || !cacheAvailable()) {
    return;
  }
  try {
    store()?.set?.(options.namespace, key, {
      at: Date.now(),
      value,
    } satisfies CacheEntry<T>);
  } catch {
    // 缓存只是优化，失败不影响主流程
  }
}

/** 包装一次读取：命中返回缓存，未命中执行 loader 并回填。 */
export async function withCache<T>(
  options: CacheOptions | undefined,
  key: string,
  loader: () => Promise<T>
): Promise<T> {
  if (!options || options.ttlSeconds <= 0) {
    return loader();
  }
  const cached = readCache<T>(options, key);
  if (cached !== null) {
    return cached;
  }
  const value = await loader();
  writeCache(options, key, value);
  return value;
}
