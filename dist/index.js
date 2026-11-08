

/**
 * 统一错误模型。
 *
 * 设计约束：
 * - Widget 函数不能把异常抛给宿主（Rex 会把未捕获异常呈现为「模块出错」并可能中断后续请求），
 *   因此所有内部异常都收敛为 {@link HubError}，由入口函数捕获并降级为空结果。
 * - 错误码是稳定契约：日志、测试和用户提示都依赖它，不要随意改名。
 */ class HubError extends Error {
    code;
    constructor(code, message, options){
        super(message, options);
        this.name = "HubError";
        this.code = code;
    }
}
/** 把任意未知异常规整为 HubError，便于统一处理。 */ function asHubError(error, fallback = "HTTP_FAILED") {
    if (error instanceof HubError) {
        return error;
    }
    if (error instanceof Error) {
        const timeoutish = error.name === "AbortError" || /timeout|timed out/i.test(error.message);
        return new HubError(timeoutish ? "TIMEOUT" : fallback, error.message, {
            cause: error
        });
    }
    return new HubError(fallback, String(error));
}
/**
 * 记录一条降级日志。Rex 允许模块使用 console，且日志不会外发到网络。
 * 这里只输出错误码与简短原因，避免把凭据、URL 查询串等敏感上下文写进日志。
 */ function report(scope, error) {
    const hubError = asHubError(error);
    console.warn(`[rex-hub] ${scope} 降级 (${hubError.code}): ${hubError.message}`);
}


/**
 * 在多个来源上并发执行同一操作并合并结果。
 *
 * - 单个来源失败不影响其它来源（失败隔离）。
 * - 按播放地址去重，保持来源声明顺序，结果稳定可预测。
 * - 没有分组信息的条目用来源名补齐，便于用户在合并列表里区分出处。
 */ async function collectAcross(endpoints, ctx, task) {
    if (endpoints.length === 0) {
        return {
            items: [],
            failures: []
        };
    }
    const settled = await Promise.allSettled(endpoints.map((endpoint)=>task(endpoint)));
    const items = [];
    const failures = [];
    const seen = new Set();
    settled.forEach((result, index)=>{
        const endpoint = endpoints[index];
        if (!endpoint) {
            return;
        }
        if (result.status === "rejected") {
            const error = asHubError(result.reason);
            failures.push({
                source: endpoint.name,
                code: error.code,
                message: error.message
            });
            return;
        }
        for (const item of result.value){
            const key = `${item.type}:${item.url}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            items.push({
                ...item,
                group: item.group ?? endpoint.name
            });
        }
    });
    return {
        items: items.slice(0, ctx.limit),
        failures
    };
}



const DEFAULTS = {
    limit: 60,
    timeoutMs: 8000,
    maxBytes: 4 * 1024 * 1024,
    maxEndpoints: 8,
    page: 1,
    cacheTtl: 600
};
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
function readString(params, key) {
    const value = params[key];
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return undefined;
}
function readNumber(params, key, fallback, min, max) {
    const raw = readString(params, key);
    if (raw === undefined) {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new HubError("INVALID_CONFIG", `参数 ${key} 不是数字`);
    }
    return Math.min(max, Math.max(min, Math.trunc(value)));
}
/** 解析「一行一个来源」的地址表，支持 `名称=地址` 形式。 */ function parseEndpoints(raw, max = DEFAULTS.maxEndpoints) {
    if (!raw) {
        return [];
    }
    const entries = [];
    const seen = new Set();
    for (const line of raw.split(/\r?\n|;|,(?=\s*https?:)/)){
        const item = line.trim();
        if (item === "" || item.startsWith("#")) {
            continue;
        }
        let name = "";
        let url = item;
        const eq = item.indexOf("=");
        if (eq > 0 && !/^https?:/i.test(item)) {
            name = item.slice(0, eq).trim();
            url = item.slice(eq + 1).trim();
        }
        if (seen.has(url)) {
            continue;
        }
        seen.add(url);
        let host = "";
        try {
            host = new URL(url).hostname;
        } catch  {
            throw new HubError("INVALID_CONFIG", `来源地址不是合法 URL：${item.slice(0, 120)}`);
        }
        entries.push({
            name: name || host,
            url
        });
        if (entries.length >= max) {
            break;
        }
    }
    return entries;
}
/** 校验自定义请求头：拒绝 CRLF 注入与超长值。 */ function parseHeaders(raw) {
    if (!raw) {
        return {};
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch  {
        throw new HubError("INVALID_CONFIG", '请求头必须是 JSON 对象，例如 {"Authorization":"Bearer xxx"}');
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new HubError("INVALID_CONFIG", "请求头必须是 JSON 对象");
    }
    const headers = {};
    for (const [key, value] of Object.entries(parsed)){
        if (!HEADER_NAME.test(key)) {
            throw new HubError("INVALID_CONFIG", `请求头名称非法：${key.slice(0, 40)}`);
        }
        if (typeof value !== "string" && typeof value !== "number") {
            throw new HubError("INVALID_CONFIG", `请求头 ${key} 的值必须是字符串`);
        }
        const text = String(value);
        if (/[\r\n]/.test(text) || text.includes("\u0000") || text.length > 512) {
            throw new HubError("INVALID_CONFIG", `请求头 ${key} 的值非法`);
        }
        headers[key] = text;
    }
    return headers;
}
/** 从模块参数构建运行配置。所有取值都带边界，避免宿主传入离谱数值。 */ function readConfig(params, defaultSource) {
    const input = params ?? {};
    const allowPrivateHost = readString(input, "allowPrivateHost") !== "false";
    return {
        source: readString(input, "source") ?? defaultSource,
        endpoints: parseEndpoints(readString(input, "endpoint")),
        limit: readNumber(input, "limit", DEFAULTS.limit, 1, 200),
        timeoutMs: readNumber(input, "timeout", DEFAULTS.timeoutMs, 1000, 20000),
        maxBytes: readNumber(input, "maxBytes", DEFAULTS.maxBytes, 64 * 1024, 16 * 1024 * 1024),
        allowPrivateHost,
        headers: parseHeaders(readString(input, "headers")),
        preset: readString(input, "preset") ?? (/* inlined export .DEFAULT_PRESET */"custom"),
        query: readString(input, "query") ?? "",
        page: readNumber(input, "page", DEFAULTS.page, 1, 100),
        cacheTtl: readNumber(input, "cacheTtl", DEFAULTS.cacheTtl, 0, 86400)
    };
}


/** 云厂商元数据端点：任何配置下都不允许访问。 */ const METADATA_HOSTS = new Set([
    "169.254.169.254",
    "100.100.100.200",
    "metadata",
    "metadata.google.internal"
]);
const PRIVATE_V4 = [
    /^10\./,
    /^127\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./
];
const PRIVATE_V6 = [
    /^\[?::1\]?$/,
    /^\[?f[cd][0-9a-f]{2}:/i,
    /^\[?fe80:/i
];
function isBlockedHost(host) {
    const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
    return METADATA_HOSTS.has(normalized) || normalized.endsWith(".metadata.google.internal");
}
function isPrivateHost(host) {
    const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
    if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
        return true;
    }
    if (PRIVATE_V4.some((re)=>re.test(normalized))) {
        return true;
    }
    return PRIVATE_V6.some((re)=>re.test(normalized));
}
/** 校验并归一化一个用户提供的地址。 */ function assertAllowedUrl(raw, limits) {
    let url;
    try {
        url = new URL(raw);
    } catch  {
        throw new HubError("INVALID_CONFIG", `地址不是合法 URL：${truncate(raw)}`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new HubError("BLOCKED_PROTOCOL", `只允许 http/https，收到 ${url.protocol}`);
    }
    if (isBlockedHost(url.hostname)) {
        throw new HubError("BLOCKED_HOST", "拒绝访问云元数据地址");
    }
    if (!limits.allowPrivateHost && isPrivateHost(url.hostname)) {
        throw new HubError("BLOCKED_HOST", "已禁用私有网段访问，可在模块设置中开启");
    }
    if (url.username || url.password) {
        throw new HubError("INVALID_CONFIG", "不要在地址中内联账号密码，请使用请求头配置");
    }
    return url;
}
function truncate(value, max = 120) {
    return value.length > max ? `${value.slice(0, max)}…` : value;
}
function withTimeout(promise, timeoutMs, label) {
    let timer;
    const timeout = new Promise((_, reject)=>{
        timer = setTimeout(()=>reject(new HubError("TIMEOUT", `${label} 超时（${timeoutMs}ms）`)), timeoutMs);
    });
    return Promise.race([
        promise,
        timeout
    ]).finally(()=>{
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    });
}
function headersLength(headers) {
    let total = 0;
    for (const [key, value] of Object.entries(headers)){
        total += key.length + value.length + 4;
    }
    return total;
}
async function request(url, limits, headers) {
    const target = assertAllowedUrl(url, limits);
    const response = await withTimeout(Widget.http.get(target.toString(), headers ? {
        headers
    } : undefined), limits.timeoutMs, "HTTP 请求");
    if (response.statusCode >= 300 && response.statusCode < 400) {
        throw new HubError("HTTP_STATUS", `不允许重定向（HTTP ${response.statusCode}）`);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new HubError("HTTP_STATUS", `上游返回 HTTP ${response.statusCode}`);
    }
    const size = typeof response.data === "string" ? new TextEncoder().encode(response.data).length : headersLength(response.headers);
    if (size > limits.maxBytes) {
        throw new HubError("TOO_LARGE", `响应超过上限 ${limits.maxBytes} 字节`);
    }
    return response.data;
}
/** 获取文本资源（M3U 等）。宿主可能已把 JSON 解析成对象，这里统一序列化回文本。 */ async function fetchText(url, limits, headers) {
    const data = await request(url, limits, headers);
    if (typeof data === "string") {
        return data;
    }
    if (data === null || data === undefined) {
        return "";
    }
    return JSON.stringify(data);
}
/** 获取 JSON 资源。 */ async function fetchJson(url, limits, headers) {
    const data = await request(url, limits, headers);
    if (typeof data !== "string") {
        return data;
    }
    try {
        return JSON.parse(data);
    } catch  {
        throw new HubError("INVALID_PAYLOAD", "上游返回的不是合法 JSON");
    }
}

/**
 * 内置来源预设。
 *
 * 预设只做一件事：把一组**公开可访问**的地址替你填好，省去手动粘贴。
 * 任何预设都可以和自定义地址叠加使用；填了预设也不影响 `source` 的选择。
 *
 * iptv-org 是公开的频道索引项目（https://github.com/iptv-org/iptv），
 * 收录的是各频道公开提供的直播流。是否可播放取决于频道方，与是否取得相应观看权无关。
 */ const PRESETS = [
    {
        id: "custom",
        title: "自定义（只用下方地址）",
        endpoints: []
    },
    {
        id: "iptv-cn",
        title: "公开频道 · 中国",
        endpoints: [
            "https://iptv-org.github.io/iptv/countries/cn.m3u"
        ]
    },
    {
        id: "iptv-hk",
        title: "公开频道 · 中国香港",
        endpoints: [
            "https://iptv-org.github.io/iptv/countries/hk.m3u"
        ]
    },
    {
        id: "iptv-tw",
        title: "公开频道 · 中国台湾",
        endpoints: [
            "https://iptv-org.github.io/iptv/countries/tw.m3u"
        ]
    },
    {
        id: "iptv-jp",
        title: "公开频道 · 日本",
        endpoints: [
            "https://iptv-org.github.io/iptv/countries/jp.m3u"
        ]
    },
    {
        id: "iptv-us",
        title: "公开频道 · 美国",
        endpoints: [
            "https://iptv-org.github.io/iptv/countries/us.m3u"
        ]
    },
    {
        id: "iptv-uk",
        title: "公开频道 · 英国",
        endpoints: [
            "https://iptv-org.github.io/iptv/countries/uk.m3u"
        ]
    },
    {
        id: "iptv-asia",
        title: "公开频道 · 亚洲综合",
        endpoints: [
            "https://iptv-org.github.io/iptv/index.m3u"
        ]
    }
];
const DEFAULT_PRESET = "custom";
function presetOptions() {
    return PRESETS.map((preset)=>({
            title: preset.title,
            value: preset.id
        }));
}
function presetEndpoints(id) {
    if (!id || id === DEFAULT_PRESET) {
        return [];
    }
    return PRESETS.find((preset)=>preset.id === id)?.endpoints.slice() ?? [];
}

/**
 * 轻量响应缓存。
 *
 * Rex 宿主提供 `Widget.sharedCache`（跨模块共享、由宿主落盘）。它适合缓存**公开**的上游响应：
 * 这里只缓存目录/检索结果，不缓存请求头、不缓存任何凭据。
 *
 * 宿主可能不提供该能力（测试环境、旧版本），因此所有调用都先做能力探测并静默降级。
 */ function store() {
    const widget = globalThis.Widget;
    const shared = widget?.sharedCache;
    if (!shared || typeof shared !== "object") {
        return null;
    }
    return shared;
}
function cacheAvailable() {
    const shared = store();
    return typeof shared?.get === "function" && typeof shared?.set === "function";
}
/** 读取缓存；过期、缺失或宿主不支持都返回 null。 */ function readCache(options, key) {
    if (options.ttlSeconds <= 0 || !cacheAvailable()) {
        return null;
    }
    try {
        const raw = store()?.get?.(options.namespace, key);
        if (!raw || typeof raw !== "object") {
            return null;
        }
        const entry = raw;
        if (typeof entry.at !== "number" || !("value" in entry)) {
            return null;
        }
        if (Date.now() - entry.at > options.ttlSeconds * 1000) {
            return null;
        }
        return entry.value;
    } catch  {
        return null;
    }
}
/** 写入缓存；失败（配额、序列化、宿主不支持）静默忽略。 */ function writeCache(options, key, value) {
    if (options.ttlSeconds <= 0 || !cacheAvailable()) {
        return;
    }
    try {
        store()?.set?.(options.namespace, key, {
            at: Date.now(),
            value
        });
    } catch  {
    // 缓存只是优化，失败不影响主流程
    }
}
/** 包装一次读取：命中返回缓存，未命中执行 loader 并回填。 */ async function withCache(options, key, loader) {
    if (!options || options.ttlSeconds <= 0) {
        return loader();
    }
    const cached = readCache(options, key);
    if (cached !== null) {
        return cached;
    }
    const value = await loader();
    writeCache(options, key, value);
    return value;
}




/**
 * Internet Archive 公共影视库适配器。
 *
 * 只用官方公开接口：
 * - 检索：`https://archive.org/advancedsearch.php?...&output=json`
 * - 文件清单：`https://archive.org/metadata/<identifier>`
 * - 播放：`https://archive.org/download/<identifier>/<file>`
 *
 * 站点上并非每个条目都有可播放文件（有的只有元数据、有的被限制），因此实现会**逐条探测**、
 * 跳过无用条目，并对"文件清单"做缓存，避免重复请求。
 */ const SEARCH_BASE = "https://archive.org/advancedsearch.php";
const METADATA_BASE = "https://archive.org/metadata/";
const DOWNLOAD_BASE = "https://archive.org/download/";
const IMAGE_BASE = "https://archive.org/services/img/";
/**
 * 默认检索：限定在经典影片/剧集合集，避免混入公共影库里的成人/剥削片合集。
 * 想换范围就改 `query` 参数，例如 `collection:(feature_films)` 或 `year:1954`。
 */ const DEFAULT_ARCHIVE_QUERY = "collection:(silent_films OR film_noir OR sci-fi_horror OR classic_tv) AND mediatype:movies AND format:(MPEG4)";
/** 可播放文件格式，按优先级排序 */ const PLAYABLE_FORMATS = [
    "h.264",
    "MPEG4",
    "512Kb MPEG4",
    "Ogg Video",
    "WebM",
    "Matroska"
];
const PLAYABLE_EXTENSIONS = [
    ".mp4",
    ".m4v",
    ".webm",
    ".ogv",
    ".mkv"
];
/** 每次列表最多探测多少个候选条目（搜索行数会按 2 倍放大以抵消空条目） */ const MAX_PROBES = 12;
const PROBE_CONCURRENCY = 4;
/** 解析检索响应；非 JSON 结构直接判失败，坏条目逐条跳过。 */ function parseArchiveSearch(payload) {
    if (payload === null || typeof payload !== "object") {
        throw new HubError("INVALID_PAYLOAD", "Internet Archive 检索结果不是对象");
    }
    const response = payload.response;
    if (response === null || typeof response !== "object") {
        throw new HubError("INVALID_PAYLOAD", "Internet Archive 检索结果缺少 response");
    }
    const docs = response.docs;
    if (!Array.isArray(docs)) {
        throw new HubError("INVALID_PAYLOAD", "Internet Archive 检索结果缺少 docs");
    }
    const parsed = [];
    for (const candidate of docs.slice(0, 100)){
        if (candidate === null || typeof candidate !== "object") {
            continue;
        }
        const raw = candidate;
        const identifier = typeof raw.identifier === "string" ? raw.identifier.trim() : "";
        const title = typeof raw.title === "string" ? raw.title.trim() : "";
        if (identifier === "" || title === "") {
            continue;
        }
        parsed.push({
            identifier,
            title,
            year: raw.year === undefined || raw.year === null ? undefined : String(raw.year),
            description: typeof raw.description === "string" && raw.description.trim() !== "" ? raw.description.trim().slice(0, 500) : undefined
        });
    }
    return parsed;
}
/** 从文件清单里挑一个最适合直接播放的文件（优先 h.264 MP4）。 */ function pickVideoFile(files) {
    if (!Array.isArray(files)) {
        return null;
    }
    const videos = files.filter((file)=>{
        if (file === null || typeof file !== "object") {
            return false;
        }
        const name = file.name;
        return typeof name === "string" && PLAYABLE_EXTENSIONS.some((ext)=>name.toLowerCase().endsWith(ext));
    });
    if (videos.length === 0) {
        return null;
    }
    videos.sort((left, right)=>{
        const leftRank = PLAYABLE_FORMATS.indexOf(String(left.format ?? ""));
        const rightRank = PLAYABLE_FORMATS.indexOf(String(right.format ?? ""));
        const normalizedLeft = leftRank === -1 ? PLAYABLE_FORMATS.length : leftRank;
        const normalizedRight = rightRank === -1 ? PLAYABLE_FORMATS.length : rightRank;
        return normalizedLeft - normalizedRight;
    });
    return videos[0] ?? null;
}
function buildDownloadUrl(identifier, fileName) {
    return `${DOWNLOAD_BASE}${encodeURIComponent(identifier)}/${fileName.split("/").map((part)=>encodeURIComponent(part)).join("/")}`;
}
function buildPosterUrl(identifier) {
    return `${IMAGE_BASE}${encodeURIComponent(identifier)}`;
}
function buildSearchUrl(query, limit, page) {
    const rows = Math.min(50, Math.max(limit * 2, limit));
    const params = [
        [
            "q",
            query
        ],
        [
            "rows",
            String(rows)
        ],
        [
            "page",
            String(page)
        ],
        [
            "output",
            "json"
        ],
        [
            "sort[]",
            "downloads desc"
        ],
        [
            "fl[]",
            "identifier"
        ],
        [
            "fl[]",
            "title"
        ],
        [
            "fl[]",
            "year"
        ],
        [
            "fl[]",
            "description"
        ]
    ];
    const queryString = params.map(([key, value])=>`${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    return `${SEARCH_BASE}?${queryString}`;
}
async function mapLimited(items, limit, task) {
    const results = [];
    let cursor = 0;
    const workers = Array.from({
        length: Math.min(limit, items.length)
    }, async ()=>{
        while(cursor < items.length){
            const index = cursor;
            cursor += 1;
            const item = items[index];
            if (item === undefined) {
                continue;
            }
            results[index] = await task(item);
        }
    });
    await Promise.all(workers);
    return results;
}
async function resolveItems(docs, ctx) {
    const probes = docs.slice(0, MAX_PROBES);
    const resolved = await mapLimited(probes, PROBE_CONCURRENCY, async (doc)=>{
        try {
            const meta = await withCache(ctx.cache, `meta:${doc.identifier}`, ()=>fetchJson(`${METADATA_BASE}${encodeURIComponent(doc.identifier)}`, ctx.limits, ctx.headers));
            const files = meta?.files;
            const file = pickVideoFile(files);
            if (!file?.name) {
                return null;
            }
            const item = {
                id: buildDownloadUrl(doc.identifier, file.name),
                title: doc.title,
                type: "movie",
                url: buildDownloadUrl(doc.identifier, file.name),
                poster: buildPosterUrl(doc.identifier),
                group: "公共领域"
            };
            if (doc.year !== undefined) {
                item.year = doc.year;
            }
            if (doc.description !== undefined) {
                item.description = doc.description;
            }
            return item;
        } catch  {
            // 单个条目失败（下架、限制、超时）直接跳过
            return null;
        }
    });
    return resolved.filter((item)=>item !== null).slice(0, ctx.limit);
}
async function archive_query(endpoint, ctx, condition) {
    const queryText = [
        DEFAULT_ARCHIVE_QUERY,
        condition
    ].filter((part)=>part.trim() !== "").join(" AND ");
    const page = Math.max(1, ctx.page ?? 1);
    const url = endpoint.trim() === "" ? buildSearchUrl(queryText, ctx.limit, page) : endpoint;
    const payload = await withCache(ctx.cache, `search:${url}`, ()=>fetchJson(url, ctx.limits, ctx.headers));
    return resolveItems(parseArchiveSearch(payload), ctx);
}
const archiveAdapter = {
    id: "archive",
    title: "Internet Archive 公共影库",
    description: "公共领域/开放授权影片，按热度检索，支持分页与关键词过滤",
    requiresEndpoint: false,
    async list (endpoint, ctx) {
        return archive_query(endpoint, ctx, "");
    },
    async search (endpoint, keyword, ctx) {
        const needle = keyword.replace(/["\\]/g, " ").trim();
        if (needle === "") {
            return [];
        }
        return archive_query(endpoint, ctx, `(title:(${needle}) OR description:(${needle}))`);
    }
};



const MAX_ITEMS = 5000;
function asHttpUrl(value) {
    if (typeof value !== "string" || value.trim() === "") {
        return null;
    }
    try {
        const url = new URL(value.trim());
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch  {
        return null;
    }
}
function asOptionalString(value) {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
function asSubtitles(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const subtitles = [];
    for (const candidate of value.slice(0, 50)){
        if (candidate === null || typeof candidate !== "object") {
            continue;
        }
        const raw = candidate;
        const url = asHttpUrl(raw.url);
        if (!url) {
            continue;
        }
        subtitles.push({
            title: asOptionalString(raw.title) ?? "字幕",
            lang: asOptionalString(raw.lang) ?? "und",
            url
        });
    }
    return subtitles.length > 0 ? subtitles : undefined;
}
/** 严格校验：任何一条不合法都跳过，而不是让整个来源失败。 */ function parseFeed(payload) {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        throw new HubError("INVALID_PAYLOAD", "目录数据必须是 JSON 对象");
    }
    const doc = payload;
    if (doc.version !== 1) {
        throw new HubError("INVALID_PAYLOAD", "不支持的目录协议版本，需要 version=1");
    }
    if (!Array.isArray(doc.items)) {
        throw new HubError("INVALID_PAYLOAD", "目录缺少 items 数组");
    }
    const items = [];
    for (const candidate of doc.items.slice(0, MAX_ITEMS)){
        if (candidate === null || typeof candidate !== "object") {
            continue;
        }
        const raw = candidate;
        const title = asOptionalString(raw.title);
        const playUrl = asHttpUrl(raw.url);
        if (!title || !playUrl) {
            continue;
        }
        const common = {
            title,
            type: raw.type === "tv" ? "tv" : "movie",
            description: asOptionalString(raw.description),
            poster: asHttpUrl(raw.poster) ?? undefined,
            backdrop: asHttpUrl(raw.backdrop) ?? undefined,
            year: raw.year === undefined ? undefined : String(raw.year),
            group: asOptionalString(raw.group),
            subtitles: asSubtitles(raw.subtitles)
        };
        const episodes = Array.isArray(raw.episodes) ? raw.episodes : [];
        if (episodes.length === 0) {
            items.push({
                ...common,
                id: playUrl,
                url: playUrl
            });
            continue;
        }
        episodes.slice(0, 200).forEach((episode, index)=>{
            if (episode === null || typeof episode !== "object") {
                return;
            }
            const rawEpisode = episode;
            const episodeUrl = asHttpUrl(rawEpisode.url);
            if (!episodeUrl) {
                return;
            }
            items.push({
                ...common,
                title: `${title} · ${asOptionalString(rawEpisode.title) ?? `第 ${index + 1} 集`}`,
                type: "tv",
                id: episodeUrl,
                url: episodeUrl
            });
        });
    }
    return items;
}
const feedAdapter = {
    id: "feed",
    title: "JSON 目录",
    description: "读取自部署服务按 rex-hub/1 协议输出的目录",
    requiresEndpoint: true,
    async list (endpoint, ctx) {
        const payload = await fetchJson(endpoint, ctx.limits, ctx.headers);
        return parseFeed(payload).slice(0, ctx.limit);
    },
    async search (endpoint, keyword, ctx) {
        const needle = keyword.trim().toLowerCase();
        if (needle === "") {
            return [];
        }
        const payload = await fetchJson(endpoint, ctx.limits, ctx.headers);
        return parseFeed(payload).filter((item)=>item.title.toLowerCase().includes(needle) || (item.group ?? "").toLowerCase().includes(needle)).slice(0, ctx.limit);
    }
};



const EXTINF = /^#EXTINF:\s*(-?[\d.]+)\s*(.*)$/;
const ATTR = /([A-Za-z0-9_-]+)="([^"]*)"/g;
const MAX_LINES = 20000;
/** 纯函数解析：不触网，便于单测与回归。 */ function parseM3U(text) {
    if (!text.includes("#EXTM3U")) {
        throw new HubError("INVALID_PAYLOAD", "不是 M3U 播放列表（缺少 #EXTM3U）");
    }
    const lines = text.split(/\r?\n/).slice(0, MAX_LINES);
    const entries = [];
    let pending = null;
    for (const rawLine of lines){
        const line = rawLine.trim();
        if (line === "") {
            continue;
        }
        if (line.startsWith("#EXTINF:")) {
            const match = EXTINF.exec(line);
            if (!match) {
                pending = null;
                continue;
            }
            const attrs = {};
            ATTR.lastIndex = 0;
            let attr = ATTR.exec(match[2] ?? "");
            while(attr !== null){
                attrs[attr[1].toLowerCase()] = attr[2];
                attr = ATTR.exec(match[2] ?? "");
            }
            const commaAt = (match[2] ?? "").lastIndexOf(",");
            const title = commaAt >= 0 ? (match[2] ?? "").slice(commaAt + 1).trim() : "";
            pending = {
                title,
                attrs
            };
            continue;
        }
        if (line.startsWith("#")) {
            continue;
        }
        let url;
        try {
            const parsed = new URL(line);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                pending = null;
                continue;
            }
            url = parsed.toString();
        } catch  {
            pending = null;
            continue;
        }
        entries.push({
            title: pending?.title && pending.title !== "" ? pending.title : url,
            url,
            attrs: pending?.attrs ?? {}
        });
        pending = null;
    }
    return entries;
}
function toItem(entry) {
    const logo = entry.attrs["tvg-logo"] ?? entry.attrs["logo"];
    const group = entry.attrs["group-title"];
    return {
        id: entry.url,
        title: entry.title,
        type: "tv",
        url: entry.url,
        poster: logo && /^https?:\/\//i.test(logo) ? logo : undefined,
        group: group && group !== "" ? group : undefined
    };
}
const playlistAdapter = {
    id: "playlist",
    title: "M3U 播放列表",
    description: "解析 M3U/M3U8 频道或点播列表，支持多来源合并",
    requiresEndpoint: true,
    async list (endpoint, ctx) {
        const text = await fetchText(endpoint, ctx.limits, ctx.headers);
        return parseM3U(text).slice(0, ctx.limit).map(toItem);
    },
    async search (endpoint, keyword, ctx) {
        const text = await fetchText(endpoint, ctx.limits, ctx.headers);
        const needle = keyword.trim().toLowerCase();
        if (needle === "") {
            return [];
        }
        return parseM3U(text).filter((entry)=>entry.title.toLowerCase().includes(needle)).slice(0, ctx.limit).map(toItem);
    }
};





/**
 * 内置适配器注册表。
 *
 * 新增来源只需要实现 {@link HubAdapter} 并在此登记；元数据、参数校验、合并逻辑
 * 与测试用例都从这里派生，不需要改动入口函数。
 */ const ADAPTERS = [
    archiveAdapter,
    playlistAdapter,
    feedAdapter
];
const DEFAULT_SOURCE = "archive";
function getAdapter(id) {
    const adapter = ADAPTERS.find((candidate)=>candidate.id === id);
    if (!adapter) {
        throw new HubError("UNSUPPORTED_SOURCE", `未知来源类型：${id}`);
    }
    return adapter;
}
function sourceOptions() {
    return ADAPTERS.map((adapter)=>({
            title: adapter.title,
            value: adapter.id
        }));
}







const CACHE_NAMESPACE = "rex-hub";
const MAX_ENDPOINTS = 8;
function contextOf(config) {
    return {
        limits: {
            timeoutMs: config.timeoutMs,
            maxBytes: config.maxBytes,
            allowPrivateHost: config.allowPrivateHost
        },
        limit: config.limit,
        headers: config.headers,
        query: config.query,
        page: config.page,
        cache: {
            ttlSeconds: config.cacheTtl,
            namespace: CACHE_NAMESPACE
        }
    };
}
/**
 * 把「预设地址 + 用户填写地址」合并成最终来源列表。
 *
 * - 预设只在用户没重复填写时生效，避免同一个列表被抓两次。
 * - 内置检索的来源（archive）允许没有地址：此时用适配器自带的检索。
 */ function resolveEndpoints(config, adapterId, requiresEndpoint) {
    const merged = [];
    const seen = new Set();
    const candidates = [
        ...presetEndpoints(config.preset).map((url)=>({
                name: new URL(url).hostname,
                url
            })),
        ...config.endpoints
    ];
    for (const entry of candidates){
        const key = entry.url === "" ? `builtin:${entry.name}` : entry.url;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        merged.push(entry);
    }
    if (!requiresEndpoint) {
        return merged.length > 0 ? merged : [
            {
                name: adapterId,
                url: ""
            }
        ];
    }
    if (merged.length === 0) {
        throw new HubError("MISSING_ENDPOINT", "请填写至少一个来源地址，或选择一个内置预设");
    }
    return merged.slice(0, MAX_ENDPOINTS);
}
/** 内部模型 → Rex 的 VideoItem。type=url 表示客户端可直接播放该地址。 */ function toVideoItems(items) {
    return items.map((item)=>({
            id: item.url,
            type: "url",
            title: item.title,
            coverUrl: item.poster,
            posterPath: item.poster,
            backdropPath: item.backdrop,
            detailPoster: item.poster,
            description: item.description,
            releaseDate: item.year,
            mediaType: item.type,
            genreTitle: item.group,
            videoUrl: item.url,
            link: item.url
        }));
}
async function listItems(params) {
    const config = readConfig(params, DEFAULT_SOURCE);
    const adapter = getAdapter(config.source);
    const endpoints = resolveEndpoints(config, adapter.id, adapter.requiresEndpoint);
    const ctx = contextOf(config);
    const { items, failures } = await collectAcross(endpoints, ctx, (endpoint)=>adapter.list(endpoint.url, ctx));
    return {
        items: toVideoItems(items),
        failures
    };
}
async function searchItems(params) {
    const keyword = typeof params?.keyword === "string" ? params.keyword.trim() : "";
    const config = readConfig(params, DEFAULT_SOURCE);
    const adapter = getAdapter(config.source);
    if (!adapter.search || keyword === "") {
        return {
            items: [],
            failures: []
        };
    }
    const endpoints = resolveEndpoints(config, adapter.id, adapter.requiresEndpoint);
    const ctx = {
        ...contextOf(config),
        keyword
    };
    const { items, failures } = await collectAcross(endpoints, ctx, (endpoint)=>adapter.search ? adapter.search(endpoint.url, keyword, ctx) : Promise.resolve([]));
    return {
        items: toVideoItems(items),
        failures
    };
}
/** 取流：Rex 会把上次返回的 videoUrl/link 回传，这里做最后一道协议校验。 */ function streamSources(params) {
    const config = readConfig(params, DEFAULT_SOURCE);
    const raw = [
        params?.videoUrl,
        params?.link,
        params?.id
    ].find((value)=>typeof value === "string" && value.trim() !== "");
    if (!raw) {
        throw new HubError("NOT_FOUND", "缺少播放地址，请从列表进入");
    }
    const url = assertAllowedUrl(raw, {
        timeoutMs: config.timeoutMs,
        maxBytes: config.maxBytes,
        allowPrivateHost: config.allowPrivateHost
    });
    return [
        {
            name: "直连",
            url: url.toString()
        }
    ];
}
/** 字幕：仅 JSON 目录协议携带字幕信息，M3U 列表与公共影库没有字幕。 */ async function subtitleEntries(params) {
    const config = readConfig(params, DEFAULT_SOURCE);
    const adapter = getAdapter(config.source);
    if (!adapter.search) {
        return [];
    }
    const title = typeof params?.title === "string" ? params.title.trim() : "";
    if (title === "") {
        return [];
    }
    const endpoints = resolveEndpoints(config, adapter.id, adapter.requiresEndpoint);
    const ctx = contextOf(config);
    for (const endpoint of endpoints){
        try {
            const items = await adapter.search(endpoint.url, title, ctx);
            const matched = items.find((item)=>item.subtitles && item.subtitles.length > 0);
            if (matched?.subtitles) {
                return matched.subtitles;
            }
        } catch  {
        // 单个来源失败时继续尝试下一个，最终由调用方降级为空列表。
        }
    }
    return [];
}
function toSubtitleItems(entries) {
    return entries.map((entry, index)=>({
            id: `hub-sub-${index}`,
            title: entry.title,
            lang: entry.lang,
            count: 1,
            url: entry.url
        }));
}




/** 与 package.json 的 version 保持一致（有单测守护）。 */ const HUB_VERSION = "0.2.0";
const HUB_ID = "rex-hub";
/**
 * Widget 元数据。Rex 读取全局 `WidgetMetadata` 来决定模块在设置页与资源库中的呈现。
 * 字段说明见 https://github.com/baranwang/rex-widget-libs 的 `@rexnow/libs/env/metadata`。
 */ function buildMetadata() {
    return {
        id: HUB_ID,
        title: "Rex Hub 多源聚合",
        description: "把公共影库、公开频道与自部署媒体来源合并成一个可切换、可配置的模块。",
        author: "YikR",
        version: HUB_VERSION,
        // 0.0.2 起支持 enumeration/count/page 参数与 stream 模块
        requiredVersion: "0.0.2",
        globalParams: [
            {
                name: "source",
                title: "来源类型",
                type: "enumeration",
                description: "archive：Internet Archive 公共影库（免配置）；playlist：M3U 列表；feed：rex-hub/1 JSON 目录",
                value: DEFAULT_SOURCE,
                enumOptions: sourceOptions()
            },
            {
                name: "preset",
                title: "内置预设",
                type: "enumeration",
                description: "一键填入公开频道列表，可与下方地址叠加",
                value: (/* inlined export .DEFAULT_PRESET */"custom"),
                enumOptions: presetOptions()
            },
            {
                name: "endpoint",
                title: "来源地址",
                type: "input",
                description: "一行一个地址，支持「名称=地址」；最多 8 个，会合并去重。archive 留空即用内置检索",
                value: ""
            },
            {
                name: "query",
                title: "检索条件",
                type: "input",
                description: "仅 archive：附加检索式，例如 collection:(sci-fi_horror) 或 year:1954",
                value: ""
            },
            {
                name: "page",
                title: "页码",
                type: "page",
                description: "仅 archive：从 1 开始的页码",
                value: "1"
            },
            {
                name: "limit",
                title: "结果上限",
                type: "count",
                description: "合并后的条目数上限",
                value: String(DEFAULTS.limit)
            },
            {
                name: "timeout",
                title: "超时（毫秒）",
                type: "count",
                description: "单个来源请求超时，1000–20000",
                value: String(DEFAULTS.timeoutMs)
            },
            {
                name: "cacheTtl",
                title: "缓存（秒）",
                type: "count",
                description: "上游响应的本地缓存时长，0 表示关闭",
                value: String(DEFAULTS.cacheTtl)
            },
            {
                name: "allowPrivateHost",
                title: "允许私有网段",
                type: "enumeration",
                description: "自部署服务在局域网时保持 true",
                value: "true",
                enumOptions: [
                    {
                        title: "允许",
                        value: "true"
                    },
                    {
                        title: "禁止",
                        value: "false"
                    }
                ]
            },
            {
                name: "headers",
                title: "请求头（JSON）",
                type: "input",
                description: '例如 {"Authorization":"Bearer xxx"}；仅本地保存，随请求发送',
                value: ""
            }
        ],
        modules: [
            {
                id: "hub-list",
                title: "浏览来源",
                description: "列出所有来源合并后的条目",
                functionName: "hubList",
                cacheDuration: 300,
                params: []
            },
            {
                id: "hub-search",
                title: "搜索",
                description: "在全部来源中按标题搜索",
                functionName: "hubSearch",
                cacheDuration: 120,
                params: [
                    {
                        name: "keyword",
                        title: "关键词",
                        type: "input"
                    }
                ]
            },
            {
                type: "stream",
                id: "loadResource",
                title: "获取播放地址",
                description: "把列表条目转换为可播放直链",
                functionName: "loadResource",
                params: []
            },
            {
                type: "subtitle",
                id: "loadSubtitle",
                title: "获取字幕",
                description: "读取 JSON 目录中声明的字幕",
                functionName: "loadSubtitle",
                params: []
            }
        ],
        search: {
            title: "搜索",
            functionName: "hubSearch",
            params: [
                {
                    name: "keyword",
                    title: "关键词",
                    type: "input"
                }
            ]
        }
    };
}




/**
 * Rex Widget 入口。
 *
 * 构建后（rslib + @rexnow/rslib-plugin）导出声明会被移除，保留顶层函数声明与
 * `WidgetMetadata` 赋值，宿主据此按 `functionName` 解析函数。
 */ WidgetMetadata = buildMetadata();
async function hubList(params) {
    try {
        const { items, failures } = await listItems(params);
        if (failures.length > 0) {
            report("hubList", new Error(failures.map((failure)=>`${failure.source}:${failure.code}`).join(", ")));
        }
        return items;
    } catch (error) {
        report("hubList", error);
        return [];
    }
}
async function hubSearch(params) {
    try {
        const { items } = await searchItems(params);
        return items;
    } catch (error) {
        report("hubSearch", error);
        return [];
    }
}
async function loadResource(params) {
    try {
        return streamSources(params);
    } catch (error) {
        report("loadResource", error);
        return [];
    }
}
async function loadSubtitle(params) {
    try {
        return toSubtitleItems(await subtitleEntries(params));
    } catch (error) {
        report("loadSubtitle", error);
        return [];
    }
}
