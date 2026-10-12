import { mkdir, chmod, rename, unlink, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { FlattenedSign, importPKCS8, exportJWK, calculateJwkThumbprint } from 'jose';
import { InsertOne, UpdateByKey } from '@/core/database/repository';
import { RunTransaction } from '@/core/database/transaction';
import { logger } from '@/shared/logger';
import { systemDeployCertSchema, systemDeploySiteSchema } from '@database/schema/system_deploy';
import { sitePaths, validEmail } from './site';

const LE_DIRECTORY = 'https://acme-v02.api.letsencrypt.org/directory';
const RENEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const USER_AGENT = 'elysia-admin';

type RenewSource = 'manual' | 'cron';

async function readPipe(stream: unknown): Promise<string> {
    if (!stream || typeof stream === 'number') return '';
    return await new Response(stream as BodyInit).text();
};

async function runOpenssl(args: string[]) {
    let proc: ReturnType<typeof Bun.spawn>;
    try {
        proc = Bun.spawn(['openssl', ...args], { stdout: 'pipe', stderr: 'pipe' });
    } catch {
        throw new Error('本机未找到 openssl，无法申请证书');
    }
    const stderr = await readPipe(proc.stderr);
    const code = await proc.exited;
    if (code !== 0) {
        if (/not found|ENOENT/i.test(stderr)) throw new Error('本机未找到 openssl，无法申请证书');
        throw new Error(stderr.trim() || 'openssl 执行失败');
    };
};

async function replaceFile(tmp: string, dest: string) {
    const bak = `${dest}.bak`;
    let moved = false;
    try {
        await rename(dest, bak);
        moved = true;
    } catch {
        moved = false;
    }
    try {
        await rename(tmp, dest);
        if (moved) await unlink(bak).catch(() => undefined);
    } catch (error) {
        if (moved) await rename(bak, dest).catch(() => undefined);
        throw error;
    }
};

async function getDirectory() {
    const res = await fetch(LE_DIRECTORY, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error('无法连接证书颁发机构');
    return await res.json() as Record<string, string>;
};

async function loadAccountKey() {
    const dir = path.join(process.cwd(), 'storage', 'certs');
    await mkdir(dir, { recursive: true });
    const pemFile = path.join(dir, 'account.pem');
    const urlFile = path.join(dir, 'account.url');
    let pem = await readFile(pemFile, 'utf8').catch(() => '');
    if (!pem) {
        await runOpenssl(['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', pemFile]);
        await chmod(pemFile, 0o600).catch(() => undefined);
        pem = await readFile(pemFile, 'utf8');
    };
    const key = await importPKCS8(pem, 'ES256');
    const exported = await exportJWK(key);
    const jwk = { kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y };
    const thumb = await calculateJwkThumbprint(jwk, 'sha256');
    const accountUrl = (await readFile(urlFile, 'utf8').catch(() => '')).trim();
    return { key, jwk, thumb, pemFile, urlFile, accountUrl };
};

async function acmePost(
    url: string,
    payload: Record<string, unknown> | null,
    account: Awaited<ReturnType<typeof loadAccountKey>>,
    nonceUrl: string,
    kid?: string,
) {
    let nonce = '';
    const head = await fetch(nonceUrl, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
    nonce = head.headers.get('replay-nonce') || '';
    if (!nonce) throw new Error('未获取到证书校验随机数');
    for (let attempt = 0; attempt < 2; attempt++) {
        const header: Record<string, unknown> = { alg: 'ES256', nonce, url };
        if (kid) header.kid = kid;
        else header.jwk = account.jwk;
        const encoded = new TextEncoder().encode(payload === null ? '' : JSON.stringify(payload));
        const jws = await new FlattenedSign(encoded).setProtectedHeader(header).sign(account.key);
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/jose+json', 'User-Agent': USER_AGENT },
            body: JSON.stringify(jws),
        });
        const text = await res.text();
        const nextNonce = res.headers.get('replay-nonce');
        if (nextNonce) nonce = nextNonce;
        let json: any = null;
        if (text) {
            try { json = JSON.parse(text); } catch { json = text; }
        };
        if (res.ok) return { status: res.status, json, location: res.headers.get('location') || '' };
        const detail = typeof json === 'object' && json ? (json.detail || json.type || text) : text;
        if (String(json?.type || '').includes('badNonce') && attempt === 0) continue;
        throw new Error(detail || '证书申请失败');
    };
    throw new Error('证书申请失败');
};

async function ensureAccount(email: string, directory: Record<string, string>, account: Awaited<ReturnType<typeof loadAccountKey>>) {
    if (account.accountUrl) return account.accountUrl;
    const createBody = { termsOfServiceAgreed: true, contact: [`mailto:${email}`] };
    try {
        const existing = await acmePost(directory.newAccount, { ...createBody, onlyReturnExisting: true }, account, directory.newNonce);
        if (existing.location) {
            await writeFile(account.urlFile, existing.location, 'utf8');
            return existing.location;
        };
    } catch {
        // 账户尚未注册，下面会新建
    }
    const created = await acmePost(directory.newAccount, createBody, account, directory.newNonce);
    if (!created.location) throw new Error('未获得证书账户地址');
    await writeFile(account.urlFile, created.location, 'utf8');
    return created.location;
};

/**
 * 截断写入数据库的说明文字
 * @param text 原文
 * @param max 最大长度
 * @returns 截断后的文字
 */
export function clip(text: string, max = 480) {
    return text.length > max ? text.slice(0, max) : text;
};

async function saveFailure(siteId: number, source: RenewSource, message: string) {
    const text = clip(message);
    await InsertOne(systemDeployCertSchema, null, {
        siteId,
        success: false,
        isCurrent: false,
        renewSource: source,
        message: text,
    });
    await UpdateByKey(systemDeploySiteSchema, 'siteId', null, {
        siteId,
        lastRenewAt: new Date(),
        lastRenewMsg: text,
    });
};

async function saveSuccess(site: Record<string, any>, source: RenewSource, pem: string, message: string) {
    const cert = new X509Certificate(pem);
    const notBefore = new Date(cert.validFrom);
    const notAfter = new Date(cert.validTo);
    const text = clip(message);
    await RunTransaction(async (tx) => {
        await tx.update(systemDeployCertSchema)
            .set({ isCurrent: false, updateTime: new Date() })
            .where(and(
                eq(systemDeployCertSchema.siteId, site.siteId),
                eq(systemDeployCertSchema.isCurrent, true),
                eq(systemDeployCertSchema.delFlag, false),
            ));
        await tx.insert(systemDeployCertSchema).values({
            siteId: site.siteId,
            issuer: clip(cert.issuer, 250),
            serialNumber: clip(cert.serialNumber, 120),
            fingerprint: clip(cert.fingerprint256, 120),
            notBefore,
            notAfter,
            success: true,
            isCurrent: true,
            renewSource: source,
            message: text,
        });
        await tx.update(systemDeploySiteSchema)
            .set({
                certExpireAt: notAfter,
                lastRenewAt: new Date(),
                lastRenewMsg: text,
                updateTime: new Date(),
            })
            .where(eq(systemDeploySiteSchema.siteId, site.siteId));
    });
};

async function issueCertificate(site: Record<string, any>, source: RenewSource) {
    if (!site.email || !validEmail(String(site.email))) throw new Error('开启续签前请先填写邮箱');
    const paths = sitePaths(site);
    const domain = String(site.serverName);
    await mkdir(paths.certDir, { recursive: true });
    await mkdir(paths.challengeDir, { recursive: true });
    const directory = await getDirectory();
    const account = await loadAccountKey();
    const kid = await ensureAccount(String(site.email), directory, account);
    const orderRes = await acmePost(
        directory.newOrder,
        { identifiers: [{ type: 'dns', value: domain }] },
        account,
        directory.newNonce,
        kid,
    );
    const order = orderRes.json;
    const authUrl = order?.authorizations?.[0];
    const orderUrl = orderRes.location;
    if (!authUrl || !order?.finalize || !orderUrl) throw new Error('证书订单创建失败');
    const authRes = await acmePost(authUrl, null, account, directory.newNonce, kid);
    const challenge = (authRes.json?.challenges || []).find((item: any) => item.type === 'http-01');
    if (!challenge?.token || !challenge?.url) throw new Error('未获得 HTTP 校验信息');
    const keyAuth = `${challenge.token}.${account.thumb}`;
    const challengeFile = path.join(paths.challengeDir, challenge.token);
    try {
        await writeFile(challengeFile, keyAuth, 'utf8');
        await acmePost(challenge.url, {}, account, directory.newNonce, kid);
        let status = authRes.json?.status;
        for (let i = 0; i < 20 && status !== 'valid'; i++) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            const polled = await acmePost(authUrl, null, account, directory.newNonce, kid);
            status = polled.json?.status;
            if (status === 'invalid') {
                const reason = polled.json?.challenges?.find((item: any) => item.type === 'http-01')?.error?.detail;
                throw new Error(reason || '域名校验失败，请确认 80 端口能访问校验目录');
            };
        };
        if (status !== 'valid') throw new Error('域名校验超时');
        const keyTmp = path.join(paths.certDir, 'privkey.pem.tmp');
        const csrFile = path.join(paths.certDir, 'request.csr.der');
        const fullTmp = path.join(paths.certDir, 'fullchain.pem.tmp');
        await runOpenssl(['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', keyTmp]);
        await runOpenssl(['req', '-new', '-key', keyTmp, '-subj', `/CN=${domain}`, '-outform', 'DER', '-out', csrFile]);
        const csr = (await readFile(csrFile)).toString('base64url');
        await acmePost(order.finalize, { csr }, account, directory.newNonce, kid);
        let certificateUrl = '';
        for (let i = 0; i < 20 && !certificateUrl; i++) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const polled = await acmePost(orderUrl, null, account, directory.newNonce, kid);
            if (polled.json?.status === 'invalid') throw new Error(polled.json?.error?.detail || '证书签发失败');
            certificateUrl = polled.json?.certificate || '';
        };
        if (!certificateUrl) throw new Error('证书签发超时');
        const certRes = await acmePost(certificateUrl, null, account, directory.newNonce, kid);
        const pem = typeof certRes.json === 'string' ? certRes.json : '';
        if (!pem.includes('BEGIN CERTIFICATE')) throw new Error('未下载到证书内容');
        await writeFile(fullTmp, pem, 'utf8');
        await chmod(keyTmp, 0o600).catch(() => undefined);
        await replaceFile(fullTmp, path.join(paths.certDir, 'fullchain.pem'));
        await replaceFile(keyTmp, path.join(paths.certDir, 'privkey.pem'));
        await chmod(path.join(paths.certDir, 'fullchain.pem'), 0o644).catch(() => undefined);
        await chmod(path.join(paths.certDir, 'privkey.pem'), 0o600).catch(() => undefined);
        await unlink(csrFile).catch(() => undefined);
        await saveSuccess(site, source, pem, '证书已更新');
    } finally {
        await unlink(challengeFile).catch(() => undefined);
        await unlink(path.join(paths.certDir, 'privkey.pem.tmp')).catch(() => undefined);
        await unlink(path.join(paths.certDir, 'fullchain.pem.tmp')).catch(() => undefined);
        await unlink(path.join(paths.certDir, 'request.csr.der')).catch(() => undefined);
    }
};

/**
 * 执行 nginx -s reload，失败时返回中文原因
 * @returns 重载结果说明
 */
export async function reloadNginxProcess(): Promise<string> {
    try {
        const proc = Bun.spawn(['nginx', '-s', 'reload'], { stdout: 'pipe', stderr: 'pipe' });
        const stderr = await readPipe(proc.stderr);
        const code = await proc.exited;
        if (code !== 0) return `Nginx 重载失败：${stderr.trim() || '请到面板重载'}`;
        return '已执行 Nginx 重载';
    } catch {
        return 'Nginx 重载失败：请到面板重载';
    }
};

async function finishMessage(site: Record<string, any>, reload: boolean) {
    if (!reload) {
        const text = '证书已更新。需要自己到面板重载，自动轮换的证书才会生效';
        await UpdateByKey(systemDeploySiteSchema, 'siteId', null, { siteId: site.siteId, lastRenewMsg: text });
        return text;
    }
    const reloadText = await reloadNginxProcess();
    const text = clip(`证书已更新。${reloadText}`);
    await UpdateByKey(systemDeploySiteSchema, 'siteId', null, { siteId: site.siteId, lastRenewMsg: text });
    return text;
};

/**
 * 为单个站点申请新证并写入结果
 * @param site 站点档案
 * @param source manual 为立即续签，cron 为定时任务
 * @param reload 为 true 且站点开启自动重载时执行 nginx -s reload
 * @returns ok 与给前端或记录用的说明
 */
export async function renewOne(site: Record<string, any>, source: RenewSource, reload: boolean) {
    try {
        await issueCertificate(site, source);
        const message = await finishMessage(site, reload && Boolean(site.reloadNginx));
        return { ok: true, message };
    } catch (error: any) {
        const message = clip(error?.message || '证书申请失败');
        logger.error(`站点 ${site.serverName} 续签失败: ${message}`);
        await saveFailure(site.siteId, source, message).catch((err) => logger.error('写入续签失败记录出错', err));
        return { ok: false, message };
    }
};

/**
 * 没有证书，或剩余不足 30 天时需要续签
 * @param site 站点档案
 * @returns 是否到期
 */
export function isDue(site: Record<string, any>) {
    if (!site.certExpireAt) return true;
    return new Date(site.certExpireAt).getTime() - Date.now() < RENEW_WINDOW_MS;
};