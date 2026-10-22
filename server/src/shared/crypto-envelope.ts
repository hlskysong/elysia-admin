import config from '@/config';

const IV_LENGTH = 12;
let privateKeyPromise: Promise<CryptoKey> | null = null;

/**
 * PEM 转 DER 字节
 * @param pem PEM 文本（支持用 \n 字面量表示换行）
 * @returns DER 字节
 */
function PemToDer(pem: string): Uint8Array<ArrayBuffer> {
    const body = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    return Uint8Array.from(Buffer.from(body, 'base64'));
};

/**
 * 获取（并缓存）RSA 私钥
 * @returns RSA-OAEP 私钥
 */
function GetPrivateKey(): Promise<CryptoKey> {
    privateKeyPromise ??= crypto.subtle.importKey(
        'pkcs8',
        PemToDer(config.crypto.privateKey),
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['decrypt'],
    );
    return privateKeyPromise;
};

/**
 * 用 RSA 私钥解出前端随机生成的 AES 密钥
 * @param wrappedKey Base64 编码的 RSA-OAEP 密文
 * @returns AES-GCM 密钥（可加解密）
 */
export async function RsaDecryptKey(wrappedKey: string): Promise<CryptoKey> {
    const raw = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        await GetPrivateKey(),
        Uint8Array.from(Buffer.from(wrappedKey, 'base64')),
    );
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

/**
 * AES-GCM 解密
 * @param key AES-GCM 密钥
 * @param payload Base64(iv + 密文)
 * @returns 明文字符串
 */
export async function AesGcmDecrypt(key: CryptoKey, payload: string): Promise<string> {
    const buf = Uint8Array.from(Buffer.from(payload, 'base64'));
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: buf.slice(0, IV_LENGTH) },
        key,
        buf.slice(IV_LENGTH),
    );
    return new TextDecoder().decode(plain);
};

/**
 * AES-GCM 加密（随机 IV）
 * @param key AES-GCM 密钥
 * @param text 明文字符串
 * @returns Base64(iv + 密文)
 */
export async function AesGcmEncrypt(key: CryptoKey, text: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
    const out = new Uint8Array(IV_LENGTH + cipher.length);
    out.set(iv, 0);
    out.set(cipher, IV_LENGTH);
    return Buffer.from(out).toString('base64');
};