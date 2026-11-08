import { report } from "./errors";
import {
  type HubParams,
  listItems,
  searchItems,
  streamSources,
  subtitleEntries,
  toSubtitleItems,
} from "./hub";
import { buildMetadata } from "./metadata";

/**
 * Rex Widget 入口。
 *
 * 构建后（rslib + @rexnow/rslib-plugin）导出声明会被移除，保留顶层函数声明与
 * `WidgetMetadata` 赋值，宿主据此按 `functionName` 解析函数。
 */
WidgetMetadata = buildMetadata();

export async function hubList(params: HubParams): Promise<VideoItem[]> {
  try {
    const { items, failures } = await listItems(params);
    if (failures.length > 0) {
      report(
        "hubList",
        new Error(
          failures
            .map(failure => `${failure.source}:${failure.code}`)
            .join(", ")
        )
      );
    }
    return items;
  } catch (error) {
    report("hubList", error);
    return [];
  }
}

export async function hubSearch(params: HubParams): Promise<VideoItem[]> {
  try {
    const { items } = await searchItems(params);
    return items;
  } catch (error) {
    report("hubSearch", error);
    return [];
  }
}

export async function loadResource(
  params: HubParams
): Promise<StreamSourceItem[]> {
  try {
    return streamSources(params);
  } catch (error) {
    report("loadResource", error);
    return [];
  }
}

export async function loadSubtitle(params: HubParams): Promise<SubtitleItem[]> {
  try {
    return toSubtitleItems(await subtitleEntries(params));
  } catch (error) {
    report("loadSubtitle", error);
    return [];
  }
}
