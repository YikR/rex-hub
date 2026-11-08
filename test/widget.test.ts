import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HUB_ID } from "../src/metadata";

const M3U = `#EXTM3U
#EXTINF:-1 tvg-logo="https://img.example.com/1.png" group-title="央视",CCTV-1
https://cdn.example.com/cctv1.m3u8
#EXTINF:-1 group-title="卫视",湖南卫视
https://cdn.example.com/hunan.m3u8
`;

const FEED = {
  version: 1,
  name: "测试目录",
  items: [
    {
      title: "示例影片",
      type: "movie",
      url: "https://cdn.example.com/movie.m3u8",
      subtitles: [
        {
          title: "简体中文",
          lang: "zh",
          url: "https://cdn.example.com/movie.zh.vtt",
        },
      ],
    },
  ],
};

type HubModule = typeof import("../src/index");
let mod: HubModule;

beforeAll(async () => {
  const { WidgetAdaptor } = await import("@rexnow/libs/widget-adaptor");
  vi.stubGlobal("Widget", WidgetAdaptor);
  vi.stubGlobal("WidgetMetadata", undefined);
  mod = await import("../src/index");
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith(".json")) {
        return new Response(JSON.stringify(FEED), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(M3U, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    })
  );
});

describe("WidgetMetadata 注册", () => {
  it("挂到全局并提供 4 个模块", () => {
    const metadata = (
      globalThis as unknown as { WidgetMetadata: WidgetMetadata }
    ).WidgetMetadata;
    expect(metadata.id).toBe(HUB_ID);
    expect(metadata.modules).toHaveLength(4);
    expect(metadata.modules.map(entry => entry.functionName)).toEqual([
      "hubList",
      "hubSearch",
      "loadResource",
      "loadSubtitle",
    ]);
  });
});

describe("hubList", () => {
  it("把 M3U 列表转换成可播放条目", async () => {
    const items = await mod.hubList({
      source: "playlist",
      endpoint: "https://a.example.com/list.m3u",
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: "url",
      title: "CCTV-1",
      videoUrl: "https://cdn.example.com/cctv1.m3u8",
      link: "https://cdn.example.com/cctv1.m3u8",
      genreTitle: "央视",
      posterPath: "https://img.example.com/1.png",
    });
  });

  it("合并多个来源并补齐来源名", async () => {
    const items = await mod.hubList({
      source: "playlist",
      endpoint:
        "客厅=https://a.example.com/list.m3u\nhttps://b.example.com/list.m3u",
    });
    expect(items).toHaveLength(2);
    expect(items.every(entry => entry.genreTitle !== undefined)).toBe(true);
  });

  it("未配置地址时降级为空列表并告警", async () => {
    const items = await mod.hubList({ source: "playlist" });
    expect(items).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });

  it("未知来源类型时降级为空列表", async () => {
    const items = await mod.hubList({
      source: "nope",
      endpoint: "https://a.example.com/list.m3u",
    });
    expect(items).toEqual([]);
  });

  it("上游 500 时降级为空列表", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 }))
    );
    await expect(
      mod.hubList({
        source: "playlist",
        endpoint: "https://a.example.com/list.m3u",
      })
    ).resolves.toEqual([]);
  });
});

describe("hubSearch", () => {
  it("按标题过滤", async () => {
    const items = await mod.hubSearch({
      source: "playlist",
      endpoint: "https://a.example.com/list.m3u",
      keyword: "湖南",
    });
    expect(items.map(entry => entry.title)).toEqual(["湖南卫视"]);
  });

  it("空关键词返回空列表", async () => {
    const items = await mod.hubSearch({
      source: "playlist",
      endpoint: "https://a.example.com/list.m3u",
      keyword: "  ",
    });
    expect(items).toEqual([]);
  });
});

describe("loadResource", () => {
  it("返回直连地址", async () => {
    await expect(
      mod.loadResource({ videoUrl: "https://cdn.example.com/cctv1.m3u8" })
    ).resolves.toEqual([
      { name: "直连", url: "https://cdn.example.com/cctv1.m3u8" },
    ]);
  });

  it("拒绝非 http 协议", async () => {
    await expect(
      mod.loadResource({ videoUrl: "file:///etc/passwd" })
    ).resolves.toEqual([]);
  });

  it("缺少地址时降级为空列表", async () => {
    await expect(mod.loadResource({})).resolves.toEqual([]);
  });
});

describe("archive 来源（默认免配置）", () => {
  const stubArchive = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/advancedsearch.php")) {
          return new Response(
            JSON.stringify({
              response: {
                docs: [
                  {
                    identifier: "demo-film",
                    title: "公共领域影片",
                    year: 1954,
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            files: [{ name: "demo-film.mp4", format: "h.264" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

  it("不填任何配置也能列出条目", async () => {
    stubArchive();
    const items = await mod.hubList({ cacheTtl: "0", limit: "5" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "公共领域影片",
      mediaType: "movie",
      genreTitle: "公共领域",
      videoUrl: "https://archive.org/download/demo-film/demo-film.mp4",
    });
  });

  it("检索条件与关键词都能透传", async () => {
    stubArchive();
    const items = await mod.hubSearch({
      keyword: "Chaplin",
      cacheTtl: "0",
      query: "collection:(silent_films)",
    });
    expect(items).toHaveLength(1);
  });
});

describe("loadSubtitle", () => {
  it("从 JSON 目录读取字幕", async () => {
    const items = await mod.loadSubtitle({
      source: "feed",
      endpoint: "https://a.example.com/catalog.json",
      title: "示例影片",
    });
    expect(items).toEqual([
      {
        id: "hub-sub-0",
        title: "简体中文",
        lang: "zh",
        count: 1,
        url: "https://cdn.example.com/movie.zh.vtt",
      },
    ]);
  });

  it("M3U 来源没有字幕", async () => {
    const items = await mod.loadSubtitle({
      source: "playlist",
      endpoint: "https://a.example.com/list.m3u",
      title: "CCTV-1",
    });
    expect(items).toEqual([]);
  });
});
