import request from '@/utils/http'

export function fetchGetDeployAll() {
    return request.get<Api.SystemDeploy.SiteItem[]>({ url: '/api/system/deploy/all' })
};

export function fetchCreateDeploy(data: Api.SystemDeploy.SiteItem) {
    return request.post({ url: '/api/system/deploy', data, showSuccessMessage: true, showErrorMessage: true })
};

export function fetchUpdateDeploy(data: Api.SystemDeploy.SiteItem) {
    return request.put({ url: '/api/system/deploy', data, showSuccessMessage: true, showErrorMessage: true })
};

export function fetchDeleteDeploy(ids: number | number[] | string) {
    const str = Array.isArray(ids) ? ids.join(',') : ids.toString()
    return request.del({ url: `/api/system/deploy/${str}`, showSuccessMessage: true, showErrorMessage: true })
};

export function fetchPreviewDeploy(id: number) {
    return request.post<Api.SystemDeploy.PreviewResult>({
        url: `/api/system/deploy/preview/${id}`,
        showErrorMessage: true,
    });
};

export function fetchRenewDeploy(id: number) {
    return request.post({
        url: `/api/system/deploy/renew/${id}`,
        timeout: 180000,
        showSuccessMessage: true,
        showErrorMessage: true,
    });
};

export function fetchGetCertList(params: { siteId: number; pageNum: number; pageSize: number }) {
    return request.get<Api.SystemDeploy.CertPage>({ url: '/api/system/deploy/cert/list', params, showErrorMessage: true })
};