import { DEFAULTS } from "./config";
import { DEFAULT_PRESET, presetOptions } from "./presets";
import { DEFAULT_SOURCE, sourceOptions } from "./registry";

/** 与 package.json 的 version 保持一致（有单测守护）。 */
export const HUB_VERSION = "0.2.3";
export const HUB_ID = "yikr.rex-hub";
export const HUB_ICON =
  "https://raw.githubusercontent.com/YikR/rex-hub/main/assets/icon.png";

/**
 * Widget 元数据。Rex 读取全局 `WidgetMetadata` 来决定模块在设置页与资源库中的呈现。
 * 字段说明见 https://github.com/baranwang/rex-widget-libs 的 `@rexnow/libs/env/metadata`。
 */
export function buildMetadata(): WidgetMetadata {
  return {
    id: HUB_ID,
    title: "Rex Hub 多源聚合",
    description:
      "把公共影库、公开频道与自部署媒体来源合并成一个可切换、可配置的模块。",
    author: "YikR",
    version: HUB_VERSION,
    // 0.0.2 起支持 enumeration/count/page 参数与 stream 模块
    requiredVersion: "0.0.2",
    icon: HUB_ICON,
    globalParams: [
      {
        name: "source",
        title: "来源类型",
        type: "enumeration",
        description:
          "archive：Internet Archive 公共影库（免配置）；playlist：M3U 列表；feed：rex-hub/1 JSON 目录",
        value: DEFAULT_SOURCE,
        enumOptions: sourceOptions(),
      },
      {
        name: "preset",
        title: "内置预设",
        type: "enumeration",
        description: "一键填入公开频道列表，可与下方地址叠加",
        value: DEFAULT_PRESET,
        enumOptions: presetOptions(),
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
        value: String(DEFAULTS.limit),
      },
      {
        name: "timeout",
        title: "超时（毫秒）",
        type: "count",
        description: "单个来源请求超时，1000–20000",
        value: String(DEFAULTS.timeoutMs),
      },
      {
        name: "cacheTtl",
        title: "缓存（秒）",
        type: "count",
        description: "上游响应的本地缓存时长，0 表示关闭",
        value: String(DEFAULTS.cacheTtl),
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
}
