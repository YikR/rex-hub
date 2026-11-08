/**
 * 内置来源预设。
 *
 * 预设只做一件事：把一组**公开可访问**的地址替你填好，省去手动粘贴。
 * 任何预设都可以和自定义地址叠加使用；填了预设也不影响 `source` 的选择。
 *
 * iptv-org 是公开的频道索引项目（https://github.com/iptv-org/iptv），
 * 收录的是各频道公开提供的直播流。是否可播放取决于频道方，与是否取得相应观看权无关。
 */
export interface Preset {
  id: string;
  title: string;
  endpoints: string[];
}

export const PRESETS: readonly Preset[] = [
  { id: "custom", title: "自定义（只用下方地址）", endpoints: [] },
  {
    id: "iptv-cn",
    title: "公开频道 · 中国",
    endpoints: ["https://iptv-org.github.io/iptv/countries/cn.m3u"],
  },
  {
    id: "iptv-hk",
    title: "公开频道 · 中国香港",
    endpoints: ["https://iptv-org.github.io/iptv/countries/hk.m3u"],
  },
  {
    id: "iptv-tw",
    title: "公开频道 · 中国台湾",
    endpoints: ["https://iptv-org.github.io/iptv/countries/tw.m3u"],
  },
  {
    id: "iptv-jp",
    title: "公开频道 · 日本",
    endpoints: ["https://iptv-org.github.io/iptv/countries/jp.m3u"],
  },
  {
    id: "iptv-us",
    title: "公开频道 · 美国",
    endpoints: ["https://iptv-org.github.io/iptv/countries/us.m3u"],
  },
  {
    id: "iptv-uk",
    title: "公开频道 · 英国",
    endpoints: ["https://iptv-org.github.io/iptv/countries/uk.m3u"],
  },
  {
    id: "iptv-asia",
    title: "公开频道 · 亚洲综合",
    endpoints: ["https://iptv-org.github.io/iptv/index.m3u"],
  },
] as const;

export const DEFAULT_PRESET = "custom";

export function presetOptions(): Array<{ title: string; value: string }> {
  return PRESETS.map(preset => ({ title: preset.title, value: preset.id }));
}

export function presetEndpoints(id: string | undefined): string[] {
  if (!id || id === DEFAULT_PRESET) {
    return [];
  }
  return PRESETS.find(preset => preset.id === id)?.endpoints.slice() ?? [];
}
