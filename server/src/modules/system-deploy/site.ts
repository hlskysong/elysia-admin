import path from 'node:path';

const LOCATION_KINDS = ['home', 'admin', 'api', 'rustfs', 'custom'] as const;

type LocationKind = (typeof LOCATION_KINDS)[number];

interface LocationItem {
    kind: LocationKind;
    name?: string;
    serve?: 'proxy' | 'static';
    path: string;
    port?: number;
    root?: string;
    maxBody?: string;
};

function defaultLocations(): LocationItem[] {
    return [
        { kind: 'home', path: '/', port: 4002 },
        { kind: 'admin', path: '/admin', root: '' },
        { kind: 'api', path: '/api', port: 4003 },
        { kind: 'rustfs', path: '/zqwz/', port: 9000, maxBody: '50m' },
    ];
};

function asLocation(item: any): LocationItem | null {
    if (!LOCATION_KINDS.includes(item?.kind)) return null;
    const row: LocationItem = {
        kind: item.kind,
        path: String(item.path || '/'),
    };
    if (item.kind === 'custom') {
        row.name = String(item.name || '').trim();
        row.serve = item.serve === 'static' ? 'static' : 'proxy';
        if (row.serve === 'static') {
            row.root = item.root ? String(item.root) : '';
            return row;
        };
        row.port = Number(item.port);
        if (item.maxBody) row.maxBody = String(item.maxBody);
        return row;
    };
    if (item.kind === 'admin') {
        row.root = item.root ? String(item.root) : '';
        return row;
    };
    row.port = Number(item.port);
    if (item.kind === 'rustfs') row.maxBody = item.maxBody ? String(item.maxBody) : '50m';
    return row;
};

function fromLegacy(raw: Record<string, any>): LocationItem[] {
    const list: LocationItem[] = [];
    if (Array.isArray(raw.webs)) {
        for (const web of raw.webs) {
            list.push({ kind: 'home', path: String(web?.path || '/'), port: Number(web?.port) });
        };
    };
    if (raw.admin?.enabled !== false && raw.admin?.path) {
        list.push({ kind: 'admin', path: String(raw.admin.path), root: raw.admin.root ? String(raw.admin.root) : '' });
    };
    if (raw.api?.enabled !== false && raw.api?.path) {
        list.push({ kind: 'api', path: String(raw.api.path), port: Number(raw.api.port) });
    };
    if (raw.rustfs?.enabled !== false && raw.rustfs?.path) {
        list.push({
            kind: 'rustfs',
            path: String(raw.rustfs.path),
            port: Number(raw.rustfs.port),
            maxBody: raw.rustfs.maxBody ? String(raw.rustfs.maxBody) : '50m',
        });
    };
    return list;
};

/**
 * 把站点路径收成数组。未传时用四条预设；已经是数组则原样保留，包括空数组
 * @param input 请求里的 locations
 * @returns 预设路径和自定义路径
 */
export function normalizeLocations(input: unknown): LocationItem[] {
    if (Array.isArray(input)) {
        return input.map(asLocation).filter((item): item is LocationItem => Boolean(item));
    };
    if (input && typeof input === 'object') {
        const raw = input as Record<string, any>;
        if ('webs' in raw || 'admin' in raw || 'api' in raw || 'rustfs' in raw) return fromLegacy(raw);
    };
    return defaultLocations();
};

function unsafeText(value: string): boolean {
    return /[\r\n;$`{}]/.test(value);
};

function validDomain(value: string): boolean {
    return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(value);
};

/**
 * 判断邮箱格式
 * @param value 邮箱
 * @returns 是否为邮箱
 */
export function validEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

function validPath(value: string): boolean {
    return value.startsWith('/') && !unsafeText(value) && !value.includes('..');
};

/** 宝塔路径会拼接站点名，仅允许安全字符 */
function validSiteName(value: string): boolean {
    return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
};

/**
 * 校验站点表单，返回中文错误；通过时返回空字符串
 * @param body 创建或更新的请求体
 * @returns 错误文案，空字符串表示通过
 */
export function validateSite(body: Record<string, any>): string {
    if (!body.name || !validSiteName(String(body.name))) {
        return '站点名仅允许字母、数字、下划线和连字符，且需以字母或数字开头';
    };
    if (!validDomain(String(body.serverName || ''))) return '域名格式不正确';
    for (const key of ['wwwRoot', 'webRoot', 'certDir'] as const) {
        if (body[key] && unsafeText(String(body[key]))) return '目录不能包含特殊字符';
    };
    if (body.sslAutoRenew && !body.email) return '开启自动续签时邮箱不能为空';
    if (body.email && !validEmail(String(body.email))) return '邮箱格式不正确';
    const locations = normalizeLocations(body.locations);
    const seen = new Set<string>();
    for (const item of locations) {
        if (!validPath(item.path)) return '路径格式不正确';
        if (seen.has(item.path)) return '路径不能重复';
        seen.add(item.path);
        if (item.kind === 'custom') {
            if (!item.name) return '请填写自定义名称';
            if (unsafeText(item.name) || item.name.length > 32) return '自定义名称不正确';
        };
        const asStatic = item.kind === 'admin' || (item.kind === 'custom' && item.serve === 'static');
        if (asStatic) {
            if (item.root && unsafeText(item.root)) return '目录不能包含特殊字符';
            continue;
        };
        if (!Number.isInteger(item.port) || item.port! < 1 || item.port! > 65535) return '端口不正确';
        if (item.maxBody && !/^[1-9]\d{0,4}[kmgKMG]?$/.test(item.maxBody)) return '上传大小格式不正确';
    };
    return '';
};

/**
 * 写入开关默认值和目录默认值
 * @param body 创建或更新的请求体
 * @returns 无，直接改请求体
 */
export function applyDefaults(body: Record<string, any>) {
    body.sslAutoRenew = Boolean(body.sslAutoRenew);
    body.reloadNginx = Boolean(body.reloadNginx);
    body.useBaota = body.useBaota !== false;
    body.httpRedirect = body.httpRedirect !== false;
    body.locations = normalizeLocations(body.locations);
    if (!body.webRoot) body.webRoot = process.cwd();
    if (!body.certDir) body.certDir = path.join(process.cwd(), 'storage', 'certs', body.serverName);
    for (const item of body.locations) {
        const asStatic = item.kind === 'admin' || (item.kind === 'custom' && item.serve === 'static');
        if (asStatic && !item.root) item.root = body.wwwRoot || '';
    };
};

function absDir(value: string | null | undefined, fallback: string): string {
    const raw = value && String(value).trim() ? String(value) : fallback;
    return path.resolve(raw);
};

/**
 * 计算站点校验目录和证书目录的绝对路径
 * @param site 站点档案
 * @returns webRoot、certDir、challengeDir
 */
export function sitePaths(site: Record<string, any>) {
    const webRoot = absDir(site.webRoot, process.cwd());
    const certDir = absDir(site.certDir, path.join(process.cwd(), 'storage', 'certs', site.serverName));
    return {
        webRoot,
        certDir,
        challengeDir: path.join(webRoot, '.well-known', 'acme-challenge'),
    };
};

/**
 * 给站点补上绝对路径，供卡片和详情展示
 * @param site 站点档案
 * @returns 原字段加上 webRootAbs、certDirAbs、challengeDir
 */
export function withPaths<T extends Record<string, any>>(site: T) {
    const paths = sitePaths(site);
    return { ...site, webRootAbs: paths.webRoot, certDirAbs: paths.certDir, challengeDir: paths.challengeDir };
};