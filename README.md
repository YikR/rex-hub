# Rex Hub · 多源聚合模块

一个 Rex 模块，三种来源，开箱可用：**Internet Archive 公共影库**（免配置）、**公开频道列表**（内置预设）、
**自部署服务**（M3U / `rex-hub/1` JSON）。多来源合并去重，单个来源挂掉不影响其它来源。

- 目标宿主：**Rex**（iOS / iPadOS / tvOS / macOS）
- 模块契约：`WidgetMetadata` + `modules[].functionName`（`requiredVersion: "0.0.2"`）
- 产物：`dist/index.js`，无 ESM 导出的普通脚本，**零运行时依赖**
- 许可证：MIT（第三方归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）

---

## 1. 背景：Rex 模块到底是什么

| 维度         | 结论                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **用途**     | Rex 是可扩展的媒体库/播放器。模块（Widget）是一段 JavaScript，给 Rex 增加「内容来源」与「增强能力」：资源列表、详情、取流（`stream`）、字幕（`subtitle`）、弹幕（`danmu`）。 |
| **来源**     | 第三方开发者自行编写并分发；官方只提供开发工具链（[`rex-widget-libs`](https://github.com/baranwang/rex-widget-libs)，MIT）与加密服务（<https://rexnow.tv/encrypt/>）。       |
| **运行方式** | 宿主把脚本求值到全局环境 → 读全局 `WidgetMetadata` → 按 `modules[].functionName` 调用同名全局函数。                                                                          |
| **可用依赖** | 宿主注入的 `Widget`：`Widget.http`、`Widget.html`（cheerio）、`Widget.storage`、`Widget.sharedCache`、`Widget.tmdb`。                                                        |
| **兼容环境** | `requiredVersion` 为最低内核版本，当前生态普遍是 `0.0.2`；Mac 版要求 macOS 14+ 与 Apple 芯片；产物必须是**无导出声明**的普通脚本。                                           |
| **分发方式** | 托管 `.js` 后用 `https://rexnow.tv/widget?url=<编码后的地址>` 导入；或在 App 内直接导入文件；或托管 `.rex` 集合清单。                                                        |

调研与筛选见 [docs/candidates.md](docs/candidates.md)，安全审查见 [docs/security-review.md](docs/security-review.md)，
来源清单与使用边界见 [docs/sources.md](docs/sources.md)。

## 2. 三种来源

| source            | 内容                                   | 需要地址 | 说明                                                       |
| ----------------- | -------------------------------------- | -------- | ---------------------------------------------------------- |
| `archive`（默认） | Internet Archive 公共领域/开放授权影片 | 否       | 按热度检索，支持 `query` 条件、`page` 翻页；**装好即可播** |
| `playlist`        | M3U/M3U8 频道或点播列表                | 是       | 支持内置预设（iptv-org 公开频道索引），也可填自建列表      |
| `feed`            | `rex-hub/1` JSON 目录                  | 是       | 自部署服务最省事的接法，带字幕元数据                       |

```
                 ┌──────────────────────────── Rex Hub Widget ────────────────────────────┐
  globalParams   │ source=archive|playlist|feed   preset / endpoint / query / page …      │
 ───────────────►│                                                                        │
                 │   readConfig ──► resolveEndpoints（预设 + 手填，去重，上限 8）          │
                 │        │                │                                              │
                 │        │        ┌───────┴─────────┬──────────────────┐                 │
                 │        │        │ archive         │ playlist         │ feed            │
                 │        │        │ 检索+逐条探测    │ M3U/M3U8 解析     │ JSON 目录校验    │
                 │        │        └───────┬─────────┴──────────────────┘                 │
                 │        ▼                ▼                                              │
                 │   collectAcross：多地址并发 · 去重 · 失败隔离 · 来源名补齐分组             │
                 │        │                                                               │
                 │        ▼                                                               │
                 │   hubList / hubSearch / loadResource / loadSubtitle ──► VideoItem[] 等  │
                 └────────────────────────────────────────────────────────────────────────┘
                           出网请求收敛到 src/http.ts｜结果缓存走 Widget.sharedCache
              协议白名单 · 元数据地址拉黑 · 私有网段开关 · 超时 · 大小上限 · 不跟随重定向
```

四个对外函数：

| functionName   | 模块 id        | 类型     | 作用                                                                   |
| -------------- | -------------- | -------- | ---------------------------------------------------------------------- |
| `hubList`      | `hub-list`     | video    | 列出所有来源合并后的条目                                               |
| `hubSearch`    | `hub-search`   | video    | 在全部来源中搜索（`archive` 走关键词检索，`playlist`/`feed` 本地过滤） |
| `loadResource` | `loadResource` | stream   | 把条目转成可播放直链                                                   |
| `loadSubtitle` | `loadSubtitle` | subtitle | 读取 JSON 目录里声明的字幕                                             |

## 3. 在 Rex 里使用

### 3.1 构建产物

```bash
npm install          # Node ≥ 22.12
npm run build        # 产出 dist/index.js
npm run smoke        # 确认产物能被宿主求值（不联网）
```

### 3.2 导入 Rex（三选一）

**A. 从 URL 导入（推荐，可复用）**

把 `dist/index.js` 托管到任意 HTTPS 地址（GitHub raw、对象存储、自己的域名都行），然后打开：

```
https://rexnow.tv/widget?url=<把模块地址 URL 编码后的结果>
```

例如模块地址是 `https://example.com/rex-hub.js`，编码后为
`https%3A%2F%2Fexample.com%2Frex-hub.js`，拼成：

```
https://rexnow.tv/widget?url=https%3A%2F%2Fexample.com%2Frex-hub.js
```

在 Rex 里打开该链接，会提示导入。GitHub raw 地址同样可用：

```
https://rexnow.tv/widget?url=https%3A%2F%2Fraw.githubusercontent.com%2FYikR%2Frex-hub%2Fmain%2Fdist%2Findex.js
```

> 仓库已经把构建产物 `dist/index.js` 一起提交，因此上面的 raw 链接可以直接用；改代码后请重新
> `npm run build` 并提交产物（CI 会校验产物与源码是否一致）。

**B. App 内导入文件**

把 `dist/index.js` 传到设备（AirDrop / 文件 App），在 Rex 的模块管理里选择导入本地文件。

**C. 加密产物**

把 `rslib.config.ts` 里的 `encrypt` 改成 `true` 再构建，得到 REXENC 密文，再按 A/B 导入。
注意：这会**把源码提交到 rexnow.tv 的加密服务**（第三方），默认关闭。

### 3.3 装好之后怎么用

1. **添加模块**：导入后，模块会出现在设置里的模块列表，名称为「Rex Hub 多源聚合」。
2. **零配置先试**：什么都不改，直接把它加进资源库 —— `source` 默认是 `archive`，能直接看到公共领域影片。
3. **切换来源**：设置 →

   | 参数       | 想做什么          | 填什么                                                                              |
   | ---------- | ----------------- | ----------------------------------------------------------------------------------- |
   | `source`   | 看公共影库        | `archive`                                                                           |
   | `source`   | 看公开频道        | `playlist` + `preset`（如 `iptv-cn`）                                               |
   | `source`   | 接自部署服务      | `feed` + `endpoint`                                                                 |
   | `preset`   | 一键填公开频道    | `iptv-cn` / `iptv-hk` / `iptv-tw` / `iptv-jp` / `iptv-us` / `iptv-uk` / `iptv-asia` |
   | `endpoint` | 加自己的源        | 一行一个，支持 `名字=地址`                                                          |
   | `query`    | 收窄 archive 片源 | 例如 `collection:(film_noir)`、`year:1954`                                          |
   | `page`     | 翻 archive 下一页 | `2`、`3`…                                                                           |
   | `limit`    | 少取一点          | `20`                                                                                |

4. **搜索**：在 Rex 的搜索里选这个模块，`archive` 会按关键词走 Internet Archive 检索，`playlist`/`feed` 在本地标题里过滤。
5. **播放**：点条目 → `loadResource` 返回直链；`archive` 的直链是 `archive.org/download/...`，`playlist` 是你列表里的地址。

### 3.4 常见问题

| 现象                     | 原因与处理                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------- |
| 列表是空的               | `playlist`/`feed` 没填 `endpoint`，日志里会有 `MISSING_ENDPOINT`                    |
| 自部署服务在局域网打不开 | `allowPrivateHost` 保持 `true`；并把**最终地址**填进 `endpoint`（模块不跟随重定向） |
| archive 出图慢/条目少    | archive 每页最多探测 12 个候选，返回数可能少于 `limit`；开大 `cacheTtl` 或换 `page` |
| 想要成人内容             | 默认已过滤 `sexploitation`/`adult`/`erotica` 合集；本项目不提供此类内容             |

## 4. 配置参考

| 参数               | 类型        | 默认      | 说明                                                 |
| ------------------ | ----------- | --------- | ---------------------------------------------------- |
| `source`           | enumeration | `archive` | `archive` / `playlist` / `feed`                      |
| `preset`           | enumeration | `custom`  | 内置公开频道预设，与 `endpoint` 叠加                 |
| `endpoint`         | input       | 空        | 一行一个地址，支持 `名称=地址`；最多 8 个，合并去重  |
| `query`            | input       | 空        | 仅 `archive`：附加检索式                             |
| `page`             | page        | `1`       | 仅 `archive`：页码                                   |
| `limit`            | count       | `60`      | 合并后的条目上限（1–200）                            |
| `timeout`          | count       | `8000`    | 单请求超时（1000–20000 ms）                          |
| `cacheTtl`         | count       | `600`     | 上游响应缓存秒数，`0` 关闭                           |
| `allowPrivateHost` | enumeration | `true`    | 是否允许局域网/回环地址                              |
| `headers`          | input       | 空        | 附加请求头 JSON，如 `{"Authorization":"Bearer xxx"}` |

示例（公共影库 + 自建列表 + 局域网服务混用）：

```text
source   = archive
query    = year:1954
limit    = 40
cacheTtl = 1800
```

```text
source   = playlist
preset   = iptv-cn
endpoint = 客厅=http://192.168.1.10:8080/playlist.m3u
headers  = {"Authorization":"Bearer 换成你自己的令牌"}
```

## 5. 目录结构

```
src/
├─ index.ts              入口：WidgetMetadata 注册 + 四个对外函数（含统一降级）
├─ metadata.ts           WidgetMetadata 组装（参数、模块、搜索入口、requiredVersion）
├─ hub.ts                业务编排：列表/搜索/取流/字幕 + 来源合并
├─ aggregate.ts          多来源并发合并、去重、失败隔离
├─ config.ts             参数解析与边界（地址表、请求头、数值夹紧）
├─ cache.ts              Widget.sharedCache 包装（TTL、能力探测、静默降级）
├─ presets.ts            内置来源预设
├─ http.ts               唯一出网出口：协议/主机/超时/大小/重定向控制
├─ registry.ts           适配器注册表
├─ errors.ts             错误码与降级日志
└─ adapters/
   ├─ archive.ts         Internet Archive 检索 + 逐条探测 + 合集过滤
   ├─ playlist.ts        M3U/M3U8 解析
   └─ jsonfeed.ts        rex-hub/1 目录解析
catalog/                 候选登记表与可直接解析的示例（被测试守护）
docs/                    调研、安全审查、协议、来源说明
test/                    10 个文件 / 83 个用例
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

本机结果（2026-11-08，v0.2.0）：

```
format:check  ✓ prettier --check 全部通过
lint          ✓ eslint 0 error / 0 warning
check         ✓ tsc --noEmit 无错误
test          ✓ 10 files / 83 tests passed
build         ✓ dist/index.js 43.8 kB（gzip 12.9 kB，构建确定性可复现）
smoke         ✓ 产物可被宿主求值，全局与函数解析正常
npm audit     ✓ 0 vulnerabilities（含构建期）
真实网络验证   ✓ archive 首屏 5 条 / 冷启 3–8s，命中缓存 4ms；iptv-cn 预设 3 条
```

## 7. 安全与合规

- **不执行远程代码**：没有 `eval` / `new Function` / 动态 `import()`；不加载 REXENC 密文。
- **网络单点控制**：仅 http/https；云元数据地址永久拉黑；私有网段可关闭；不跟随重定向；超时与大小上限。
- **缓存只放公开数据**：`Widget.sharedCache` 里只写上游目录/检索结果，命名空间 `rex-hub`，
  不写请求头、不写任何凭据。
- **不落盘凭据**：不使用 `Widget.storage`；日志只输出错误码与来源名。
- **不复制第三方代码**：生态里多数模块没有许可证，只作来源地址引用；见 [docs/candidates.md](docs/candidates.md)。
- 漏洞报告方式与威胁模型：[SECURITY.md](SECURITY.md)。

## 8. 已知限制

1. **没有跨模块调用**：Rex 不提供模块间 API，所以「整合」只能是模块内多来源。
2. **archive 每页最多 12 条**：需要逐个探测可播放文件，避免大量并发请求；用 `page` 翻页。
3. **archive 内容为公共领域/开放授权**：画质与片源质量参差，属正常现象。
4. **字幕仅 `feed` 支持**：M3U 与 archive 没有字幕元数据。
5. **不跟随重定向**：`http→https` 跳转需直接填最终地址。
6. **私有网段按地址字面量判断**：不做 DNS 解析后的 IP 复核。

## 9. 许可证

MIT，见 [LICENSE](LICENSE)。第三方组件、数据来源与商标说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
本项目是第三方集成实现，与 Rex Studio 无隶属关系。
