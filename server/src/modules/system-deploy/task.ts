import { logger } from '@/shared/logger';
import { RenewDueCerts } from './handle';

/**
 * 定时续签入口，供 system-cron-queue 调用
 * @returns 无。到期不足 30 天的站点会重新申请证书
 */
export async function renewDueCerts() {
    logger.info('站点证书续签开始');
    await RenewDueCerts();
    logger.info('站点证书续签结束');
};