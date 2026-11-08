# 候选模块调研与筛选

调研时间：2026-11-08。数据取自 GitHub API、仓库文件与 <https://rexnow.tv> 公开页面。

## 1. 先明确「Rex 模块」是什么

| 维度     | 结论                                                                                                                                                                                       | 依据                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用途     | Rex 是可扩展的媒体库/播放器。**模块（Widget）是一段 JS，用来给 Rex 增加"内容来源"与"增强能力"**：资源列表、详情、取流（`stream`）、字幕（`subtitle`）、弹幕（`danmu`）                     | rexnow.tv 首页/价格页描述（媒体库、播放、AI 字幕、追剧通知）；`@rexnow/libs` 的 `metadata` / `stream` / `subtitle` / `danmu` 类型定义                     |
| 来源     | 第三方开发者自行编写；官方只提供**开发工具链**与**加密服务**，不提供内容源                                                                                                                 | <https://github.com/baranwang/rex-widget-libs>（`@rexnow/*` 包，作者 Baran）；<https://rexnow.tv/encrypt/> 提交源码到 `api.rexnow.tv/api/widgets/encrypt` |
| 运行方式 | 宿主把一个脚本求值到全局环境，读取全局 `WidgetMetadata`，再按 `modules[].functionName` 调用同名全局函数                                                                                    | `@rexnow/rslib-plugin` 的实现（沙箱求值 `WidgetMetadata`、移除 `export` 声明、"Rex Widget 不支持脚本有导出声明"）；明文示例模块的写法                     |
| 依赖     | 宿主注入的 `Widget` 对象：`Widget.http`（GET/POST）、`Widget.html`（cheerio）、`Widget.storage`、`Widget.sharedCache`、`Widget.tmdb`。模块本身不打包第三方库也能跑                         | `@rexnow/libs` 的 `widget-adaptor`                                                                                                                        |
| 兼容环境 | iOS / iPadOS / tvOS / macOS 版 Rex；`requiredVersion` 表示最低内核版本，当前生态普遍是 `0.0.2`；Mac 版要求 macOS 14+ 与 Apple 芯片；模块产物是**无 ESM 导出的普通脚本**                    | rexnow.tv 价格页（iPhone / iPad / Apple TV / Mac，Mac 需 macOS 14 或更新）；各候选模块的 `requiredVersion`                                                |
| 分发方式 | ①托管一个 `.js`（或 REXENC 密文），用 `https://rexnow.tv/widget?url=<编码后的地址>` 一键导入；②在 App 内直接导入文件；③托管 `.rex` 集合清单（JSON，含 `widgets[]` 与每个 widget 的 `url`） | MANIA 仓库 README 与 `mania.rex` 清单；加密页帮助文案                                                                                                     |

结论：**"整合模块"的正确形态是"一个 Widget 承载多个来源"**——单一 `WidgetMetadata`、用 `globalParams`
做来源切换、把多个上游地址合并进同一份列表。这也是本仓库的实现方向。

## 2. 筛选标准

1. **维护活跃**：最近提交在 90 天内。
2. **来源可信**：公开仓库、提交历史可核对、作者可追溯。
3. **许可证清晰**：有明确 SPDX 许可证，允许再分发。
4. **环境兼容**：面向 Rex Widget 生态（`requiredVersion ≤ 0.0.2`）。
5. **可审计**：源码明文；不把关键逻辑放在不可审计的密文或闭源服务里。

## 3. 候选矩阵

| 候选                                                                                                                                       | 许可证  | 产物形态                  | 活跃度                | 结论                    |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------- | --------------------- | ----------------------- |
| [`baranwang/rex-widget-libs`](https://github.com/baranwang/rex-widget-libs)（`@rexnow/libs`、`@rexnow/rslib-plugin`、`create-rex-widget`） | **MIT** | 源码                      | 116★，2026-09-15      | **采纳为构建/测试依赖** |
| [`zxxlxj/rex-m`](https://github.com/zxxlxj/rex-m)（MANIA 2.1.1）                                                                           | 无      | REXENC 密文 + `.rex` 清单 | 10★，2026-10-23       | 仅引用，不复制          |
| [`MakkaPakka518/FW`](https://github.com/MakkaPakka518/FW)                                                                                  | 无      | 明文（部分密文）          | 46★，2026-10-06       | 仅作契约参考            |
| [`nori5555/RexWidgets`](https://github.com/nori5555/RexWidgets)                                                                            | 无      | REXENC 密文               | 1★，2026-10-08        | 拒绝                    |
| [`Darklessing/catvod`](https://github.com/Darklessing/catvod) / [`woshishiq1/hipy-drpy2`](https://github.com/woshishiq1/hipy-drpy2)        | 无      | 明文集合                  | 72★ / 38★，2026-11-07 | 仅作集合格式参考        |
| [`ch889988/Surge`](https://github.com/ch889988/Surge)                                                                                      | 无      | 不明                      | 0★，2026-10-11        | 拒绝                    |

## 4. 为什么最终只"采纳"了 MIT 的工具链

- **法律面**：除 `rex-widget-libs` 外，所有候选仓库的 `license` 都是 `null`。默认版权保留意味着**没有**
  复制、修改、再分发的授权。把它们整段搬进新仓库会造成许可证风险，因此一律不复制。
- **技术面**：这些模块大多是"某个具体站点/自部署服务"的适配器，产物是 REXENC 密文，无法审阅，
  也无法在无凭据、无上游服务的环境里做功能验证——集成它们并不等于得到可维护的代码。
- **可维护面**：`@rexnow/libs` + `@rexnow/rslib-plugin` 正好是官方模板使用的工具链，提供类型、测试适配器
  与构建/加密能力。基于它写**自己的**适配器，既能通过 `WidgetAdaptor` 做端到端测试，也不产生许可证负担。

## 5. 采纳结果

本仓库集成的"模块"是**能力层面**的整合，而不是代码搬运：

- `playlist` 适配器：M3U/M3U8 列表（公开事实标准，自研实现）。
- `feed` 适配器：`rex-hub/1` JSON 目录（本项目定义的协议，见 [json-feed.md](json-feed.md)）。
- 多个上游地址在同一个 Widget 内合并、去重、按来源名分组；失败的来源被隔离，不影响其它来源。

想要接入某个第三方来源时，**填它的地址**即可（或在 `catalog/sources.json` 里登记为 `reference-only`），
不需要把对方代码复制进来。
