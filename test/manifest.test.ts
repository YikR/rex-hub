import { readFileSync } from "node:fs";
import { parse } from "acorn";
import { describe, expect, it } from "vitest";
import { buildMetadata, HUB_ICON, HUB_VERSION } from "../src/metadata";

/**
 * 这组用例复刻 Rex 客户端的**静态解析**行为：
 * 客户端不执行模块脚本，只从源码里找唯一的顶层 `WidgetMetadata = { … }` 字面量。
 * 如果这里退化成 `WidgetMetadata = buildMetadata()`，导入就会报「无法识别的模块数据」。
 */
const dist = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
const ast = parse(dist, { ecmaVersion: "latest", sourceType: "script" });

type AnyNode = Record<string, any>;

function topLevelMetadata(): AnyNode[] {
  const found: AnyNode[] = [];
  for (const node of (ast as AnyNode).body as AnyNode[]) {
    if (
      node.type === "ExpressionStatement" &&
      node.expression?.type === "AssignmentExpression" &&
      node.expression.operator === "=" &&
      node.expression.left?.type === "Identifier" &&
      node.expression.left.name === "WidgetMetadata"
    ) {
      found.push(node.expression.right);
    }
  }
  return found;
}

/** 只允许字面量结构，确保客户端可以纯静态读取。 */
function toValue(node: AnyNode): unknown {
  switch (node.type) {
    case "ObjectExpression": {
      const object: Record<string, unknown> = {};
      for (const property of node.properties as AnyNode[]) {
        if (property.type !== "Property" || property.computed) {
          throw new Error(`不支持的属性：${property.type}`);
        }
        const key =
          property.key.type === "Identifier"
            ? property.key.name
            : property.key.value;
        object[key] = toValue(property.value);
      }
      return object;
    }
    case "ArrayExpression":
      return (node.elements as AnyNode[]).map(toValue);
    case "Literal":
      return node.value;
    default:
      throw new Error(`元数据含非字面量节点：${node.type}`);
  }
}

describe("构建产物可被 Rex 静态解析", () => {
  const matches = topLevelMetadata();

  it("存在唯一的顶层 WidgetMetadata 对象字面量", () => {
    expect(matches).toHaveLength(1);
    expect(matches[0]?.type).toBe("ObjectExpression");
  });

  it("全文只出现一处 WidgetMetadata 赋值（避免注释干扰客户端扫描）", () => {
    const occurrences = dist.match(/WidgetMetadata\s*=/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("元数据可纯静态求值，且与 buildMetadata() 完全一致", () => {
    const staticValue = toValue(matches[0] as AnyNode);
    expect(staticValue).toEqual(buildMetadata());
  });

  it("关键字段是字符串字面量（客户端据此展示标题/版本）", () => {
    const node = matches[0] as AnyNode;
    const fields = new Map<string, AnyNode>();
    for (const property of node.properties as AnyNode[]) {
      const key =
        property.key.type === "Identifier"
          ? property.key.name
          : property.key.value;
      fields.set(key, property.value);
    }
    for (const key of [
      "id",
      "title",
      "description",
      "author",
      "version",
      "requiredVersion",
      "icon",
    ]) {
      expect(fields.get(key)?.type, `${key} 必须是字面量`).toBe("Literal");
      expect(typeof fields.get(key)?.value).toBe("string");
    }
    expect(fields.get("version")?.value).toBe(HUB_VERSION);
    expect(fields.get("icon")?.value).toBe(HUB_ICON);
  });

  it("产物里没有 ESM 语句，且 functionName 都有对应的顶层函数", () => {
    expect(/^\s*(?:export|import)\s/m.test(dist)).toBe(false);
    const declared = new Set<string>();
    for (const node of (ast as AnyNode).body as AnyNode[]) {
      if (node.type === "FunctionDeclaration" && node.id?.name) {
        declared.add(node.id.name);
      }
    }
    const modules = (
      toValue(matches[0] as AnyNode) as {
        modules: Array<{ functionName: string }>;
      }
    ).modules;
    for (const module of modules) {
      expect(
        declared.has(module.functionName),
        `缺少 ${module.functionName}`
      ).toBe(true);
    }
  });
});

describe("集合清单 rex-hub.rex", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../rex-hub.rex", import.meta.url), "utf8")
  ) as {
    name: string;
    version?: string;
    widgets: Array<Record<string, string>>;
  };

  it("字段齐全且指向构建产物", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.widgets).toHaveLength(1);
    const widget = manifest.widgets[0] as Record<string, string>;
    expect(widget.url).toBe(
      "https://raw.githubusercontent.com/YikR/rex-hub/main/dist/index.rex.js"
    );
    expect(widget.id).toBe("rex-hub");
    expect(widget.requiredVersion).toBe("0.0.2");
  });

  it("加密产物存在且是合法的 REXENC 三行封装", () => {
    const encrypted = readFileSync(
      new URL("../dist/index.rex.js", import.meta.url),
      "utf8"
    );
    const lines = encrypted.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("REXENC");
    const header = JSON.parse(lines[1] as string);
    expect(header).toMatchObject({ v: 2, mkv: "rex-1", alg: "A256GCM" });
    expect(Buffer.from(header.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(header.kb, "base64")).toHaveLength(60);
    expect(
      Buffer.from((lines[2] as string).trim(), "base64").length
    ).toBeGreaterThan(16);
  });

  it("版本与包版本一致", () => {
    expect(manifest.version).toBe(HUB_VERSION);
    expect(manifest.widgets[0]?.version).toBe(HUB_VERSION);
  });
});
