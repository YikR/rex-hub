import type { AdapterContext, CatalogItem } from "./adapters/types";
import type { EndpointEntry } from "./config";
import { asHubError, type HubError } from "./errors";

export interface SourceFailure {
  source: string;
  code: HubError["code"];
  message: string;
}

export interface CollectResult {
  items: CatalogItem[];
  failures: SourceFailure[];
}

/**
 * 在多个来源上并发执行同一操作并合并结果。
 *
 * - 单个来源失败不影响其它来源（失败隔离）。
 * - 按播放地址去重，保持来源声明顺序，结果稳定可预测。
 * - 没有分组信息的条目用来源名补齐，便于用户在合并列表里区分出处。
 */
export async function collectAcross(
  endpoints: EndpointEntry[],
  ctx: AdapterContext,
  task: (endpoint: EndpointEntry) => Promise<CatalogItem[]>
): Promise<CollectResult> {
  if (endpoints.length === 0) {
    return { items: [], failures: [] };
  }

  const settled = await Promise.allSettled(
    endpoints.map(endpoint => task(endpoint))
  );
  const items: CatalogItem[] = [];
  const failures: SourceFailure[] = [];
  const seen = new Set<string>();

  settled.forEach((result, index) => {
    const endpoint = endpoints[index];
    if (!endpoint) {
      return;
    }
    if (result.status === "rejected") {
      const error = asHubError(result.reason);
      failures.push({
        source: endpoint.name,
        code: error.code,
        message: error.message,
      });
      return;
    }
    for (const item of result.value) {
      const key = `${item.type}:${item.url}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push({ ...item, group: item.group ?? endpoint.name });
    }
  });

  return { items: items.slice(0, ctx.limit), failures };
}
