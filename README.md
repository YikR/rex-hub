# Rex Hub · 多源聚合模块

把**多个媒体来源**（M3U 播放列表 / `rex-hub/1` JSON 目录）整合进**一个** Rex 模块：
一处配置、一份列表、多个上游合并去重，某个来源挂掉不影响其它来源。

- 目标宿主：**Rex**（iOS / iPadOS / tvOS / macOS）
- 模块契约：`WidgetMetadata` + `modules[].functionName`（`requiredVersion: "0.0.2"`）
- 产物：`dist/index.js`，无 ESM 导出的普通脚本，**零运行时依赖**
- 许可证：MIT（第三方归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）

---

## 1. 背景：Rex 模块到底是什么

在动手之前先把概念钉死，后面的设计才有依据。

| 维度         | 结论                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **用途**     | Rex 是可扩展的媒体库/播放器。模块（Widget）是一段 JavaScript，给 Rex 增加「内容来源」与「增强能力」：资源列表、详情、取流（`stream`）、字幕（`subtitle`）、弹幕（`danmu`）。 |
| **来源**     | 第三方开发者自行编写并分发；官方只提供开发工具链（[`rex-widget-libs`](https://github.com/baranwang/rex-widget-libs)，MIT）与加密服务（<https://rexnow.tv/encrypt/>）。       |
| **运行方式** | 宿主把脚本求值到全局环境 → 读全局 `WidgetMetadata` → 按 `modules[].functionName` 调用同名全局函数。                                                                          |
| **可用依赖** | 宿主注入的 `Widget`：`Widget.http`（GET/POST）、`Widget.html`（cheerio）、`Widget.storage`、`Widget.sharedCache`、`Widget.tmdb`。模块即使不打包第三方库也能运行。            |
| **兼容环境** | `requiredVersion` 表示最低内核版本，当前生态普遍是 `0.0.2`；Mac 版要求 macOS 14+ 与 Apple 芯片；产物必须是**无导出声明**的普通脚本。                                         |
| **分发方式** | 托管 `.js` 后用 `https://rexnow.tv/widget?url=<编码后的地址>` 导入；或在 App 内直接导入文件；或托管 `.rex` 集合清单。                                                        |

调研与筛选的完整过程见 [docs/candidates.md](docs/candidates.md)，安全审查见
[docs/security-review.md](docs/security-review.md)。

## 2. 这个仓库做了什么

```
                 ┌──────────────────────────── Rex Hub Widget ────────────────────────────┐
  globalParams   │  source=playlist|feed   endpoint=多行地址   limit / timeout / headers   │
 ───────────────►│                                                                        │
                 │   readConfig ──► registry.getAdapter(source)                           │
                 │        │                │                                              │
                 │        │        ┌───────┴────────┐                                     │
                 │        │        │  playlist      │  M3U/M3U8 解析（纯函数）             │
                 │        │        │  feed          │  rex-hub/1 JSON 目录（纯函数 + 校验） │
                 │        │        └───────┬────────┘                                     │
                 │        ▼                ▼                                              │
                 │   collectAcross：多地址并发 · 去重 · 失败隔离 · 来源名补齐分组             │
                 │        │                                                               │
                 │        ▼                                                               │
                 │   hubList / hubSearch / loadResource / loadSubtitle ──► VideoItem[] 等  │
                 └────────────────────────────────────────────────────────────────────────┘
                                        │
                          所有出网请求收敛到 src/http.ts
            协议白名单 · 元数据地址拉黑 · 私有网段开关 · 超时 · 大小上限 · 不跟随重定向
```

四个对外函数：

| functionName   | 模块 id        | 类型     | 作用                       |
| -------------- | -------------- | -------- | -------------------------- |
| `hubList`      | `hub-list`     | video    | 列出所有来源合并后的条目   |
| `hubSearch`    | `hub-search`   | video    | 在全部来源中按标题搜索     |
| `loadResource` | `loadResource` | stream   | 把条目转成可播放直链       |
| `loadSubtitle` | `loadSubtitle` | subtitle | 读取 JSON 目录里声明的字幕 |

## 3. 快速开始

```bash
npm install          # 安装构建期依赖（Node ≥ 22.12）
npm run build        # 产物：dist/index.js
npm run smoke        # 校验产物能被宿主求值（不联网）
```

把 `dist/index.js` 托管到任意 HTTPS 地址，然后在 Rex 里用
`https://rexnow.tv/widget?url=<编码后的地址>` 导入；也可以直接在 App 内导入本地文件。

需要 REXENC 加密产物时，把 `rslib.config.ts` 里的 `encrypt` 改成 `true` 再构建。
注意：该流程会把**源码发送到 rexnow.tv 的加密服务**（第三方），是否接受由你决定；本仓库默认关闭。

## 4. 配置

全部配置都是 Rex 模块设置里的 `globalParams`，不需要改代码。

| 参数               | 类型        | 默认       | 说明                                                              |
| ------------------ | ----------- | ---------- | ----------------------------------------------------------------- |
| `source`           | enumeration | `playlist` | `playlist`（M3U 列表）/ `feed`（JSON 目录）                       |
| `endpoint`         | input       | 空         | **一行一个地址**，支持 `名称=地址`；最多 8 个，按声明顺序合并去重 |
| `limit`            | count       | `60`       | 合并后的条目上限（1–200）                                         |
| `timeout`          | count       | `8000`     | 单来源请求超时（1000–20000 ms）                                   |
| `allowPrivateHost` | enumeration | `true`     | 是否允许局域网/回环地址（自部署服务通常需要 `true`）              |
| `headers`          | input       | 空         | 附加请求头 JSON，例如 `{"Authorization":"Bearer xxx"}`            |

示例（局域网自部署 + 公网列表混用）：

```text
source   = playlist
endpoint = 客厅=http://192.168.1.10:8080/playlist.m3u
           备份=https://media.example.com/backup.m3u
limit    = 80
timeout  = 6000
headers  = {"Authorization":"Bearer 换成你自己的令牌"}
```

> `headers` 只保存在 Rex 的模块设置里，随请求发出；本模块**不写** `Widget.storage`，日志也不会打印它。

自建 JSON 目录服务时按 [docs/json-feed.md](docs/json-feed.md) 输出；示例见
[`catalog/example-feed.json`](catalog/example-feed.json)。

## 5. 目录结构

```
src/
├─ index.ts              入口：WidgetMetadata 注册 + 四个对外函数（含统一降级）
├─ metadata.ts           WidgetMetadata 组装（参数、模块、搜索入口、requiredVersion）
├─ hub.ts                业务编排：列表/搜索/取流/字幕
├─ aggregate.ts          多来源并发合并、去重、失败隔离
├─ config.ts             参数解析与边界（地址表、请求头、数值夹紧）
├─ http.ts               唯一出网出口：协议/主机/超时/大小/重定向控制
├─ registry.ts           适配器注册表
├─ errors.ts             错误码与降级日志
└─ adapters/
   ├─ playlist.ts        M3U/M3U8 解析
   └─ jsonfeed.ts        rex-hub/1 目录解析
catalog/                 候选登记表与可直接解析的示例（被测试守护）
docs/                    调研、安全审查、协议文档
test/                    64 个用例（解析、边界、安全、端到端、文档一致性）
scripts/smoke.mjs        产物冒烟检查（vm 沙箱，不联网）
```

## 6. 开发与验证

| 命令                   | 作用                                        |
| ---------------------- | ------------------------------------------- |
| `npm run format:check` | Prettier 格式检查（配置与账号现有仓库一致） |
| `npm run lint`         | ESLint（flat config + typescript-eslint）   |
| `npm run check`        | `tsc --noEmit` 类型检查                     |
| `npm test`             | Vitest（含 `WidgetAdaptor` 端到端用例）     |
| `npm run build`        | rslib 打包                                  |
| `npm run smoke`        | 产物在 vm 沙箱中求值，校验全局与函数解析    |
| `npm run verify`       | 以上全部串行执行                            |

本机已跑通的结果（2026-11-08）：

```
format:check  ✓ prettier --check 全部通过
lint          ✓ eslint 0 error / 0 warning
check         ✓ tsc --noEmit 无错误
test          ✓ 8 files / 64 tests passed
build         ✓ dist/index.js 28.4 kB (gzip 8.6 kB)
smoke         ✓ 产物可被宿主求值，全局与函数解析正常
npm audit     ✓ 0 vulnerabilities（含构建期；已用 overrides 消除 minimatch 通告）
```

## 7. 安全与合规

- **不执行远程代码**：没有 `eval` / `new Function` / 动态 `import()`；不加载 REXENC 密文。
- **网络单点控制**：仅 http/https；云元数据地址永久拉黑；私有网段可关闭；不跟随重定向；超时与大小上限。
- **不落盘凭据**：不使用 `Widget.storage`；日志只输出错误码与来源名。
- **不复制第三方代码**：生态中多数模块没有许可证（`license: null`），只作为来源地址引用；
  详见 [docs/candidates.md](docs/candidates.md) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 漏洞报告方式与威胁模型：[SECURITY.md](SECURITY.md)。

## 8. 已知限制

1. **没有"跨模块调用"**：Rex 不提供模块间 API，所以"整合"只能是**本模块内多来源**，不能直接复用别人的密文模块。
2. **字幕依赖 JSON 目录**：M3U 列表没有字幕元数据，`loadSubtitle` 对 `playlist` 来源返回空。
3. **不跟随重定向**：部分自建服务会把 `http` 跳 `https`，需要把最终地址直接填进 `endpoint`。
4. **列表缓存由 Rex 侧控制**：模块只声明 `cacheDuration`，实际刷新时机取决于宿主。
5. **私有网段判断是地址字面量级别**：不做 DNS 解析后的 IP 复核（宿主没给 DNS 接口），
   自定义域名解析到内网的场景需要用户自己判断。

## 9. 许可证

MIT，见 [LICENSE](LICENSE)。第三方组件与商标说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
本项目是第三方集成实现，与 Rex Studio 无隶属关系。
