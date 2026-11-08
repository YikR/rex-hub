import { beforeEach, describe, expect, it, vi } from "vitest";
import { HubError } from "../src/errors";
import {
  assertAllowedUrl,
  fetchJson,
  fetchText,
  isBlockedHost,
  isPrivateHost,
} from "../src/http";

const limits = { timeoutMs: 50, maxBytes: 64, allowPrivateHost: true };

let get: ReturnType<typeof vi.fn>;

beforeEach(() => {
  get = vi.fn();
  vi.stubGlobal("Widget", { http: { get } });
});

describe("assertAllowedUrl", () => {
  it("允许 http/https", () => {
    expect(assertAllowedUrl("https://example.com/a.m3u", limits).hostname).toBe(
      "example.com"
    );
    expect(assertAllowedUrl("http://example.com/a.m3u", limits).protocol).toBe(
      "http:"
    );
  });

  it("拒绝非 http 协议", () => {
    for (const url of [
      "file:///etc/passwd",
      "data:text/plain,hi",
      "javascript:alert(1)",
    ]) {
      try {
        assertAllowedUrl(url, limits);
        throw new Error("应当抛出");
      } catch (error) {
        expect((error as HubError).code).toBe("BLOCKED_PROTOCOL");
      }
    }
  });

  it("永久拒绝云元数据地址", () => {
    expect(isBlockedHost("169.254.169.254")).toBe(true);
    expect(isBlockedHost("metadata.google.internal")).toBe(true);
    try {
      assertAllowedUrl("http://169.254.169.254/latest/meta-data/", limits);
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as HubError).code).toBe("BLOCKED_HOST");
    }
  });

  it("私有网段可配置", () => {
    expect(isPrivateHost("192.168.1.10")).toBe(true);
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("cdn.example.com")).toBe(false);
    try {
      assertAllowedUrl("http://192.168.1.10/a.m3u", {
        ...limits,
        allowPrivateHost: false,
      });
      throw new Error("应当抛出");
    } catch (error) {
      expect((error as HubError).code).toBe("BLOCKED_HOST");
    }
    expect(assertAllowedUrl("http://192.168.1.10/a.m3u", limits).hostname).toBe(
      "192.168.1.10"
    );
  });

  it("拒绝内联凭据", () => {
    expect(() =>
      assertAllowedUrl("https://user:pass@example.com/a", limits)
    ).toThrowError(HubError);
  });
});

describe("fetchText", () => {
  it("返回文本", async () => {
    get.mockResolvedValue({ data: "#EXTM3U", statusCode: 200, headers: {} });
    await expect(fetchText("https://example.com/a.m3u", limits)).resolves.toBe(
      "#EXTM3U"
    );
  });

  it("对象响应序列化为 JSON 文本", async () => {
    get.mockResolvedValue({ data: { a: 1 }, statusCode: 200, headers: {} });
    await expect(fetchText("https://example.com/a.json", limits)).resolves.toBe(
      '{"a":1}'
    );
  });

  it("拒绝重定向与错误状态", async () => {
    get.mockResolvedValue({ data: "", statusCode: 302, headers: {} });
    await expect(
      fetchText("https://example.com/a", limits)
    ).rejects.toMatchObject({ code: "HTTP_STATUS" });
    get.mockResolvedValue({ data: "", statusCode: 500, headers: {} });
    await expect(
      fetchText("https://example.com/a", limits)
    ).rejects.toMatchObject({ code: "HTTP_STATUS" });
  });

  it("拒绝超长响应", async () => {
    get.mockResolvedValue({
      data: "x".repeat(200),
      statusCode: 200,
      headers: {},
    });
    await expect(
      fetchText("https://example.com/a", limits)
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("超时返回 TIMEOUT", async () => {
    get.mockReturnValue(new Promise(() => {}));
    await expect(
      fetchText("https://example.com/a", { ...limits, timeoutMs: 10 })
    ).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });
});

describe("fetchJson", () => {
  it("解析 JSON 文本", async () => {
    get.mockResolvedValue({
      data: '{"version":1,"items":[]}',
      statusCode: 200,
      headers: {},
    });
    await expect(
      fetchJson("https://example.com/a.json", limits)
    ).resolves.toEqual({ version: 1, items: [] });
  });

  it("非法 JSON 报 INVALID_PAYLOAD", async () => {
    get.mockResolvedValue({
      data: "<html></html>",
      statusCode: 200,
      headers: {},
    });
    await expect(
      fetchJson("https://example.com/a.json", limits)
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });
});
