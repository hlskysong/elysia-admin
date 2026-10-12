import { and, eq, ne } from 'drizzle-orm';
import type { AppContext } from '@/types/app-context';
import { BaseResultData } from '@/core/result';
import {
    InsertOne,
    FindOneByKey,
    UpdateByKey,
    SoftDeleteByKeys,
    CreateQueryBuilder,
    FindPage,
    FindAll,
} from '@/core/database/repository';
import { RedisLock } from '@/core/database/redis-lock';
import { logger } from '@/shared/logger';
import { systemDeployCertSchema, systemDeploySiteSchema } from '@database/schema/system_deploy';
import { clip, isDue, reloadNginxProcess, renewOne } from './acme';
import { renderNginx } from './nginx';
import { applyDefaults, sitePaths, validateSite, withPaths } from './site';

const LOCK_NAME = 'deploy-cert-renew';

function formBody(ctx: AppContext): Record<string, any> {
    return (ctx.body ?? {}) as Record<string, any>;
}

async function domainTaken(serverName: string, siteId?: number) {
    const where = siteId
        ? and(eq(systemDeploySiteSchema.delFlag, false), eq(systemDeploySiteSchema.serverName, serverName), ne(systemDeploySiteSchema.siteId, siteId))
        : and(eq(systemDeploySiteSchema.delFlag, false), eq(systemDeploySiteSchema.serverName, serverName));
    const rows = await FindAll(systemDeploySiteSchema, where, { limit: 1 });
    return rows.length > 0;
};

/**
 * 创建站点
 * @param ctx 请求上下文，body 为站点表单
 * @returns 成功无数据；域名重复或校验失败时返回中文错误
 */
export async function create(ctx: AppContext) {
    const body = formBody(ctx);
    const message = validateSite(body);
    if (message) return BaseResultData.fail(400, message);
    applyDefaults(body);
    if (await domainTaken(body.serverName)) return BaseResultData.fail(400, '域名已存在');
    ctx.body = body;
    await InsertOne(systemDeploySiteSchema, ctx);
    return BaseResultData.ok();
};

/**
 * 分页查询站点（排除软删）
 * @param ctx 请求上下文，query 见 ListDto
 * @returns 分页列表
 */
export async function findList(ctx: AppContext) {
    const {
        pageNum = 1,
        pageSize = 10,
        orderByColumn = 'createTime',
        sortRule = 'desc',
        startTime,
        endTime,
        name,
        serverName,
    } = ctx.query;
    const whereCondition = CreateQueryBuilder(systemDeploySiteSchema)
        .eq('delFlag', false)
        .like('name', name)
        .like('serverName', serverName)
        .dateRange('createTime', startTime, endTime)
        .build();
    const res = await FindPage(systemDeploySiteSchema, whereCondition, {
        pageNum,
        pageSize,
        orderByColumn,
        sortRule,
    });
    return BaseResultData.ok(res);
};

/**
 * 查询全部未删除站点，供工作台卡片使用
 * @returns 带校验目录绝对路径的站点数组
 */
export async function findAll() {
    const rows = await FindAll(systemDeploySiteSchema, eq(systemDeploySiteSchema.delFlag, false), {
        orderByColumn: 'createTime',
        sortRule: 'desc',
    });
    return BaseResultData.ok(rows.map((row) => withPaths(row)));
};

/**
 * 按主键查询站点详情
 * @param ctx 请求上下文，params.id 为站点 ID
 * @returns 站点详情；不存在时 404
 */
export async function findOne(ctx: AppContext) {
    const id = Number(ctx.params.id);
    const data = await FindOneByKey(systemDeploySiteSchema, 'siteId', id);
    if (!data || data.delFlag) return BaseResultData.fail(404, '站点不存在');
    return BaseResultData.ok(withPaths(data));
};

/**
 * 更新站点
 * @param ctx 请求上下文，body 含 siteId
 * @returns 成功无数据
 */
export async function update(ctx: AppContext) {
    const body = formBody(ctx);
    const message = validateSite(body);
    if (message) return BaseResultData.fail(400, message);
    applyDefaults(body);
    const current = await FindOneByKey(systemDeploySiteSchema, 'siteId', Number(body.siteId));
    if (!current || current.delFlag) return BaseResultData.fail(404, '站点不存在');
    if (await domainTaken(body.serverName, Number(body.siteId))) return BaseResultData.fail(400, '域名已存在');
    ctx.body = body;
    await UpdateByKey(systemDeploySiteSchema, 'siteId', ctx);
    return BaseResultData.ok();
};

/**
 * 软删除站点
 * @param ctx 请求上下文，params.ids 为主键，可逗号分隔
 * @returns 成功无数据
 */
export async function remove(ctx: AppContext) {
    await SoftDeleteByKeys(systemDeploySiteSchema, 'siteId', ctx);
    return BaseResultData.ok();
};

/**
 * 返回仅 HTTP 与含 SSL 两套配置，以及校验文件目录
 * @param ctx 请求上下文，params.id 为站点 ID
 * @returns httpOnly、ssl、challengeDir
 */
export async function preview(ctx: AppContext) {
    const data = await FindOneByKey(systemDeploySiteSchema, 'siteId', Number(ctx.params.id));
    if (!data || data.delFlag) return BaseResultData.fail(404, '站点不存在');
    const paths = sitePaths(data);
    return BaseResultData.ok({
        httpOnly: renderNginx(data, 'httpOnly'),
        ssl: renderNginx(data, 'ssl'),
        challengeDir: paths.challengeDir,
        certDir: paths.certDir,
    });
};

/**
 * 分页查询某站点的证书记录，当前证排在前面
 * @param ctx 请求上下文，query.siteId 为站点 ID
 * @returns 分页记录
 */
export async function findCertList(ctx: AppContext) {
    const siteId = Number(ctx.query.siteId);
    const pageNum = Number(ctx.query.pageNum || 1);
    const pageSize = Number(ctx.query.pageSize || 20);
    const whereCondition = CreateQueryBuilder(systemDeployCertSchema)
        .eq('delFlag', false)
        .eq('siteId', siteId)
        .build();
    const res = await FindPage(systemDeployCertSchema, whereCondition, {
        pageNum,
        pageSize,
        orderByColumn: 'createTime',
        sortRule: 'desc',
    });
    const list = [...(res.list || [])].sort((a: any, b: any) => Number(b.isCurrent) - Number(a.isCurrent));
    return BaseResultData.ok({ ...res, list });
};

/**
 * 立即申请或续签一张新证。每次都向证书机构新建订单，有效期以返回的证书为准
 * @param ctx 请求上下文，params.id 为站点 ID
 * @returns 成功时 msg 为结果说明；失败为 400
 */
export async function renew(ctx: AppContext) {
    const site = await FindOneByKey(systemDeploySiteSchema, 'siteId', Number(ctx.params.id));
    if (!site || site.delFlag) return BaseResultData.fail(404, '站点不存在');
    const lock = new RedisLock(LOCK_NAME, 600);
    if (!await lock.acquire()) return BaseResultData.fail(400, '正在续签，请稍后再试');
    try {
        const result = await renewOne(site, 'manual', true);
        if (!result.ok) return BaseResultData.fail(400, result.message);
        return BaseResultData.ok(null, result.message);
    } finally {
        await lock.release();
    }
};

/**
 * 定时扫描已开启自动续签、且没有证书或剩余不足 30 天的站点
 * @returns 无。失败只写入站点最近结果和证书记录
 */
export async function RenewDueCerts() {
    const lock = new RedisLock(LOCK_NAME, 600);
    if (!await lock.acquire()) {
        logger.info('站点证书续签跳过：已有任务在执行');
        return;
    };
    try {
        const sites = await FindAll(systemDeploySiteSchema, eq(systemDeploySiteSchema.delFlag, false));
        const due = sites.filter((site) => site.sslAutoRenew && isDue(site));
        const reloadSites: Record<string, any>[] = [];
        for (const site of due) {
            const result = await renewOne(site, 'cron', false);
            if (result.ok && site.reloadNginx) reloadSites.push(site);
        };
        if (!reloadSites.length) return;
        const reloadText = await reloadNginxProcess();
        for (const site of reloadSites) {
            await UpdateByKey(systemDeploySiteSchema, 'siteId', null, {
                siteId: site.siteId,
                lastRenewMsg: clip(`证书已更新。${reloadText}`),
            });
        };
    } finally {
        await lock.release();
    }
};