import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/adapters/jsonfeed";
import { HubError } from "../src/errors";

const feed = (items: unknown[]) => ({ version: 1, name: "测试", items });

describe("parseFeed", () => {
  it("解析基础条目并保留可选字段", () => {
    const items = parseFeed(
      feed([
        {
          title: "示例影片",
          type: "movie",
          url: "https://cdn.example.com/a.m3u8",
          poster: "https://cdn.example.com/a.jpg",
          year: 2024,
          group: "电影",
          subtitles: [
            {
              title: "简体中文",
              lang: "zh",
              url: "https://cdn.example.com/a.zh.vtt",
            },
          ],
        },
      ])
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "https://cdn.example.com/a.m3u8",
      title: "示例影片",
      type: "movie",
      url: "https://cdn.example.com/a.m3u8",
      year: "2024",
      group: "电影",
    });
    expect(items[0]?.subtitles?.[0]?.lang).toBe("zh");
  });

  it("把剧集展开成多条", () => {
    const items = parseFeed(
      feed([
        {
          title: "示例剧",
          type: "tv",
          url: "https://cdn.example.com/show.m3u8",
          episodes: [
            { title: "第 1 集", url: "https://cdn.example.com/e1.m3u8" },
            { url: "https://cdn.example.com/e2.m3u8" },
          ],
        },
      ])
    );
    expect(items.map(item => item.title)).toEqual([
      "示例剧 · 第 1 集",
      "示例剧 · 第 2 集",
    ]);
    expect(items.every(item => item.type === "tv")).toBe(true);
  });

  it("跳过缺字段或非 http 地址的条目", () => {
    const items = parseFeed(
      feed([
        { title: "", url: "https://cdn.example.com/a.m3u8" },
        { title: "无地址" },
        { title: "非 http", url: "file:///etc/passwd" },
        { title: "合法", url: "https://cdn.example.com/ok.m3u8" },
      ])
    );
    expect(items.map(item => item.title)).toEqual(["合法"]);
  });

  it("拒绝不支持的协议版本", () => {
    try {
      parseFeed({ version: 2, items: [] });
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as HubError).code).toBe("INVALID_PAYLOAD");
    }
  });

  it("拒绝非对象与缺少 items", () => {
    expect(() => parseFeed("text")).toThrowError(HubError);
    expect(() => parseFeed({ version: 1 })).toThrowError(HubError);
  });
});
