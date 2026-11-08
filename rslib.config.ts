import { pluginRexWidget } from "@rexnow/rslib-plugin";
import { defineConfig } from "@rslib/core";

/**
 * Rex Widget 构建配置。
 *
 * - 不压缩、不混淆：产物保持可审计，且避免顶层函数名被 mangle（宿主按名称解析函数）。
 * - `pluginRexWidget()` 负责移除 ESM 导出声明，让产物成为宿主可直接求值的脚本。
 * - 如需生成 REXENC 加密产物，把 `encrypt` 设为 true；该流程会将源码发送到
 *   https://rexnow.tv/encrypt/ 的服务，请在明确需要时再开启（见 SECURITY.md）。
 */
export default defineConfig({
  lib: [
    {
      format: "esm",
      syntax: "es2022",
      dts: false,
    },
  ],
  output: {
    target: "web",
    autoExternal: false,
    minify: false,
    sourceMap: false,
    // 不要清空 dist：dist/index.rex.js（加密产物）不是 rslib 生成的，需要保留
    cleanDistPath: false,
  },
  plugins: [pluginRexWidget({ encrypt: false })],
});
