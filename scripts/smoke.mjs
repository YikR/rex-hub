#!/usr/bin/env node
/**
 * 构建产物冒烟检查（不联网、不执行第三方代码）。
 *
 * 目的：证明 `dist/index.js` 是 Rex 宿主可直接求值的普通脚本——
 * 没有 ESM 导出、顶层函数成为全局、`WidgetMetadata` 可读，且入口函数能返回结构化结果。
 */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const DIST = new URL("../dist/index.js", import.meta.url);
const source = readFileSync(DIST, "utf8");

if (/^\s*(?:export|import)\s/m.test(source)) {
  console.error("✗ 产物仍包含 ESM 语句，Rex 无法直接加载");
  process.exit(1);
}

const sandbox = {
  console: { warn() {}, log() {}, error() {} },
  Widget: {
    http: { get: async () => ({ data: "", statusCode: 200, headers: {} }) },
  },
  // 宿主提供的 Web 标准内置对象（Rex 运行在带 URL / TextEncoder 的 JS 引擎里）
  URL,
  URLSearchParams,
  TextEncoder,
  setTimeout,
  clearTimeout,
};
sandbox.globalThis = sandbox;

runInContext(source, createContext(sandbox), { filename: "dist/index.js" });

const failures = [];
const metadata = sandbox.WidgetMetadata;
if (!metadata || metadata.id !== "rex-hub") {
  failures.push("WidgetMetadata 未注册或 id 不正确");
} else {
  if (!Array.isArray(metadata.modules) || metadata.modules.length !== 4) {
    failures.push("modules 数量不是 4");
  }
  for (const module of metadata.modules ?? []) {
    if (typeof sandbox[module.functionName] !== "function") {
      failures.push(`宿主将无法解析 functionName=${module.functionName}`);
    }
  }
}

const stream = await sandbox.loadResource({
  videoUrl: "https://cdn.example.com/a.m3u8",
});
if (
  !Array.isArray(stream) ||
  stream[0]?.url !== "https://cdn.example.com/a.m3u8"
) {
  failures.push("loadResource 未返回直连地址");
}

if (failures.length > 0) {
  console.error(`✗ 冒烟检查失败：\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}

console.log(
  `✓ 产物可被宿主求值（${(source.length / 1024).toFixed(1)} KiB），全局与函数解析正常`
);
