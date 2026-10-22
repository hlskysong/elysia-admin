import { t } from 'elysia';
import { BaseResultDto } from '@/types/dto';

export const PublicKeyDto = {
    ...BaseResultDto(t.Object({
        enabled: t.Boolean({ description: '是否启用请求加解密' }),
        publicKey: t.String({ description: 'RSA 公钥（PEM）' }),
    })),
};
