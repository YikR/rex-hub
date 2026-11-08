import { HubError } from "../errors";
import { fetchText } from "../http";
import type { AdapterContext, CatalogItem, HubAdapter } from "./types";

export interface M3UEntry {
  title: string;
  url: string;
  attrs: Record<string, string>;
}

const EXTINF = /^#EXTINF:\s*(-?[\d.]+)\s*(.*)$/;
const ATTR = /([A-Za-z0-9_-]+)="([^"]*)"/g;
const MAX_LINES = 20_000;

/** 纯函数解析：不触网，便于单测与回归。 */
export function parseM3U(text: string): M3UEntry[] {
  if (!text.includes("#EXTM3U")) {
    throw new HubError("INVALID_PAYLOAD", "不是 M3U 播放列表（缺少 #EXTM3U）");
  }

  const lines = text.split(/\r?\n/).slice(0, MAX_LINES);
  const entries: M3UEntry[] = [];
  let pending: { title: string; attrs: Record<string, string> } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }

    if (line.startsWith("#EXTINF:")) {
      const match = EXTINF.exec(line);
      if (!match) {
        pending = null;
        continue;
      }
      const attrs: Record<string, string> = {};
      ATTR.lastIndex = 0;
      let attr: RegExpExecArray | null = ATTR.exec(match[2] ?? "");
      while (attr !== null) {
        attrs[attr[1].toLowerCase()] = attr[2];
        attr = ATTR.exec(match[2] ?? "");
      }
      const commaAt = (match[2] ?? "").lastIndexOf(",");
      const title =
        commaAt >= 0 ? (match[2] ?? "").slice(commaAt + 1).trim() : "";
      pending = { title, attrs };
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    let url: string;
    try {
      const parsed = new URL(line);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        pending = null;
        continue;
      }
      url = parsed.toString();
    } catch {
      pending = null;
      continue;
    }
    entries.push({
      title: pending?.title && pending.title !== "" ? pending.title : url,
      url,
      attrs: pending?.attrs ?? {},
    });
    pending = null;
  }

  return entries;
}

function toItem(entry: M3UEntry): CatalogItem {
  const logo = entry.attrs["tvg-logo"] ?? entry.attrs["logo"];
  const group = entry.attrs["group-title"];
  return {
    id: entry.url,
    title: entry.title,
    type: "tv",
    url: entry.url,
    poster: logo && /^https?:\/\//i.test(logo) ? logo : undefined,
    group: group && group !== "" ? group : undefined,
  };
}

export const playlistAdapter: HubAdapter = {
  id: "playlist",
  title: "M3U 播放列表",
  description: "解析 M3U/M3U8 频道或点播列表，支持多来源合并",
  async list(endpoint, ctx: AdapterContext) {
    const text = await fetchText(endpoint, ctx.limits, ctx.headers);
    return parseM3U(text).slice(0, ctx.limit).map(toItem);
  },
  async search(endpoint, keyword, ctx: AdapterContext) {
    const text = await fetchText(endpoint, ctx.limits, ctx.headers);
    const needle = keyword.trim().toLowerCase();
    if (needle === "") {
      return [];
    }
    return parseM3U(text)
      .filter(entry => entry.title.toLowerCase().includes(needle))
      .slice(0, ctx.limit)
      .map(toItem);
  },
};
