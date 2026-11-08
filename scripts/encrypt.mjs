#!/usr/bin/env node
/**
 * 生成 / 校验 REXENC 加密产物。
 *
 * 背景：Rex 客户端导入时只接受 **REXENC 密文**（或 `.rex` 集合清单），直接喂明文脚本会报
 * 「添加失败：无法识别的模块数据」。加密由 Rex 官方服务完成，与 https://rexnow.tv/encrypt/
 * 以及 `@rexnow/rslib-plugin` 的 `encrypt` 选项是同一个接口：
 *
 *   POST https://api.rexnow.tv/api/widgets/encrypt   (Content-Type: text/plain; charset=utf-8)
 *   → "REXENC" / JSON 头 / Base64 密文   三行
 *
 * 注意：执行 `node scripts/encrypt.mjs` 会把 `dist/index.js` 的**源码**发送到 rexnow.tv。
 * 本仓库源码是公开的，所以这是可接受的；如果你在其中放了私有逻辑，请先自行权衡。
 *
 * 用法：
 *   node scripts/encrypt.mjs                       # 加密 dist/index.js → dist/index.rex.js
 *   node scripts/encrypt.mjs --check               # 只校验 dist/index.rex.js（离线）
 *   node scripts/encrypt.mjs --in a.js --out b.js  # 加密任意文件（诊断/探针用）
 *   node scripts/encrypt.mjs --check --out b.js    # 校验任意产物（离线）
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const argValue = flag => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const resolvePath = value => (value ? join(ROOT, value) : undefined);

const SOURCE_PATH =
  resolvePath(argValue("--in")) ?? join(ROOT, "dist/index.js");
const OUTPUT_PATH =
  resolvePath(argValue("--out")) ?? join(ROOT, "dist/index.rex.js");
const ENDPOINT = "https://api.rexnow.tv/api/widgets/encrypt";
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 150_000;

/** 与官方加密页 / rslib-plugin 完全一致的封装校验。 */
export function validateEnvelope(text) {
  const lines = text.split("\n");
  if (lines.length !== 3 || lines[0] !== "REXENC") {
    throw new Error("封装格式不对：需要 3 行且首行为 REXENC");
  }
  const header = JSON.parse(lines[1] ?? "");
  const payload = Buffer.from((lines[2] ?? "").trim(), "base64");
  if (header.v !== 2 || header.mkv !== "rex-1" || header.alg !== "A256GCM") {
    throw new Error(`不支持的封装参数：${JSON.stringify(header)}`);
  }
  if (Buffer.from(header.iv ?? "", "base64").length !== 12) {
    throw new Error("iv 长度不是 12 字节");
  }
  if (Buffer.from(header.kb ?? "", "base64").length !== 60) {
    throw new Error("kb 长度不是 60 字节");
  }
  if (payload.length <= 16) {
    throw new Error("密文过短");
  }
  return { header, payloadBytes: payload.length };
}

async function check() {
  const text = await readFile(OUTPUT_PATH, "utf8");
  const { payloadBytes } = validateEnvelope(text);
  const name = OUTPUT_PATH.split("/").pop();
  console.log(
    `✓ ${name} 封装有效（密文 ${(payloadBytes / 1024).toFixed(1)} KiB，共 ${(text.length / 1024).toFixed(1)} KiB）`
  );
}

async function encrypt() {
  const source = await readFile(SOURCE_PATH, "utf8");
  const bytes = Buffer.byteLength(source);
  if (bytes > MAX_BYTES) {
    throw new Error(`源码 ${bytes} 字节，超过服务上限 ${MAX_BYTES}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: source,
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`加密服务返回 HTTP ${response.status}`);
  }
  const output = await response.text();
  const { payloadBytes } = validateEnvelope(output);
  await writeFile(OUTPUT_PATH, output, "utf8");
  console.log(
    `✓ 已生成 ${OUTPUT_PATH.split("/").pop()}（源码 ${(bytes / 1024).toFixed(1)} KiB → 密文 ${(payloadBytes / 1024).toFixed(1)} KiB）`
  );
}

if (argv.includes("--check")) {
  await check();
} else {
  await encrypt();
}
