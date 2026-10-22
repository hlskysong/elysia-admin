/**
 * 请求/响应加解密工具（RSA-OAEP + AES-GCM，基于浏览器 Web Crypto，无额外依赖）
 *
 * 协议：每次请求生成随机 AES-256 密钥，用后端 RSA 公钥加密后放入 X-Encrypt-Key 请求头；
 * 请求体/响应体使用 AES-GCM 加密，格式为 Base64(iv(12) + 密文)。
 *
 * @module utils/crypto
 */
import axios from 'axios'

const IV_LENGTH = 12
const { VITE_API_URL, VITE_API_ENCRYPT } = import.meta.env

let publicKeyPromise: Promise<CryptoKey | null> | null = null

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

/** 从后端获取开关与公钥；失败或未启用返回 null（自动退回明文） */
async function fetchPublicKey(): Promise<CryptoKey | null> {
  try {
    const res = await axios.get(`${VITE_API_URL}/api/crypto/public-key`)
    const { enabled, publicKey } = res.data?.data ?? {}
    if (!enabled || !publicKey) return null
    const body = String(publicKey).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    return await crypto.subtle.importKey(
      'spki',
      fromBase64(body),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    )
  } catch {
    return null
  }
}

/** 是否启用加密：前端开关开启且后端也启用时返回公钥，否则返回 null；公钥只拉取一次 */
export function getEncryptPublicKey(): Promise<CryptoKey | null> {
  if (VITE_API_ENCRYPT !== 'true') return Promise.resolve(null)
  publicKeyPromise ??= fetchPublicKey()
  return publicKeyPromise
}

/** AES-GCM 加密字符串，返回 Base64(iv + 密文) */
export async function aesEncrypt(key: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))
  )
  const out = new Uint8Array(IV_LENGTH + cipher.length)
  out.set(iv, 0)
  out.set(cipher, IV_LENGTH)
  return toBase64(out)
}

/** AES-GCM 解密 Base64(iv + 密文)，返回明文字符串 */
export async function aesDecrypt(key: CryptoKey, payload: string): Promise<string> {
  const buf = fromBase64(payload)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf.slice(0, IV_LENGTH) },
    key,
    buf.slice(IV_LENGTH)
  )
  return new TextDecoder().decode(plain)
}

/**
 * 生成本次请求的 AES 密钥，并用公钥加密
 * @returns aesKey 用于加密请求体与解密响应；wrappedKey 放入 X-Encrypt-Key 请求头
 */
export async function createRequestKey(publicKey: CryptoKey) {
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt'
  ])
  const raw = await crypto.subtle.exportKey('raw', aesKey)
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, raw)
  return { aesKey, wrappedKey: toBase64(new Uint8Array(wrapped)) }
}
