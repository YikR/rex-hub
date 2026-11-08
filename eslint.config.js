import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "src/rex-widget-env.d.ts",
    ],
  },
  {
    ...js.configs.recommended,
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  ...tseslint.configs.recommended,
  {
    // 探针是宿主直接求值的脚本：WidgetMetadata / 函数名是宿主注入的全局与入口
    files: ["probe/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        WidgetMetadata: "writable",
        Widget: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // 模块需要把降级原因写到宿主控制台，这是唯一的外部诊断通道
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  }
);
