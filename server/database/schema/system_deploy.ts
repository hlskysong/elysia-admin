import { sql } from 'drizzle-orm';
import { pgTable, bigserial, varchar, boolean, bigint, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-typebox';
import { BaseSchema } from '@database/base-schema';

export const systemDeploySiteSchema = pgTable(
    'system_deploy_site',
    {
        siteId: bigserial('site_id', { mode: 'number' }).primaryKey(), // 站点ID
        name: varchar('name', { length: 64 }).notNull(), // 站点名
        serverName: varchar('server_name', { length: 255 }).notNull(), // 域名
        wwwRoot: varchar('www_root', { length: 512 }), // 网站根目录
        webRoot: varchar('web_root', { length: 512 }), // 校验目录
        certDir: varchar('cert_dir', { length: 512 }), // 证书目录
        email: varchar('email', { length: 128 }), // 邮箱
        sslAutoRenew: boolean('ssl_auto_renew').default(false), // 自动续签
        reloadNginx: boolean('reload_nginx').default(false), // 自动重启Nginx
        useBaota: boolean('use_baota').default(true), // 宝塔目录
        httpRedirect: boolean('http_redirect').default(true), // HTTP跳HTTPS
        locations: jsonb('locations'), // 反代配置
        certExpireAt: timestamp('cert_expire_at', { withTimezone: true }), // 证书到期时间
        lastRenewAt: timestamp('last_renew_at', { withTimezone: true }), // 最近续签时间
        lastRenewMsg: varchar('last_renew_msg', { length: 500 }), // 最近续签结果
        ...BaseSchema,
    },
    (table) => [
        uniqueIndex('uk_system_deploy_site_server_name')
            .on(table.serverName)
            .where(sql`${table.delFlag} = false`),
    ],
);

export const InsertSystemDeploySite = createInsertSchema(systemDeploySiteSchema);
export const SelectSystemDeploySite = createSelectSchema(systemDeploySiteSchema);

export const systemDeployCertSchema = pgTable(
    'system_deploy_cert',
    {
        certId: bigserial('cert_id', { mode: 'number' }).primaryKey(), // 证书记录ID
        siteId: bigint('site_id', { mode: 'number' }).notNull(), // 站点ID
        issuer: varchar('issuer', { length: 255 }), // 颁发者
        serialNumber: varchar('serial_number', { length: 128 }), // 序列号
        fingerprint: varchar('fingerprint', { length: 128 }), // SHA256指纹
        notBefore: timestamp('not_before', { withTimezone: true }), // 生效时间
        notAfter: timestamp('not_after', { withTimezone: true }), // 到期时间
        success: boolean('success').default(false), // 是否成功
        isCurrent: boolean('is_current').default(false), // 是否当前证
        renewSource: varchar('renew_source', { length: 16 }), // 续签来源
        message: varchar('message', { length: 500 }), // 说明
        ...BaseSchema,
    },
    (table) => [
        uniqueIndex('uk_system_deploy_cert_current')
            .on(table.siteId)
            .where(sql`${table.isCurrent} = true AND ${table.delFlag} = false`),
    ],
);

export const InsertSystemDeployCert = createInsertSchema(systemDeployCertSchema);
export const SelectSystemDeployCert = createSelectSchema(systemDeployCertSchema);