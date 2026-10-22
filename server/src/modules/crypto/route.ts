import type { IRouteModule } from "@/types/route";
import { getPublicKey } from "./handle";
import { PublicKeyDto } from "./dto";

const CryptoModule: IRouteModule = {
    tags: '加解密模块',
    routes: [
        { url: '/crypto/public-key', method: 'get', summary: '获取加解密开关与RSA公钥', dto: PublicKeyDto, handle: getPublicKey, meta: { ipRateLimit: '60:30' } },
    ]
};

export default CryptoModule;