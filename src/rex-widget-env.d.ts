/// <reference types='@rexnow/libs/env' />
declare namespace YikrRexHub {
    interface GlobalParams {
        /**
         * 来源类型
         * @description archive：Internet Archive 公共影库（免配置）；playlist：M3U 列表；feed：rex-hub/1 JSON 目录
         * @default 'archive'
         */
        source: 'archive' | 'playlist' | 'feed';
        /**
         * 内置预设
         * @description 一键填入公开频道列表，可与下方地址叠加
         * @default 'custom'
         */
        preset: 'custom' | 'iptv-cn' | 'iptv-hk' | 'iptv-tw' | 'iptv-jp' | 'iptv-us' | 'iptv-uk' | 'iptv-asia';
        /**
         * 来源地址
         * @description 一行一个地址，支持「名称=地址」；最多 8 个，会合并去重。archive 留空即用内置检索
         */
        endpoint: string;
        /**
         * 检索条件
         * @description 仅 archive：附加检索式，例如 collection:(sci-fi_horror) 或 year:1954
         */
        query: string;
        /**
         * 页码
         * @description 仅 archive：从 1 开始的页码
         * @default '1'
         */
        page: string;
        /**
         * 结果上限
         * @description 合并后的条目数上限
         * @default '60'
         */
        limit: string;
        /**
         * 超时（毫秒）
         * @description 单个来源请求超时，1000–20000
         * @default '8000'
         */
        timeout: string;
        /**
         * 缓存（秒）
         * @description 上游响应的本地缓存时长，0 表示关闭
         * @default '600'
         */
        cacheTtl: string;
        /**
         * 允许私有网段
         * @description 自部署服务在局域网时保持 true
         * @default 'true'
         */
        allowPrivateHost: 'true' | 'false';
        /**
         * 请求头（JSON）
         * @description 例如 {"Authorization":"Bearer xxx"}；仅本地保存，随请求发送
         */
        headers: string;
    }
}

//#region hub-list
/** Params of 浏览来源 */
interface HubListParams extends YikrRexHub.GlobalParams {
}

/** Return Type of 浏览来源 */
interface HubListReturnType extends Array<VideoItem> {
}

/**
 * 浏览来源
 * @description 列出所有来源合并后的条目
 */
declare let hubList: (params: HubListParams) => HubListReturnType | null | Promise<HubListReturnType | null>;
//#endregion hub-list

//#region hub-search
/** Params of 搜索 */
interface HubSearchParams extends YikrRexHub.GlobalParams {
    /** 关键词 */
    keyword: string;
}

/** Return Type of 搜索 */
interface HubSearchReturnType extends Array<VideoItem> {
}

/**
 * 搜索
 * @description 在全部来源中按标题搜索
 */
declare let hubSearch: (params: HubSearchParams) => HubSearchReturnType | null | Promise<HubSearchReturnType | null>;
//#endregion hub-search

//#region loadResource
/** Params of 获取播放地址 */
interface LoadResourceParams extends YikrRexHub.GlobalParams, BaseParams {
}

/** Return Type of 获取播放地址 */
interface LoadResourceReturnType extends Array<StreamSourceItem> {
}

/**
 * 获取播放地址
 * @description 把列表条目转换为可播放直链
 */
declare let loadResource: (params: LoadResourceParams) => LoadResourceReturnType | null | Promise<LoadResourceReturnType | null>;
//#endregion loadResource

//#region loadSubtitle
/** Params of 获取字幕 */
interface LoadSubtitleParams extends YikrRexHub.GlobalParams, BaseParams {
}

/** Return Type of 获取字幕 */
interface LoadSubtitleReturnType extends Array<SubtitleItem> {
}

/**
 * 获取字幕
 * @description 读取 JSON 目录中声明的字幕
 */
declare let loadSubtitle: (params: LoadSubtitleParams) => LoadSubtitleReturnType | null | Promise<LoadSubtitleReturnType | null>;
//#endregion loadSubtitle
