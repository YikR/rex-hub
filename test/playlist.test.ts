import { describe, expect, it } from "vitest";
import { parseM3U } from "../src/adapters/playlist";
import type { HubError } from "../src/errors";

const SAMPLE = `#EXTM3U
#EXTINF:-1 tvg-id="cctv1" tvg-logo="https://img.example.com/cctv1.png" group-title="央视",CCTV-1 综合
https://cdn.example.com/cctv1.m3u8
#EXTINF:-1 group-title="卫视",湖南卫视
https://cdn.example.com/hunan.m3u8
`;

describe("parseM3U", () => {
  it("解析标题、地址与属性", () => {
    const entries = parseM3U(SAMPLE);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      title: "CCTV-1 综合",
      url: "https://cdn.example.com/cctv1.m3u8",
      attrs: {
        "tvg-id": "cctv1",
        "tvg-logo": "https://img.example.com/cctv1.png",
        "group-title": "央视",
      },
    });
    expect(entries[1]?.title).toBe("湖南卫视");
  });

  it("缺少 #EXTM3U 时拒绝解析", () => {
    try {
      parseM3U("https://cdn.example.com/a.m3u8");
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as HubError).code).toBe("INVALID_PAYLOAD");
    }
  });

  it("忽略无标题条目并用地址兜底", () => {
    const entries = parseM3U("#EXTM3U\nhttps://cdn.example.com/plain.m3u8\n");
    expect(entries[0]?.title).toBe("https://cdn.example.com/plain.m3u8");
  });

  it("跳过非法地址与非 http 协议", () => {
    const entries = parseM3U(
      "#EXTM3U\nfile:///etc/passwd\n#EXTINF:-1,A\nftp://x/y\n"
    );
    expect(entries).toEqual([]);
  });
});
