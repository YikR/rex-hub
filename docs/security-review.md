# 安全审查报告

审查对象：Rex 模块生态 + 本仓库实现。审查日期：2026-11-08。
审查方式：静态阅读（仓库文件、`@rexnow` 工具链源码、明文示例模块）、GitHub API 元数据、
`npm audit`、以及对本仓库自身的测试与产物检查。**没有执行任何第三方模块代码。**

## 1. 上游生态的风险

### F1 REXENC 让第三方模块不可审计（高）

`REXENC` v2 的结构是 `REXENC` 头 + `{"v":2,"mkv":"rex-1","alg":"A256GCM","iv","kb"}` + Base64 密文。
密文依赖宿主/服务端的密钥才能还原：本仓库实测第三方在线解密服务
（`rex-decrypt.pages.dev` → `rex-decrypt.jsforbaby.workers.dev`）在当前状态下返回
`key-session 请求失败 (403)`，无法得到明文。

影响：候选模块（MANIA、nori、部分 FW 模块）都无法做静态审计，"安装即可信"只能靠作者声誉。
应对：**不把密文模块纳入依赖**；只把它们当作外部来源地址引用。加密只是混淆级保护，
官方文档也写明"加密不改变模块功能，也不能替代访问权限控制"。

### F2 生态普遍缺少许可证（高）

抽查的 6 个模块仓库 `license` 均为 `null`。默认版权保留 → 复制代码即侵权。
应对：见 [candidates.md](candidates.md)，只有 MIT 的工具链被采纳为依赖；其余仅引用。

### F3 模块能力等同宿主权限（中）

模块能发任意网络请求、读写 `Widget.storage`、读宿主传入的参数（含 `videoUrl`、服务器地址）。
Rex 隐私政策也写明"模块可以按其功能请求网络数据"。
应对：本模块不写 `Widget.storage`、不执行远程代码、不把凭据写进日志；网络访问集中在一个出口
（`src/http.ts`）并做协议/主机/大小/超时控制。

### F4 明文示例模块的凭据处理（中）

`MakkaPakka518/FW` 的明文弹幕示例使用 `Widget.http` 与 `Widget.storage`。
`Widget.storage` 是宿主提供的持久化存储，写入的令牌会留在设备上。
应对：本项目**不使用** `Widget.storage`；如需鉴权，让用户在 Rex 模块设置里填请求头，
或使用服务端自己的短期令牌。

### F6 响应缓存与共享命名空间（低）

0.2.0 引入 `Widget.sharedCache` 缓存（命名空间 `rex-hub`，默认 600s）。它只写"公开检索结果/文件清单"，
不写请求头与凭据；键里包含完整上游 URL，因此不同配置之间不会串数据。宿主不支持该能力时会静默降级。

### F7 archive 逐条探测带来的请求放大（低）

`archive` 列表需要 1 次检索 + N 次文件清单请求（N ≤ 12，并发 ≤ 4）。这既控制了对上游的压力，
也限制了单次调用的最坏耗时；失败条目单独跳过，不影响同页其它条目。

### F5 第三方在线解密服务的供应链与隐私风险（中）

把模块（或它的 URL）粘贴给陌生站点，等于把源码与来源暴露给该服务的运营方，且返回的"明文"本身就是
不可信输入。若该服务被替换或投毒，会直接污染审查结论。
应对：不在自动化流程中依赖它；本项目不做解密。

## 2. 本仓库自身的控制项

| 控制                                                      | 位置                               | 覆盖测试                                         |
| --------------------------------------------------------- | ---------------------------------- | ------------------------------------------------ |
| 仅允许 http/https，拒绝 `file:` / `data:` / `javascript:` | `src/http.ts` `assertAllowedUrl`   | `test/http.test.ts`                              |
| 云元数据地址永久拉黑（169.254.169.254、100.100.100.200…） | `src/http.ts` `isBlockedHost`      | `test/http.test.ts`                              |
| 私有网段可选关闭（默认允许，适配局域网自部署）            | `src/config.ts` `allowPrivateHost` | `test/http.test.ts`、`test/config.test.ts`       |
| 禁止 URL 内联账号密码                                     | `assertAllowedUrl`                 | `test/http.test.ts`                              |
| 不跟随重定向（3xx 判失败）                                | `request()`                        | `test/http.test.ts`                              |
| 单请求超时 + 响应大小上限                                 | `withTimeout` / `maxBytes`         | `test/http.test.ts`                              |
| 请求头注入防护（名称白名单、值禁 CRLF/NUL、长度上限）     | `parseHeaders`                     | `test/config.test.ts`                            |
| 上游数据逐条校验，坏条目丢弃而非整体失败                  | `parseFeed` / `parseM3U`           | `test/jsonfeed.test.ts`、`test/playlist.test.ts` |
| 单一来源失败隔离                                          | `collectAcross`                    | `test/aggregate.test.ts`                         |
| 入口函数不向宿主抛异常                                    | `src/index.ts`                     | `test/widget.test.ts`                            |
| 产物不含第三方代码 / 无运行时依赖                         | `dist/index.js`                    | `npm audit --omit=dev` = 0；产物检索无第三方标识 |

## 3. 依赖漏洞

初始 `npm audit`（含构建期）报告 **13 个 moderate**，全部来自同一条构建期依赖链：
`minimatch < 11.0.1`（[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)，
globparts 放大导致 DoS），经由 `eslint → @eslint/config-array` 与
`@rexnow/rslib-plugin → ts-morph → @ts-morph/common` 两条路径引入。

- 影响面：只在本地构建/静态检查时用 glob 匹配**本地**文件路径，不处理远程输入、不进入 `dist/`。
- 处理：在 `package.json` 增加 `overrides: { "minimatch": "^11.0.1" }` 后重装并重跑全流程。
- 结果：`npm audit` **0 漏洞**（含构建期），`npm run verify` 全部通过（格式、ESLint、tsc、64 用例、构建、产物冒烟）。
- 运行时不暴露：`npm audit --omit=dev` 同样为 0，且产物中不含任何第三方代码。

## 4. 结论

- 采纳的依赖（`@rexnow/*`、`rslib`、`typescript`、`vitest`、`prettier`、`eslint`、`typescript-eslint`）许可证清晰、来源可核对、仅构建期使用。
- 0.2.0 新增的只有"数据来源"（archive.org / iptv-org）与自研解析代码，没有引入新的运行时依赖。
- 未被采纳的第三方模块，风险集中在"不可审计 + 无许可证"，已通过"只引用不复制"隔离。
- 本仓库的网络与数据边界由单点控制并有测试覆盖；运行时产物零第三方代码。
