import { DEFAULTS } from "./config";
import { DEFAULT_SOURCE, sourceOptions } from "./registry";

/** 与 package.json 的 version 保持一致（有单测守护）。 */
export const HUB_VERSION = "0.1.0";
export const HUB_ID = "rex-hub";

/**
 * Widget 元数据。Rex 读取全局 `WidgetMetadata` 来决定模块在设置页与资源库中的呈现。
 * 字段说明见 https://github.com/baranwang/rex-widget-libs 的 `@rexnow/libs/env/metadata`。
 */
export function buildMetadata(): WidgetMetadata {
  return {
    id: HUB_ID,
    title: "Rex Hub 多源聚合",
    description: "把多个自部署或公开的媒体来源合并成一个可切换、可配置的模块。",
    author: "YikR",
    version: HUB_VERSION,
    // 0.0.2 起支持 enumeration/count 参数与 stream 模块
    requiredVersion: "0.0.2",
    globalParams: [
      {
        name: "source",
        title: "来源类型",
        type: "enumeration",
        description: "playlist：M3U 列表；feed：rex-hub/1 JSON 目录",
        value: DEFAULT_SOURCE,
        enumOptions: sourceOptions(),
      },
      {
        name: "endpoint",
        title: "来源地址",
        type: "input",
        description: "一行一个地址，支持「名称=地址」；最多 8 个，会合并去重",
        value: "",
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
