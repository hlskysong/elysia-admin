import type { IRouteModule } from '@/types/route';
import { create, findAll, findCertList, findList, findOne, preview, remove, renew, update } from './handle';
import { CertListDto, CreateDto, ListDto, UpdateDto } from './dto';

const SystemDeployModule: IRouteModule = {
    tags: '站点部署',
    routes: [
        { url: '/system/deploy', method: 'post', summary: '创建', dto: CreateDto, handle: create, meta: { isAuth: true, isLog: true, permission: 'system:deploy:create' } },
        { url: '/system/deploy/list', method: 'get', summary: '查询列表', dto: ListDto, handle: findList, meta: { isAuth: true, permission: 'system:deploy:query' } },
        { url: '/system/deploy/all', method: 'get', summary: '查询全部', handle: findAll, meta: { isAuth: true, permission: 'system:deploy:query' } },
        { url: '/system/deploy/preview/:id', method: 'post', summary: '生成配置', handle: preview, meta: { isAuth: true, permission: 'system:deploy:preview' } },
        { url: '/system/deploy/renew/:id', method: 'post', summary: '立即续签', handle: renew, meta: { isAuth: true, isLog: true, permission: 'system:deploy:renew' } },
        { url: '/system/deploy/cert/list', method: 'get', summary: '证书记录', dto: CertListDto, handle: findCertList, meta: { isAuth: true, permission: 'system:deploy:cert' } },
        { url: '/system/deploy/:id', method: 'get', summary: '查询详情', handle: findOne, meta: { isAuth: true, permission: 'system:deploy:query' } },
        { url: '/system/deploy', method: 'put', summary: '更新', dto: UpdateDto, handle: update, meta: { isAuth: true, isLog: true, permission: 'system:deploy:update' } },
        { url: '/system/deploy/:ids', method: 'delete', summary: '删除', handle: remove, meta: { isAuth: true, isLog: true, permission: 'system:deploy:delete' } },
    ],
};

export default SystemDeployModule;