import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { buildMetadata, HUB_VERSION } from "../src/metadata";
import { ADAPTERS, DEFAULT_SOURCE, getAdapter } from "../src/registry";

const metadata = buildMetadata();

describe("metadata", () => {
  it("版本与 package.json 一致", () => {
    expect(HUB_VERSION).toBe(pkg.version);
    expect(metadata.version).toBe(pkg.version);
  });

  it("模块 id 与 functionName 唯一", () => {
    const ids = metadata.modules.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      metadata.modules.some(entry => entry.functionName === "hubList")
    ).toBe(true);
    expect(
      metadata.modules.some(entry => entry.functionName === "hubSearch")
    ).toBe(true);
  });

  it("来源枚举来自注册表", () => {
    const source = metadata.globalParams?.find(
      param => param.name === "source"
    );
    expect(source?.type).toBe("enumeration");
    expect(source?.enumOptions?.map(option => option.value)).toEqual(
      ADAPTERS.map(adapter => adapter.id)
    );
    expect(source?.value).toBe(DEFAULT_SOURCE);
  });

  it("数值参数带默认值，避免宿主传入空串", () => {
    for (const name of ["limit", "timeout"]) {
      const param = metadata.globalParams?.find(entry => entry.name === name);
      expect(param?.type).toBe("count");
      expect(Number(param?.value)).toBeGreaterThan(0);
    }
  });

  it("stream 与 subtitle 模块类型正确", () => {
    const stream = metadata.modules.find(entry => entry.id === "loadResource");
    const subtitle = metadata.modules.find(
      entry => entry.id === "loadSubtitle"
    );
    expect(stream?.type).toBe("stream");
    expect(subtitle?.type).toBe("subtitle");
  });

  it("未知来源类型抛出 UNSUPPORTED_SOURCE", () => {
    expect(() => getAdapter("missing")).toThrowError(/未知来源类型/);
  });
});
