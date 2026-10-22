import type { AppContext } from '@/types/app-context';
import { eq } from 'drizzle-orm';
import { BaseResultData } from '@/core/result';
import {
    InsertOne,
    SoftDeleteByKeys,
    CreateQueryBuilder,
    FindPage,
    FindAll,
    FindOneByKey,
} from '@/core/database/repository';
import { ParseDateFields } from '@/types/dto';
import { RunTransaction } from '@/core/database/transaction';
import { systemStorageSchema } from '@database/schema/system_storage';
import { StorageService, type StorageProviderType } from '@/infrastructure/storage';

function toBucketPath(bucket: string) {
    const name = bucket.trim().replace(/^\/+|\/+$/g, '');
    return name ? `/${name}/` : '';
}

/**
 * 获取当前启用的 RustFS 存储桶（跨模块复用，如站点部署默认路径）
 * @returns `{ bucket, path }`；无可用配置时返回 `null`
 */
export async function GetActiveRustFsBucket() {
    const where = CreateQueryBuilder(systemStorageSchema)
        .eq('delFlag', false)
        .eq('status', true)
        .eq('name', 'RustFS')
        .build();
    const rows = await FindAll(systemStorageSchema, where, { limit: 1 });
    const bucket = rows[0]?.bucket?.trim();
    if (!bucket) return null;
    const path = toBucketPath(bucket);
    return path ? { bucket, path } : null;
};

export async function create(ctx: AppContext) {
    await InsertOne(systemStorageSchema, ctx);
    return BaseResultData.ok();
};

export async function findList(ctx: AppContext) {
    const {
        pageNum = 1,
        pageSize = 10,
        orderByColumn = "createTime",
        sortRule = "desc",
        startTime,
        endTime,
        name,
    } = ctx.query;
    const whereCondition = CreateQueryBuilder(systemStorageSchema)
        .eq('delFlag', false)
        .like('name', name)
        .dateRange('createTime', startTime, endTime)
        .build();
    const res = await FindPage(systemStorageSchema, whereCondition, {
        pageNum,
        pageSize,
        orderByColumn,
        sortRule
    });
    return BaseResultData.ok(res);
};

export async function generatePresign(ctx: AppContext) {
    const { fileName } = ctx.query;
    const storage = await FindOneByKey(systemStorageSchema, 'status', true);
    if (!storage) return BaseResultData.fail(404, '未找到可用的存储配置');
    const { region, endpoint, bucket, accessKey, secretKey } = storage;
    if (!endpoint || !bucket || !accessKey || !secretKey) return BaseResultData.fail(400, '存储配置不完整');
    const config = { region: region || '', endpoint, bucket, accessKey, secretKey, };
    const storageService = new StorageService(storage.name as StorageProviderType, config);
    const presignedUrl = await storageService.getPresignedUrl({ key: fileName, method: 'put' });
    return BaseResultData.ok(presignedUrl);
};

/**
 * 查询当前启用的 RustFS 桶名与默认反代路径
 */
export async function findRustFsBucket() {
    const data = await GetActiveRustFsBucket();
    return BaseResultData.ok(data);
};

export async function update(ctx: AppContext) {
    const data = ParseDateFields(ctx.body);
    await RunTransaction(async (tx) => {
        if (data?.status) {
            await tx.update(systemStorageSchema).set({ status: false }).where(eq(systemStorageSchema.delFlag, false));
        };
        await tx.update(systemStorageSchema).set(data).where(eq(systemStorageSchema.storageId, data.storageId));
    });
    return BaseResultData.ok();
};

export async function remove(ctx: AppContext) {
    await SoftDeleteByKeys(systemStorageSchema, 'storageId', ctx);
    return BaseResultData.ok();
};