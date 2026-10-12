<template>
    <div class="deploy-page art-full-height">
        <ElAlert v-if="showTip" type="warning" closable show-icon
            title="若域名已使用自定义证书、商业 CA、CDN/云厂商托管 SSL，或证书由面板自行管理，请勿使用本功能，以免续签冲突。" @close="showTip = false" />
        <ElCard class="art-table-card" shadow="never">
            <ArtTableHeader v-model:columns="columnChecks" :loading="loading" @refresh="refreshData">
                <template #left>
                    <ElSpace wrap>
                        <ElButton v-auth="'system:deploy:create'" v-ripple @click="showDialog('add')">
                            新建站点
                        </ElButton>
                        <ElButton v-auth="'system:deploy:delete'" type="danger" :disabled="selectedRows.length === 0"
                            v-ripple @click="handleBatchDelete">
                            批量删除
                        </ElButton>
                    </ElSpace>
                </template>
            </ArtTableHeader>
            <ArtTable :loading="loading" :data="data" :columns="columns" :pagination="pagination"
                @selection-change="handleSelectionChange" @pagination:size-change="handleSizeChange"
                @pagination:current-change="handleCurrentChange" />
        </ElCard>

        <SiteDialog v-model:visible="dialogVisible" :type="dialogType" :data="editing" @submit="refreshData" />
        <PreviewDialog v-model:visible="previewVisible" :preview="preview" />
        <CertDialog v-model:visible="certVisible" :site="certSite" />
    </div>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox, ElTag } from 'element-plus'
import { useAuth } from '@/hooks'
import { useTable } from '@/hooks/core/useTable'
import ArtButtonMore, { type ButtonMoreItem } from '@/components/core/forms/art-button-more/index.vue'
import { fetchDeleteDeploy, fetchGetDeployAll, fetchPreviewDeploy, fetchRenewDeploy } from '@/api/system/deploy'
import SiteDialog from './modules/site-dialog.vue'
import PreviewDialog from './modules/preview-dialog.vue'
import CertDialog from './modules/cert-dialog.vue'

defineOptions({ name: 'SystemDeploy' })

type SiteItem = Api.SystemDeploy.SiteItem

const auth = useAuth()
const showTip = ref(true)
const dialogVisible = ref(false)
const dialogType = ref<'add' | 'edit'>('add')
const editing = ref<SiteItem | null>(null)
const previewVisible = ref(false)
const preview = ref<Api.SystemDeploy.PreviewResult | null>(null)
const certVisible = ref(false)
const certSite = ref<SiteItem | null>(null)
const renewingId = ref<number | null>(null)
const selectedRows = ref<SiteItem[]>([])

function remainDays(expire?: string) {
    if (!expire) return null
    return Math.ceil((new Date(expire).getTime() - Date.now()) / 86400000)
}

function certStatus(site: SiteItem) {
    const days = remainDays(site.certExpireAt)
    if (days === null) return { text: '未签发', type: 'info' as const }
    if (days < 0) return { text: '已过期', type: 'danger' as const }
    if (days <= 30) return { text: `剩余 ${days} 天`, type: 'warning' as const }
    return { text: `剩余 ${days} 天`, type: 'success' as const }
}

const {
    columns,
    columnChecks,
    data,
    loading,
    pagination,
    handleSizeChange,
    handleCurrentChange,
    refreshData,
} = useTable({
    core: {
        apiFn: fetchGetDeployAll,
        excludeParams: ['current', 'size'],
        columnsFactory: () => [
            { type: 'selection' },
            { type: 'index', width: 60, label: '序号', align: 'center' },
            {
                prop: 'serverName',
                label: '域名',
                formatter: (row: SiteItem) =>
                    h('div', { class: 'deploy-cell' }, [
                        h('div', { class: 'deploy-cell__t' }, row.serverName || '-'),
                        h('div', { class: 'deploy-cell__s' }, row.name || '未命名站点'),
                    ]),
            },
            {
                prop: 'certStatus',
                label: '证书状态',
                align: 'center',
                formatter: (row: SiteItem) => {
                    const status = certStatus(row)
                    return h(ElTag, { type: status.type, size: 'small' }, () => status.text)
                },
            },
            {
                prop: 'sslAutoRenew',
                label: '自动续签',
                align: 'center',
                formatter: (row: SiteItem) =>
                    h(ElTag, { type: row.sslAutoRenew ? 'success' : 'info', size: 'small' }, () =>
                        row.sslAutoRenew ? '开' : '关',
                    ),
            },
            {
                prop: 'reloadNginx',
                label: '自动重启',
                align: 'center',
                formatter: (row: SiteItem) =>
                    h(ElTag, { type: row.reloadNginx ? 'success' : 'info', size: 'small' }, () =>
                        row.reloadNginx ? '开' : '关',
                    ),
            },
            {
                prop: 'lastRenewMsg',
                label: '最近续签',
                showOverflowTooltip: true,
                formatter: (row: SiteItem) => row.lastRenewMsg || '-',
            },
            {
                prop: 'certExpireAt',
                label: '到期时间',
                align: 'center',
                formatter: (row: SiteItem) =>
                    row.certExpireAt ? dayjs(row.certExpireAt).format('YYYY-MM-DD') : '-',
            },
            {
                prop: 'operation',
                label: '操作',
                width: 80,
                align: 'center',
                fixed: 'right',
                formatter: (row: SiteItem) => {
                    const buttons: ButtonMoreItem[] = []
                    if (auth.hasAuth('system:deploy:update')) {
                        buttons.push({ key: 'edit', label: '编辑站点', icon: 'ri:edit-2-line' })
                    }
                    if (auth.hasAuth('system:deploy:preview')) {
                        buttons.push({ key: 'preview', label: '复制配置', icon: 'ri:file-copy-line' })
                    }
                    if (auth.hasAuth('system:deploy:renew')) {
                        buttons.push({
                            key: 'renew',
                            label: renewingId.value === row.siteId ? '续签中…' : '立即续签',
                            icon: renewingId.value === row.siteId ? 'ri:loader-4-line' : 'ri:shield-check-line',
                            disabled: renewingId.value === row.siteId,
                        })
                    }
                    if (auth.hasAuth('system:deploy:cert')) {
                        buttons.push({ key: 'cert', label: '证书记录', icon: 'ri:history-line' })
                    }
                    if (auth.hasAuth('system:deploy:delete')) {
                        buttons.push({
                            key: 'delete',
                            label: '删除站点',
                            icon: 'ri:delete-bin-4-line',
                            color: '#f56c6c',
                        })
                    }
                    return h('div', [
                        h(ArtButtonMore, {
                            list: buttons,
                            onClick: (item: ButtonMoreItem) => buttonMoreClick(item, row),
                        }),
                    ])
                },
            },
        ],
    },
})

function buttonMoreClick(item: ButtonMoreItem, row: SiteItem) {
    switch (item.key) {
        case 'edit':
            showDialog('edit', row)
            break
        case 'preview':
            void openPreview(row)
            break
        case 'renew':
            void handleRenew(row)
            break
        case 'cert':
            openCert(row)
            break
        case 'delete':
            void handleDelete(row)
            break
    }
}

function showDialog(type: 'add' | 'edit', row?: SiteItem) {
    dialogType.value = type
    editing.value = type === 'edit' && row ? row : null
    dialogVisible.value = true
}

async function openPreview(site: SiteItem) {
    if (!site.siteId) return
    preview.value = await fetchPreviewDeploy(site.siteId)
    previewVisible.value = true
}

function openCert(site: SiteItem) {
    certSite.value = site
    certVisible.value = true
}

async function handleRenew(site: SiteItem) {
    if (!site.siteId || renewingId.value === site.siteId) return
    renewingId.value = site.siteId
    try {
        await fetchRenewDeploy(site.siteId)
        await refreshData()
    } finally {
        renewingId.value = null
    }
}

function handleSelectionChange(selection: SiteItem[]) {
    selectedRows.value = selection
}

async function handleDelete(site: SiteItem) {
    if (!site.siteId) return
    await ElMessageBox.confirm(`确定删除站点 ${site.serverName}？`, '删除站点', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
    })
    await fetchDeleteDeploy(site.siteId)
    selectedRows.value = []
    await refreshData()
}

async function handleBatchDelete() {
    if (!selectedRows.value.length) {
        ElMessage.warning('请选择要删除的站点')
        return
    }
    const names = selectedRows.value.map((item) => item.serverName || item.name || item.siteId).join('、')
    await ElMessageBox.confirm(`确定删除以下站点？\n${names}`, '批量删除', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
    })
    const ids = selectedRows.value.map((item) => item.siteId).filter((id): id is number => id != null)
    if (!ids.length) return
    await fetchDeleteDeploy(ids)
    selectedRows.value = []
    await refreshData()
}
</script>

<style scoped lang="scss">
:deep(.deploy-cell__t) {
    font-size: 14px;
    font-weight: 500;
    color: var(--el-text-color-primary);
    line-height: 1.35;
}

:deep(.deploy-cell__s) {
    margin-top: 2px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
</style>