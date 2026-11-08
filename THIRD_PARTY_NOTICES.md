# 第三方归属与许可

本仓库的**运行时产物 `dist/index.js` 不包含任何第三方代码**——它是本仓库 `src/` 的完整构建结果，
没有任何运行时依赖（`npm audit --omit=dev` 为 0 漏洞，产物中也检索不到第三方包标识）。

以下依赖仅在开发、测试与构建阶段使用，全部为 MIT 许可证，均未修改其源码。

## 构建期 / 测试期依赖

| 包                                                                           | 版本    | 许可证     | 版权                                               | 用途                                                    |
| ---------------------------------------------------------------------------- | ------- | ---------- | -------------------------------------------------- | ------------------------------------------------------- |
| [`@rexnow/libs`](https://www.npmjs.com/package/@rexnow/libs)                 | 3.1.3   | MIT        | Copyright (c) 2025 Baran                           | Widget 类型定义 + 测试适配器 `WidgetAdaptor`            |
| [`@rexnow/rslib-plugin`](https://www.npmjs.com/package/@rexnow/rslib-plugin) | 3.1.3   | MIT        | Copyright (c) 2025 Baran                           | 构建插件：移除 ESM 导出、生成参数类型、可选 REXENC 加密 |
| [`@rslib/core`](https://www.npmjs.com/package/@rslib/core)                   | 1.0.6   | MIT        | Copyright (c) 2023-present ByteDance               | 打包器                                                  |
| [`typescript`](https://www.npmjs.com/package/typescript)                     | 5.9.3   | Apache-2.0 | Copyright (c) Microsoft Corporation                | 类型检查                                                |
| [`vitest`](https://www.npmjs.com/package/vitest)                             | 5.1.0   | MIT        | Copyright (c) 2021-present Anthony Fu              | 测试运行器                                              |
| [`prettier`](https://www.npmjs.com/package/prettier)                         | 3.9.10  | MIT        | Copyright (c) James Long and contributors          | 格式化                                                  |
| [`eslint`](https://www.npmjs.com/package/eslint)                             | 10.14.0 | MIT        | Copyright OpenJS Foundation and other contributors | 静态分析                                                |
| [`@eslint/js`](https://www.npmjs.com/package/@eslint/js)                     | 10.0.1  | MIT        | Copyright OpenJS Foundation and other contributors | ESLint 推荐规则                                         |
| [`typescript-eslint`](https://www.npmjs.com/package/typescript-eslint)       | 8.72.1  | MIT        | Copyright (c) 2019 typescript-eslint contributors  | TS 规则与解析器                                         |
| [`globals`](https://www.npmjs.com/package/globals)                           | 17.14.0 | MIT        | Copyright (c) Sindre Sorhus                        | 环境全局变量声明                                        |
| [`@types/node`](https://www.npmjs.com/package/@types/node)                   | 22.20.5 | MIT        | Copyright (c) DefinitelyTyped contributors         | Node 类型                                               |

上游项目主页：<https://github.com/baranwang/rex-widget-libs>（MIT，Copyright (c) 2025 Baran）。

`package.json` 里的 `overrides: { "minimatch": "^11.0.1" }` 用于消除构建期依赖链
（eslint / ts-morph）中的 [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)，
升级后 `npm run verify` 全部通过，`npm audit` 为 0 漏洞。

## 明确**未**引入的第三方代码

生态中多数 Rex 模块仓库没有声明任何许可证（`license: null`），部分产物还是 REXENC 密文。
按照「不复制不具备合法再分发权限的代码」的原则，这些仓库只作为**来源地址**或**契约参考**出现在
[`catalog/sources.json`](../catalog/sources.json) 与 [docs/candidates.md](../docs/candidates.md) 中，
本仓库不包含其中任何一行代码、图标或配置。筛选结论与依据见 [docs/candidates.md](../docs/candidates.md)。

## 数据来源（不是代码）

| 来源                                              | 用途                              | 说明                                                                                                                                          |
| ------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Internet Archive](https://archive.org)           | `source=archive` 的检索与文件清单 | 通过官方公开 API（`advancedsearch.php`、`metadata/`、`download/`）访问；条目的授权状态由 archive.org 标注，模块只做展示与直链跳转，不代理内容 |
| [iptv-org/iptv](https://github.com/iptv-org/iptv) | `preset=iptv-*` 的公开频道索引    | 索引里的流地址由各频道方公开提供；是否可播放与观看权归频道方，模块不转码、不缓存媒体                                                          |

这两者都不提供代码，因此不涉及再分发授权；使用它们时请遵守其站点条款。

## 协议与规范的归属

- `rex-hub/1` JSON 目录协议由本仓库定义并维护（见 [docs/json-feed.md](../docs/json-feed.md)）。
- M3U/M3U8 是公开的播放列表事实标准，本仓库的实现为独立编写。
- `REXENC` 是 Rex 模块的加密封装格式；本仓库只做**结构校验**，不做解密（见 [SECURITY.md](../SECURITY.md)）。

## 商标

「Rex」「REX」等名称与标识归其权利人所有。本仓库是第三方集成项目，与 Rex Studio 无隶属关系，
不使用其图标或品牌素材。
