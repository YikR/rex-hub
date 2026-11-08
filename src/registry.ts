import { feedAdapter } from "./adapters/jsonfeed";
import { playlistAdapter } from "./adapters/playlist";
import type { HubAdapter } from "./adapters/types";
import { HubError } from "./errors";

/**
 * 内置适配器注册表。
 *
 * 新增来源只需要实现 {@link HubAdapter} 并在此登记；元数据、参数校验、合并逻辑
 * 与测试用例都从这里派生，不需要改动入口函数。
 */
export const ADAPTERS: readonly HubAdapter[] = [playlistAdapter, feedAdapter];

export const DEFAULT_SOURCE = playlistAdapter.id;

export function getAdapter(id: string): HubAdapter {
  const adapter = ADAPTERS.find(candidate => candidate.id === id);
  if (!adapter) {
    throw new HubError("UNSUPPORTED_SOURCE", `未知来源类型：${id}`);
  }
  return adapter;
}

export function sourceOptions(): Array<{ title: string; value: string }> {
  return ADAPTERS.map(adapter => ({ title: adapter.title, value: adapter.id }));
}
