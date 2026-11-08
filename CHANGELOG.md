# 变更记录

## 0.2.2 — 2026-11-08

### 修复

- **导入仍报「无法识别的模块数据」**：Rex 客户端只接受 `.rex` 集合清单或 **REXENC 密文**，
  明文 `.js` 一律拒绝。新增 `scripts/encrypt.mjs`（调官方加密接口、离线校验封装），
  产出 `dist/index.rex.js`，并把 `rex-hub.rex` 指向它。
- `rslib` 增加 `cleanDistPath: false`，构建不再清掉加密产物；`verify` 增加 `encrypt:check`。

## 0.2.1 — 2026-11-08

### 修复

- **导入报「添加失败：无法识别的模块数据」**：`WidgetMetadata` 之前是函数调用结果
  （`buildMetadata()`），Rex 客户端导入时按静态解析读取顶层对象字面量，解析不到即失败。
  现改为**内联对象字面量**，并新增 `test/manifest.test.ts` 复刻客户端解析（唯一顶层字面量、
  关键字段为 Literal、全文只出现一处赋值）。
- 构建顺序：`verify` 与 CI 改为**先 build 再 test**，避免测试读到旧产物。

### 新增

- `assets/icon.png` 模块图标；`rex-hub.rex` 集合清单（与单模块导入等价的另一种入口）。

## 0.2.0 — 2026-11-08

### 新增

- **Internet Archive 适配器**（`source=archive`）：公共领域/开放授权影片，免配置即可出片；
  官方检索 API + 文件清单 API，逐条探测可播放文件，优先 h.264。
- **内置预设**（`preset`）：一键接入 iptv-org 公开频道索引（cn/hk/tw/jp/us/uk/asia），可与手填地址叠加。
- **响应缓存**（`cacheTtl`）：包装 `Widget.sharedCache`，只缓存公开目录/检索结果，默认 600s。
- **分页与检索条件**（`page`、`query`）：archive 支持翻页与自定义检索式。
- `requiresEndpoint` 能力标记：允许"自带检索地址"的来源在无配置时也能工作。
- `docs/sources.md`：来源清单、默认检索范围与使用边界。

### 变更

- 默认 `source` 从 `playlist` 改为 `archive`（装好即可用）。
- 未配置地址且来源需要地址时，错误提示改为引导选择预设。

### 修复

- `archive` 检索 URL 不再依赖 `URLSearchParams`（部分宿主环境不注入该全局）。

## 0.1.0 — 2026-11-08

- 首个版本：`playlist`（M3U/M3U8）与 `feed`（`rex-hub/1`）两个适配器。
- 多来源合并、去重、失败隔离；单一出网出口与协议/主机/超时/大小控制。
- 64 个用例、产物冒烟检查、CI、许可证与第三方归属。
