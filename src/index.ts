import { report } from "./errors";
import {
  type HubParams,
  listItems,
  searchItems,
  streamSources,
  subtitleEntries,
  toSubtitleItems,
} from "./hub";

/**
 * 模块元数据。
 *
 * **必须是顶层对象字面量**：Rex 在导入阶段用静态解析读取这里的标题/版本/参数，
 * 不会执行脚本。若把它赋值成函数调用的结果，客户端找不到对象字面量，
 * 就会报「添加失败：无法识别的模块数据」。
 *
 * 这份字面量与 `src/metadata.ts` 的 `buildMetadata()` 内容一致，
 * 由 `test/manifest.test.ts` 做深度比较守护，改一处必须同步另一处。
 *
 * 构建产物里导出声明会被 `@rexnow/rslib-plugin` 移除，顶层函数因此成为宿主可解析的全局函数。
 */
WidgetMetadata = {
  id: "yikr.rex-hub",
  title: "Rex Hub 多源聚合",
  description:
    "把公共影库、公开频道与自部署媒体来源合并成一个可切换、可配置的模块。",
  author: "YikR",
  version: "0.2.3",
  requiredVersion: "0.0.2",
  icon: "https://raw.githubusercontent.com/YikR/rex-hub/main/assets/icon.png",
  globalParams: [
    {
      name: "source",
      title: "来源类型",
      type: "enumeration",
      description:
        "archive：Internet Archive 公共影库（免配置）；playlist：M3U 列表；feed：rex-hub/1 JSON 目录",
      value: "archive",
      enumOptions: [
        { title: "Internet Archive 公共影库", value: "archive" },
        { title: "M3U 播放列表", value: "playlist" },
        { title: "JSON 目录", value: "feed" },
      ],
    },
    {
      name: "preset",
      title: "内置预设",
      type: "enumeration",
      description: "一键填入公开频道列表，可与下方地址叠加",
      value: "custom",
      enumOptions: [
        { title: "自定义（只用下方地址）", value: "custom" },
        { title: "公开频道 · 中国", value: "iptv-cn" },
        { title: "公开频道 · 中国香港", value: "iptv-hk" },
        { title: "公开频道 · 中国台湾", value: "iptv-tw" },
        { title: "公开频道 · 日本", value: "iptv-jp" },
        { title: "公开频道 · 美国", value: "iptv-us" },
        { title: "公开频道 · 英国", value: "iptv-uk" },
        { title: "公开频道 · 亚洲综合", value: "iptv-asia" },
      ],
    },
    {
      name: "endpoint",
      title: "来源地址",
      type: "input",
      description:
        "一行一个地址，支持「名称=地址」；最多 8 个，会合并去重。archive 留空即用内置检索",
      value: "",
    },
    {
      name: "query",
      title: "检索条件",
      type: "input",
      description:
        "仅 archive：附加检索式，例如 collection:(sci-fi_horror) 或 year:1954",
      value: "",
    },
    {
      name: "page",
      title: "页码",
      type: "page",
      description: "仅 archive：从 1 开始的页码",
      value: "1",
    },
    {
      name: "limit",
      title: "结果上限",
      type: "count",
      description: "合并后的条目数上限",
      value: "60",
    },
    {
      name: "timeout",
      title: "超时（毫秒）",
      type: "count",
      description: "单个来源请求超时，1000–20000",
      value: "8000",
    },
    {
      name: "cacheTtl",
      title: "缓存（秒）",
      type: "count",
      description: "上游响应的本地缓存时长，0 表示关闭",
      value: "600",
    },
    {
      name: "allowPrivateHost",
      title: "允许私有网段",
      type: "enumeration",
      description: "自部署服务在局域网时保持 true",
      value: "true",
      enumOptions: [
        { title: "允许", value: "true" },
        { title: "禁止", value: "false" },
      ],
    },
    {
      name: "headers",
      title: "请求头（JSON）",
      type: "input",
      description:
        '例如 {"Authorization":"Bearer xxx"}；仅本地保存，随请求发送',
      value: "",
    },
  ],
  modules: [
    {
      id: "hub-list",
      title: "浏览来源",
      description: "列出所有来源合并后的条目",
      functionName: "hubList",
      cacheDuration: 300,
      params: [],
    },
    {
      id: "hub-search",
      title: "搜索",
      description: "在全部来源中按标题搜索",
      functionName: "hubSearch",
      cacheDuration: 120,
      params: [{ name: "keyword", title: "关键词", type: "input" }],
    },
    {
      type: "stream",
      id: "loadResource",
      title: "获取播放地址",
      description: "把列表条目转换为可播放直链",
      functionName: "loadResource",
      params: [],
    },
    {
      type: "subtitle",
      id: "loadSubtitle",
      title: "获取字幕",
      description: "读取 JSON 目录中声明的字幕",
      functionName: "loadSubtitle",
      params: [],
    },
  ],
  search: {
    title: "搜索",
    functionName: "hubSearch",
    params: [{ name: "keyword", title: "关键词", type: "input" }],
  },
};

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
