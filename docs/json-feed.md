# `rex-hub/1` JSON 目录协议

本协议由本仓库定义并维护，用来让**任意自部署服务**用一份 JSON 就能被 Rex Hub 模块读取。
它刻意保持最小：只有列表、播放地址、可选封面与字幕，不引入鉴权、不引入分页状态。

- 媒体类型：`application/json`
- 编码：UTF-8
- 顶层对象：`{ "version": 1, "name"?: string, "items": FeedItem[] }`
- 未知字段忽略；不合法的条目**逐条跳过**，不会让整个目录失败。

## 字段

### 顶层

| 字段      | 类型   | 必填 | 说明                       |
| --------- | ------ | ---- | -------------------------- |
| `version` | `1`    | 是   | 协议版本，必须是数字 `1`   |
| `name`    | string | 否   | 目录名，仅作展示           |
| `items`   | array  | 是   | 条目数组，最多读取 5000 条 |

### `items[]`

| 字段          | 类型                | 必填 | 说明                                                                                              |
| ------------- | ------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| `title`       | string              | 是   | 展示标题                                                                                          |
| `url`         | string              | 是   | 播放地址，必须 `http:`/`https:`                                                                   |
| `type`        | `"movie"` \| `"tv"` | 否   | 缺省 `movie`                                                                                      |
| `poster`      | string              | 否   | 竖版封面（http/https）                                                                            |
| `backdrop`    | string              | 否   | 横版背景（http/https）                                                                            |
| `description` | string              | 否   | 简介                                                                                              |
| `year`        | string \| number    | 否   | 年份                                                                                              |
| `group`       | string              | 否   | 分类名；缺省时用来源名补齐                                                                        |
| `subtitles`   | array               | 否   | 字幕列表，见下                                                                                    |
| `episodes`    | array               | 否   | 剧集列表，`[{ "title"?: string, "url": string }]`；存在时按集展开成多条，每条标题为 `剧名 · 集名` |

### `subtitles[]`

| 字段    | 类型   | 必填 | 说明                                                              |
| ------- | ------ | ---- | ----------------------------------------------------------------- |
| `url`   | string | 是   | 字幕文件地址（http/https），支持 `.vtt`/`.srt`/`.ass` 由 Rex 决定 |
| `title` | string | 否   | 缺省 `字幕`                                                       |
| `lang`  | string | 否   | BCP-47 风格语言标记，缺省 `und`                                   |

## 示例

完整可解析示例见 [`catalog/example-feed.json`](../catalog/example-feed.json)，该文件被
`test/catalog.test.ts` 持续校验，因此文档与实现不会脱节。

```json
{
  "version": 1,
  "name": "家庭媒体库",
  "items": [
    {
      "title": "示例影片",
      "type": "movie",
      "url": "https://cdn.example.com/movie.m3u8",
      "poster": "https://cdn.example.com/movie.jpg",
      "year": 2024,
      "group": "电影",
      "subtitles": [
        {
          "title": "简体中文",
          "lang": "zh",
          "url": "https://cdn.example.com/movie.zh.vtt"
        }
      ]
    },
    {
      "title": "示例剧",
      "type": "tv",
      "url": "https://cdn.example.com/show.m3u8",
      "episodes": [
        { "title": "第 1 集", "url": "https://cdn.example.com/e1.m3u8" },
        { "title": "第 2 集", "url": "https://cdn.example.com/e2.m3u8" }
      ]
    }
  ]
}
```

## 服务端实现要点

1. 直接返回 `application/json`，不要返回 HTML 错误页（会被判为 `INVALID_PAYLOAD`）。
2. 不要做重定向（模块把 3xx 视为失败）。
3. 单个响应建议控制在 4 MiB 以内（模块默认上限，可在设置里调大）。
4. 需要鉴权时用 `Authorization` 等请求头，由用户在 Rex 模块设置里填写；**不要把令牌写进 URL**。
5. 分页不在本协议内：按用户需要返回一个稳定的窗口即可，Rex 侧有列表缓存。

## 版本策略

`version` 只在破坏性变更时提升。新增可选字段属于向后兼容，不需要改版本号；
实现方应忽略不认识的字段。
