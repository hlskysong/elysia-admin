import type { Elysia } from 'elysia';
import config from '@/config';
import { BaseResultData } from '@/core/result';
import { RsaDecryptKey, AesGcmDecrypt, AesGcmEncrypt } from '@/shared/crypto-envelope';

const KEY_HEADER = 'x-encrypt-key';
const requestKeys = new WeakMap<Request, CryptoKey>();
const plainResponses = new WeakMap<Request, unknown>();
const parseFailed = new WeakSet<Request>();

/**
 * 构造带 httpStatus 的错误，交由全局 error-handler 输出中文提示
 * @param message 错误提示
 * @returns Error
 */
function CryptoError(message: string) {
    const e = new Error(message) as Error & { httpStatus?: number };
    e.httpStatus = 400;
    return e;
};

/**
 * 请求/响应加解密中间件（RSA + AES-GCM）
 *
 * 1. onRequest：请求头带 X-Encrypt-Key 时，用 RSA 私钥解出本次 AES 密钥并按 Request 缓存
 * 2. onParse：JSON 请求体为 { data: 密文 } 时解密成对象，下游校验与 handle 无感知
 * 3. mapResponse：本次请求有 AES 密钥且响应为 JSON 对象时，加密成 { encrypted: true, data }
 *
 * 无 X-Encrypt-Key 的明文请求原样放行；enabled=false 时不注册。
 * @param app Elysia 实例
 */
export function CryptoMiddleware(app: Elysia) {
    if (!config.crypto.enabled) return;
    app.onRequest(async ({ request }) => {
        const wrapped = request.headers.get(KEY_HEADER);
        if (!wrapped) return;
        try {
            requestKeys.set(request, await RsaDecryptKey(wrapped));
        } catch {
            throw CryptoError('请求解密失败');
        }
    });
    app.onParse(async ({ request, contentType }) => {
        const key = requestKeys.get(request);
        if (!key || !contentType?.includes('application/json')) return;
        const text = await request.text();
        if (!text) return;
        try {
            const { data } = JSON.parse(text);
            return JSON.parse(await AesGcmDecrypt(key, data));
        } catch {
            parseFailed.add(request);
            throw CryptoError('请求解密失败');
        }
    });
    // Elysia 会把 onParse 抛出的异常包装成 PARSE 错误，这里还原为中文 400
    app.onError(({ code, request, set }) => {
        if (code !== 'PARSE' || !parseFailed.has(request)) return;
        set.status = 400;
        return BaseResultData.fail(400, '请求解密失败');
    });
    app.mapResponse(async ({ request, response, set }) => {
        const key = requestKeys.get(request);
        if (!key || response === null || typeof response !== 'object') return;
        if (response instanceof Response || response instanceof Blob || response instanceof ReadableStream) return;
        plainResponses.set(request, response);
        const body = JSON.stringify({ encrypted: true, data: await AesGcmEncrypt(key, JSON.stringify(response)) });
        const headers = new Headers(set.headers as Record<string, string>);
        headers.set('content-type', 'application/json');
        headers.set('x-encrypted', '1');
        return new Response(body, { status: typeof set.status === 'number' ? set.status : 200, headers });
    });
    // 加密后 afterResponse 拿到的是 Response 对象；还原为加密前的业务对象，
    // 供后续 afterResponse（请求日志、操作日志、限流记录）读取 response.code 等字段
    app.onAfterResponse((ctx) => {
        const plain = plainResponses.get(ctx.request);
        if (plain !== undefined) (ctx as any).response = plain;
    });
};