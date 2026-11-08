import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config";
import type { HubConfig } from "../src/config";
import { resolveEndpoints } from "../src/hub";
import {
  DEFAULT_PRESET,
  PRESETS,
  presetEndpoints,
  presetOptions,
} from "../src/presets";
import { HubError } from "../src/errors";

const configOf = (params: Record<string, unknown>): HubConfig =>
  readConfig(params, "playlist");

describe("内置预设", () => {
  it("custom 不注入地址", () => {
    expect(presetEndpoints(DEFAULT_PRESET)).toEqual([]);
    expect(presetEndpoints(undefined)).toEqual([]);
    expect(presetEndpoints("unknown")).toEqual([]);
  });

  it("公开频道预设给出 iptv-org 地址", () => {
    for (const preset of PRESETS.filter(item => item.id !== DEFAULT_PRESET)) {
      const endpoints = presetEndpoints(preset.id);
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]).toMatch(/^https:\/\//);
    }
    expect(presetEndpoints("iptv-cn")[0]).toContain("/countries/cn.m3u");
  });

  it("选项覆盖全部预设", () => {
    expect(presetOptions().map(option => option.value)).toEqual(
      PRESETS.map(preset => preset.id)
    );
  });
});

describe("resolveEndpoints", () => {
  it("预设与手填地址合并去重", () => {
    const config = configOf({
      preset: "iptv-cn",
      endpoint:
        "https://iptv-org.github.io/iptv/countries/cn.m3u\nhttps://example.com/a.m3u",
    });
    const endpoints = resolveEndpoints(config, "playlist", true);
    expect(endpoints.map(entry => entry.url)).toEqual([
      "https://iptv-org.github.io/iptv/countries/cn.m3u",
      "https://example.com/a.m3u",
    ]);
    expect(endpoints[0]?.name).toBe("iptv-org.github.io");
  });

  it("需要地址但什么都没填时报 MISSING_ENDPOINT", () => {
    try {
      resolveEndpoints(configOf({}), "playlist", true);
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as HubError).code).toBe("MISSING_ENDPOINT");
    }
  });

  it("内置检索的来源允许无地址", () => {
    expect(resolveEndpoints(configOf({}), "archive", false)).toEqual([
      { name: "archive", url: "" },
    ]);
  });

  it("最多保留 8 个来源", () => {
    const raw = Array.from(
      { length: 12 },
      (_, index) => `https://h${index}.example.com/a.m3u`
    ).join("\n");
    const endpoints = resolveEndpoints(
      configOf({ endpoint: raw }),
      "playlist",
      true
    );
    expect(endpoints).toHaveLength(8);
  });
});
