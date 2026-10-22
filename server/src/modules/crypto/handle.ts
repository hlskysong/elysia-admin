import config from '@/config';
import { BaseResultData } from '@/core/result';

/**
 * 获取请求加解密开关与 RSA 公钥（公开接口，明文返回）
 * @returns { enabled, publicKey }；未启用时 publicKey 为空字符串
 */
export async function getPublicKey() {
    const { enabled, publicKey } = config.crypto;
    return BaseResultData.ok({ enabled, publicKey: enabled ? publicKey.replace(/\\n/g, '\n') : '' });
};
