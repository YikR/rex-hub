import { describe, expect, it } from "vitest";
import type { CatalogItem } from "../src/adapters/types";
import { collectAcross } from "../src/aggregate";
import { HubError } from "../src/errors";

const ctx = {
  limits: { timeoutMs: 1000, maxBytes: 1024, allowPrivateHost: true },
  limit: 10,
  headers: {},
};

const item = (url: string, title = url, group?: string): CatalogItem => ({
  id: url,
  title,
  type: "tv",
  url,
  ...(group === undefined ? {} : { group }),
});

describe("collectAcross", () => {
  it("合并多个来源并保持声明顺序", async () => {
    const { items, failures } = await collectAcross(
      [
        { name: "A", url: "https://a.example.com/x" },
        { name: "B", url: "https://b.example.com/x" },
      ],
      ctx,
      async endpoint => [
        item(`${endpoint.url}-1`, `${endpoint.name}1`),
        item(`${endpoint.url}-2`, `${endpoint.name}2`),
      ]
    );
    expect(items.map(entry => entry.title)).toEqual(["A1", "A2", "B1", "B2"]);
    expect(failures).toEqual([]);
  });

  it("按类型+地址去重", async () => {
    const { items } = await collectAcross(
      [
        { name: "A", url: "https://a.example.com/x" },
        { name: "B", url: "https://b.example.com/x" },
      ],
      ctx,
      async () => [item("https://cdn.example.com/same.m3u8", "同名")]
    );
    expect(items).toHaveLength(1);
  });

  it("单个来源失败不影响其它来源", async () => {
    const { items, failures } = await collectAcross(
      [
        { name: "坏来源", url: "https://bad.example.com/x" },
        { name: "好来源", url: "https://ok.example.com/x" },
      ],
      ctx,
      async endpoint => {
        if (endpoint.name === "坏来源") {
          throw new HubError("TIMEOUT", "超时");
        }
        return [item("https://cdn.example.com/ok.m3u8", "可用")];
      }
    );
    expect(items.map(entry => entry.title)).toEqual(["可用"]);
    expect(failures).toEqual([
      { source: "坏来源", code: "TIMEOUT", message: "超时" },
    ]);
  });

  it("用来源名补齐缺失分组", async () => {
    const { items } = await collectAcross(
      [{ name: "客厅", url: "https://a.example.com/x" }],
      ctx,
      async () => [item("https://cdn.example.com/1.m3u8", "频道")]
    );
    expect(items[0]?.group).toBe("客厅");
  });

  it("尊重结果上限", async () => {
    const { items } = await collectAcross(
      [{ name: "A", url: "https://a.example.com/x" }],
      { ...ctx, limit: 2 },
      async () =>
        [1, 2, 3, 4].map(index => item(`https://cdn.example.com/${index}.m3u8`))
    );
    expect(items).toHaveLength(2);
  });

  it("空来源返回空结果", async () => {
    expect(await collectAcross([], ctx, async () => [])).toEqual({
      items: [],
      failures: [],
    });
  });
});
