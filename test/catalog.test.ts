import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/adapters/jsonfeed";
import { parseM3U } from "../src/adapters/playlist";

const readJson = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../catalog/${name}`, import.meta.url), "utf8")
  ) as unknown;
const readText = (name: string) =>
  readFileSync(new URL(`../catalog/${name}`, import.meta.url), "utf8");

describe("catalog 示例与文档保持可解析", () => {
  it("example-feed.json 符合 rex-hub/1", () => {
    const items = parseFeed(readJson("example-feed.json"));
    expect(items).toHaveLength(3);
    expect(items[0]?.subtitles?.[0]?.lang).toBe("zh");
    expect(items.some(item => item.type === "tv")).toBe(true);
  });

  it("example.m3u 可被 playlist 适配器解析", () => {
    const entries = parseM3U(readText("example.m3u"));
    expect(entries).toHaveLength(2);
    expect(entries[0]?.attrs["group-title"]).toBe("演示");
  });
});

describe("catalog/sources.json 治理约束", () => {
  const catalog = readJson("sources.json") as {
    schema: string;
    criteria: string[];
    candidates: Array<Record<string, unknown>>;
  };

  it("schema 与字段齐全", () => {
    expect(catalog.schema).toBe("rex-hub/catalog@1");
    expect(catalog.criteria.length).toBeGreaterThan(0);
    for (const candidate of catalog.candidates) {
      for (const field of [
        "id",
        "name",
        "repo",
        "decision",
        "integration",
        "rationale",
      ]) {
        expect(candidate[field], `${candidate.id} 缺少 ${field}`).toBeTruthy();
      }
      expect(["adopt-dependency", "reference-only", "reject"]).toContain(
        candidate.decision
      );
    }
  });

  it("只有明确许可证的候选才允许被采纳为依赖", () => {
    for (const candidate of catalog.candidates) {
      if (candidate.decision === "adopt-dependency") {
        expect(candidate.licenseVerified).toBe(true);
        expect(typeof candidate.license).toBe("string");
      }
    }
  });

  it("未采纳的候选一律不复制代码", () => {
    for (const candidate of catalog.candidates) {
      if (candidate.decision !== "adopt-dependency") {
        expect(candidate.integration).not.toMatch(/vendor|copy|内联/);
      }
    }
  });

  it("id 唯一", () => {
    const ids = catalog.candidates.map(candidate => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
