<template>
    <ElDialog v-model="dialogVisible" :title="title" width="900px" align-center destroy-on-close>
        <ElTable v-loading="loading" :data="list" stripe border empty-text="还没有证书记录" max-height="480">
            <ElTableColumn label="结果" width="100" align="center">
                <template #default="{ row }">
                    <ElTag :type="row.success ? 'success' : 'danger'" size="small">
                        {{ row.success ? '成功' : '失败' }}
                    </ElTag>
                </template>
            </ElTableColumn>
            <ElTableColumn label="当前" width="80" align="center">
                <template #default="{ row }">
                    <ElTag v-if="row.isCurrent" type="primary" size="small">当前</ElTag>
                    <span v-else>-</span>
                </template>
            </ElTableColumn>
            <ElTableColumn label="来源" width="110" align="center" show-overflow-tooltip>
                <template #default="{ row }">
                    {{ sourceLabel(row.renewSource) || '-' }}
                </template>
            </ElTableColumn>
            <ElTableColumn prop="message" label="说明" min-width="160" show-overflow-tooltip />
            <ElTableColumn label="到期" width="170" align="center">
                <template #default="{ row }">
                    {{ formatTime(row.notAfter) }}
                </template>
            </ElTableColumn>
            <ElTableColumn label="时间" width="170" align="center">
                <template #default="{ row }">
                    {{ formatTime(row.createTime) }}
                </template>
            </ElTableColumn>
        </ElTable>
    </ElDialog>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'
import { useDictStore } from '@/store/modules/dict'
import { fetchGetCertList } from '@/api/system/deploy'

const props = defineProps<{ visible: boolean; site: Api.SystemDeploy.SiteItem | null }>()
const emit = defineEmits<{ 'update:visible': [boolean] }>()
const dialogVisible = computed({
    get: () => props.visible,
    set: (value: boolean) => emit('update:visible', value),
})
const dictStore = useDictStore()
const { deploy_renew_source } = dictStore.getDictData(['deploy_renew_source'])
const list = ref<Api.SystemDeploy.CertItem[]>([])
const loading = ref(false)
const title = computed(() => (props.site?.serverName ? `${props.site.serverName} · 证书记录` : '证书记录'))

watch(() => [props.visible, props.site?.siteId] as const, ([open]) => {
    if (open && props.site?.siteId) load()
})

async function load() {
    if (!props.site?.siteId) return
    loading.value = true
    try {
        const res = await fetchGetCertList({ siteId: props.site.siteId, pageNum: 1, pageSize: 50 })
        list.value = res?.list || []
    } finally {
        loading.value = false
    }
}

function sourceLabel(value?: string) {
    if (!value) return ''
    return deploy_renew_source.value?.find((item) => item.dictValue === value)?.dictLabel || value
}

function formatTime(value?: string) {
    return value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-'
}
</script>
