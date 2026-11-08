import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  parseEndpoints,
  parseHeaders,
  readConfig,
} from "../src/config";
import { HubError } from "../src/errors";

describe("parseEndpoints", () => {
  it("支持一行一个地址并默认用主机名命名", () => {
    expect(
      parseEndpoints(
        "https://a.example.com/list.m3u\nhttps://b.example.com/list.m3u"
      )
    ).toEqual([
      { name: "a.example.com", url: "https://a.example.com/list.m3u" },
      { name: "b.example.com", url: "https://b.example.com/list.m3u" },
    ]);
  });

  it("支持「名称=地址」形式并忽略空行与注释", () => {
    const parsed = parseEndpoints(
      "# 注释\n\n客厅=https://media.example.com/tv.m3u\n"
    );
    expect(parsed).toEqual([
      { name: "客厅", url: "https://media.example.com/tv.m3u" },
    ]);
  });

  it("去重且限制数量", () => {
    const raw = Array.from(
      { length: 12 },
      (_, index) => `https://h${index}.example.com/a.m3u`
    ).join("\n");
    expect(parseEndpoints(raw)).toHaveLength(DEFAULTS.maxEndpoints);
    expect(
      parseEndpoints("https://x.example.com/a.m3u\nhttps://x.example.com/a.m3u")
    ).toHaveLength(1);
  });

  it("非法地址报 INVALID_CONFIG", () => {
    try {
      parseEndpoints("not a url");
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as HubError).code).toBe("INVALID_CONFIG");
    }
  });

  it("空配置返回空列表", () => {
    expect(parseEndpoints(undefined)).toEqual([]);
    expect(parseEndpoints("   ")).toEqual([]);
  });
});

describe("parseHeaders", () => {
  it("接受 JSON 对象", () => {
    expect(parseHeaders('{"Authorization":"Bearer abc"}')).toEqual({
      Authorization: "Bearer abc",
    });
  });

  it("拒绝非对象与非法名称", () => {
    expect(() => parseHeaders("[]")).toThrowError(HubError);
    expect(() => parseHeaders('{"Bad Header":"x"}')).toThrowError(HubError);
  });

  it("拒绝 CRLF 注入", () => {
    try {
      parseHeaders('{"X-Test":"a\\r\\nX-Injected: 1"}');
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as HubError).code).toBe("INVALID_CONFIG");
    }
  });

  it("空值返回空对象", () => {
    expect(parseHeaders(undefined)).toEqual({});
  });
});

describe("readConfig", () => {
  it("使用默认值并夹紧范围", () => {
    const config = readConfig({ limit: "9999", timeout: "10" }, "playlist");
    expect(config.limit).toBe(200);
    expect(config.timeoutMs).toBe(1000);
    expect(config.allowPrivateHost).toBe(true);
    expect(config.source).toBe("playlist");
    expect(config.endpoints).toEqual([]);
  });

  it("显式关闭私有网段", () => {
    expect(
      readConfig({ allowPrivateHost: "false" }, "feed").allowPrivateHost
    ).toBe(false);
  });

  it("数字参数非法时报错", () => {
    expect(() => readConfig({ limit: "abc" }, "feed")).toThrowError(HubError);
  });
});
