import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDownloadUrl,
  buildPosterUrl,
  parseArchiveSearch,
  pickVideoFile,
} from "../src/adapters/archive";
import { HubError } from "../src/errors";

describe("parseArchiveSearch", () => {
  it("解析 docs 并跳过坏条目", () => {
    const docs = parseArchiveSearch({
      response: {
        docs: [
          { identifier: "a", title: "影片 A", year: 1954, description: "简介" },
          { identifier: "", title: "缺 id" },
          { identifier: "b" },
          { identifier: "c", title: "影片 C" },
        ],
      },
    });
    expect(docs).toEqual([
      { identifier: "a", title: "影片 A", year: "1954", description: "简介" },
      {
        identifier: "c",
        title: "影片 C",
        year: undefined,
        description: undefined,
      },
    ]);
  });

  it("结构不对时报 INVALID_PAYLOAD", () => {
    for (const payload of [
      null,
      {},
      { response: {} },
      { response: { docs: "x" } },
    ]) {
      try {
        parseArchiveSearch(payload);
        throw new Error("应当抛出");
      } catch (error) {
        expect((error as HubError).code).toBe("INVALID_PAYLOAD");
      }
    }
  });
});

describe("pickVideoFile", () => {
  it("优先 h.264，其次 512Kb MPEG4，再其次其它容器", () => {
    const files = [
      { name: "a.ogv", format: "Ogg Video" },
      { name: "a_512kb.mp4", format: "512Kb MPEG4" },
      { name: "a.mp4", format: "h.264" },
    ];
    expect(pickVideoFile(files)?.name).toBe("a.mp4");
    expect(pickVideoFile(files.slice(0, 2))?.name).toBe("a_512kb.mp4");
    expect(pickVideoFile(files.slice(0, 1))?.name).toBe("a.ogv");
  });

  it("没有视频文件或结构不对返回 null", () => {
    expect(pickVideoFile([{ name: "a.txt", format: "Text" }])).toBeNull();
    expect(pickVideoFile([])).toBeNull();
    expect(pickVideoFile(null)).toBeNull();
    expect(pickVideoFile({})).toBeNull();
  });

  it("忽略非对象条目", () => {
    expect(
      pickVideoFile([null, 3, { name: "x.mp4", format: "h.264" }])?.name
    ).toBe("x.mp4");
  });
});

describe("URL 构造", () => {
  it("转义标识与文件名", () => {
    expect(buildDownloadUrl("movie 1", "sub/dir/movie 1.mp4")).toBe(
      "https://archive.org/download/movie%201/sub/dir/movie%201.mp4"
    );
    expect(buildPosterUrl("movie 1")).toBe(
      "https://archive.org/services/img/movie%201"
    );
  });
});

describe("archive 适配器", () => {
  const searchPayload = {
    response: {
      docs: [
        { identifier: "has-video", title: "有视频", year: 1954 },
        { identifier: "no-video", title: "只有元数据" },
      ],
    },
  };

  let get: ReturnType<typeof vi.fn>;
  const cacheStore = new Map<string, unknown>();

  beforeEach(() => {
    get = vi.fn(async (url: string) => {
      if (url.includes("/advancedsearch.php")) {
        return { data: searchPayload, statusCode: 200, headers: {} };
      }
      if (url.endsWith("/metadata/has-video")) {
        return {
          data: {
            files: [
              { name: "has-video_512kb.mp4", format: "512Kb MPEG4" },
              { name: "has-video.mp4", format: "h.264" },
            ],
          },
          statusCode: 200,
          headers: {},
        };
      }
      return {
        data: { files: [{ name: "cover.jpg", format: "JPEG" }] },
        statusCode: 200,
        headers: {},
      };
    });
    vi.stubGlobal("Widget", {
      http: { get },
      sharedCache: {
        get: (namespace: string, key: string) =>
          cacheStore.get(`${namespace}/${key}`) ?? null,
        set: (namespace: string, key: string, value: unknown) => {
          cacheStore.set(`${namespace}/${key}`, value);
        },
      },
    });
    cacheStore.clear();
  });

  it("默认检索限定在经典影片合集", async () => {
    const { archiveAdapter, DEFAULT_ARCHIVE_QUERY } =
      await import("../src/adapters/archive");
    await archiveAdapter.list("", {
      limits: {
        timeoutMs: 1000,
        maxBytes: 1024 * 1024,
        allowPrivateHost: true,
      },
      limit: 1,
      headers: {},
    });
    const url = String(get.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("advancedsearch.php");
    expect(decodeURIComponent(url)).toContain(DEFAULT_ARCHIVE_QUERY);
    expect(DEFAULT_ARCHIVE_QUERY).toContain("silent_films");
  });

  it("搜索 + 逐条探测，跳过没有视频的条目", async () => {
    const { archiveAdapter } = await import("../src/adapters/archive");
    const items = await archiveAdapter.list("", {
      limits: {
        timeoutMs: 1000,
        maxBytes: 1024 * 1024,
        allowPrivateHost: true,
      },
      limit: 10,
      headers: {},
      cache: { ttlSeconds: 0, namespace: "test" },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "https://archive.org/download/has-video/has-video.mp4",
      title: "有视频",
      type: "movie",
      group: "公共领域",
      year: "1954",
    });
    // 命中 h.264 而不是 512Kb
    expect(items[0]?.url).toContain("has-video.mp4");
  });

  it("打开缓存后第二次不再请求文件清单", async () => {
    const { archiveAdapter } = await import("../src/adapters/archive");
    const ctx = {
      limits: {
        timeoutMs: 1000,
        maxBytes: 1024 * 1024,
        allowPrivateHost: true,
      },
      limit: 10,
      headers: {},
      cache: { ttlSeconds: 600, namespace: "test" },
    };
    await archiveAdapter.list("", ctx);
    const callsAfterFirst = get.mock.calls.length;
    await archiveAdapter.list("", ctx);
    expect(get.mock.calls.length).toBe(callsAfterFirst);
  });

  it("单个条目探测失败不影响其它条目", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.includes("/advancedsearch.php")) {
        return { data: searchPayload, statusCode: 200, headers: {} };
      }
      if (url.endsWith("/metadata/has-video")) {
        throw new Error("boom");
      }
      return { data: { files: [] }, statusCode: 200, headers: {} };
    });
    const { archiveAdapter } = await import("../src/adapters/archive");
    const items = await archiveAdapter.list("", {
      limits: { timeoutMs: 1000, maxBytes: 1024, allowPrivateHost: true },
      limit: 10,
      headers: {},
    });
    expect(items).toEqual([]);
  });
});
