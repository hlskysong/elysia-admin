import { t } from 'elysia';
import { SelectSystemDeploySite } from '@database/schema/system_deploy';
import { CrudDto } from '@/types/dto';

const LocationItem = t.Object({
    kind: t.Union([
        t.Literal('home'),
        t.Literal('admin'),
        t.Literal('api'),
        t.Literal('rustfs'),
        t.Literal('custom'),
    ], { error: '类型不正确' }),
    name: t.Optional(t.String({ maxLength: 32, error: '自定义名称过长' })),
    serve: t.Optional(t.Union([t.Literal('proxy'), t.Literal('static')], { error: '自定义方式不正确' })),
    path: t.String({ minLength: 1, maxLength: 128, error: '路径不能为空' }),
    port: t.Optional(t.Number({ minimum: 1, maximum: 65535, error: '端口不正确' })),
    root: t.Optional(t.String({ maxLength: 512, error: '目录过长' })),
    maxBody: t.Optional(t.String({ maxLength: 16, error: '上传大小格式不正确' })),
}, { error: '路径配置不正确' });

const LocationsBody = t.Array(LocationItem, { error: '路径配置不正确' });

/** 可选字符串：允许缺省 / 空串 / null（库里未填时常为 null） */
const OptStr = (maxLength: number, error: string) =>
    t.Optional(t.Union([t.String({ maxLength, error }), t.Null()]));

const SiteFields = {
    name: t.String({
        minLength: 1,
        maxLength: 64,
        pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]*$',
        error: '站点名仅允许字母、数字、下划线和连字符，且需以字母或数字开头',
    }),
    serverName: t.String({ minLength: 1, maxLength: 255, error: '域名不能为空' }),
    wwwRoot: OptStr(512, '网站根目录过长'),
    webRoot: OptStr(512, '校验目录过长'),
    certDir: OptStr(512, '证书目录过长'),
    email: OptStr(128, '邮箱过长'),
    sslAutoRenew: t.Optional(t.Boolean({ error: '自动续签开关不正确' })),
    reloadNginx: t.Optional(t.Boolean({ error: '自动重启开关不正确' })),
    useBaota: t.Optional(t.Boolean({ error: '宝塔目录开关不正确' })),
    httpRedirect: t.Optional(t.Boolean({ error: '跳转开关不正确' })),
    locations: LocationsBody,
    remark: OptStr(255, '备注过长'),
};

export const CreateDto = {
    body: t.Object(SiteFields),
};

export const UpdateDto = {
    body: t.Object({
        siteId: t.Number({ minimum: 1, error: '站点不能为空' }),
        ...SiteFields,
    }),
};

export const ListDto = CrudDto.list(
    SelectSystemDeploySite,
    {
        name: t.Optional(t.String({ description: '站点名' })),
        serverName: t.Optional(t.String({ description: '域名' })),
    },
);

export const CertListDto = {
    query: t.Object({
        siteId: t.Numeric({ minimum: 1, error: '站点不能为空' }),
        pageNum: t.Optional(t.Numeric({ minimum: 1, error: '页码不正确' })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, error: '每页条数不正确' })),
    }),
};