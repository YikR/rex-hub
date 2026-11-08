# 内置来源与使用边界

本模块只对接**公开可访问、可公开引用**的接口；不内置任何需要绕过访问控制的内容源。

## 1. 来源清单

| id         | 来源                                    | 类型                    | 需要凭据         | 说明                                                                                   |
| ---------- | --------------------------------------- | ----------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| `archive`  | [Internet Archive](https://archive.org) | 公共领域 / 开放授权影片 | 否               | 官方公开检索 API + 文件清单 API；条目授权状态由 archive.org 标注（多为 Public Domain） |
| `playlist` | 任意 M3U/M3U8                           | 直播/点播列表           | 取决于你的服务器 | 自建即可；内置预设指向 iptv-org 公开索引                                               |
| `feed`     | 自建 `rex-hub/1`                        | 目录                    | 取决于你的服务器 | 见 [json-feed.md](json-feed.md)                                                        |

### 内置预设（`preset` 参数）

| 值                                                                    | 内容                    | 地址来源                                               |
| --------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------ |
| `custom`                                                              | 不使用预设              | —                                                      |
| `iptv-cn` / `iptv-hk` / `iptv-tw` / `iptv-jp` / `iptv-us` / `iptv-uk` | 对应国家/地区的公开频道 | `https://iptv-org.github.io/iptv/countries/<code>.m3u` |
| `iptv-asia`                                                           | iptv-org 全量索引       | `https://iptv-org.github.io/iptv/index.m3u`            |

[iptv-org/iptv](https://github.com/iptv-org/iptv) 是公开的频道索引项目。它收录的是各频道**自行公开**的流地址，
**是否可播放、是否有观看权由频道方决定**；模块只做地址聚合，不代理、不转码、不缓存媒体内容。

## 2. 默认检索范围

`archive` 默认只检索四个经典影片/剧集合集，避免公共影库里混入的成人/剥削片合集：

```
collection:(silent_films OR film_noir OR sci-fi_horror OR classic_tv)
  AND mediatype:movies AND format:(MPEG4)
```

想换范围就改 `query`，例如：

```text
query = collection:(feature_films)
query = collection:(sci-fi_horror) AND year:[1950 TO 1960]
query = collection:(classic_tv)
query = year:1954 AND mediatype:movies
```

> 检索由 Internet Archive 执行，条目的授权状态以站点标注为准。本模块不筛选、不转存内容。

## 3. 你不该用它做的事

- 播放自己没有观看权的内容（订阅制平台、影院新片、盗版片源）。
- 把需要登录/付费的地址填进 `endpoint` 再分发给别人。
- 用 `headers` 存长期有效的账号密码 —— 模块设置对持有设备的人可见。

## 4. 数据与隐私

- 模块不收集、不上报任何使用数据。
- 上游会看到你的请求（IP、检索词），这与直接在浏览器访问该站一致。
- `Widget.sharedCache` 只缓存公开的上游响应（检索结果、文件清单），不含凭据。
- 媒体播放由 Rex 客户端直接向上游发起，模块不中转流量。

## 5. 失效与维护

公开索引会变（频道下线、条目被移除）。失效表现与处理：

| 现象                          | 处理                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `iptv-*` 预设里部分频道播不出 | 正常现象，换频道或用自己的列表                                                              |
| `archive` 某条目取不到文件    | 已被下架/限制，模块会跳过该条目                                                             |
| 整页都是空的                  | 上游接口改版或网络不可达，看日志里的错误码（`HTTP_STATUS` / `TIMEOUT` / `INVALID_PAYLOAD`） |
