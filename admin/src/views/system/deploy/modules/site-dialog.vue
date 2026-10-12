<template>
    <ElDialog v-model="dialogVisible" class="deploy-site-dialog" :title="title" width="920px" align-center
        destroy-on-close @closed="handleClosed">
        <div class="split">
            <ElAnchor class="nav" :container="paneRef" direction="vertical" :offset="12" @click="onAnchor">
                <ElAnchorLink href="#deploy-basic" title="基本信息" />
                <ElAnchorLink href="#deploy-paths" title="路径" />
                <ElAnchorLink href="#deploy-cert" title="证书" />
            </ElAnchor>

            <div ref="paneRef" class="pane">
                <ArtForm ref="formRef" v-model="form" :items="formItems" :rules="rules" :span="12" :gutter="16"
                    label-width="100px" :show-reset="false" :show-submit="false">
                    <template #basicMark>
                        <h3 id="deploy-basic" class="section-title">基本信息</h3>
                    </template>

                    <template #webRoot>
                        <ElInput v-model="form.webRoot" placeholder="留空则使用后端工作目录" maxlength="512" />
                        <p v-if="challengeHint" class="hint">校验文件目录：{{ challengeHint }}</p>
                    </template>

                    <template #pathsMark>
                        <div id="deploy-paths" class="section-bar">
                            <h3 class="section-title">路径</h3>
                            <ElDropdown trigger="click" @command="addLocation">
                                <ElButton size="small">添加路径</ElButton>
                                <template #dropdown>
                                    <ElDropdownMenu>
                                        <ElDropdownItem v-for="item in kindOptions" :key="item.value"
                                            :command="item.value">
                                            {{ item.label }}
                                        </ElDropdownItem>
                                    </ElDropdownMenu>
                                </template>
                            </ElDropdown>
                        </div>
                    </template>

                    <template #locations>
                        <div class="paths">
                            <article v-for="(item, index) in form.locations" :key="item.uid" class="path-card">
                                <div class="card-head">
                                    <ElSelect class="kind-select" :model-value="item.kind"
                                        @change="(value) => changeKind(index, value as LocationKind)">
                                        <ElOption v-for="option in kindOptions" :key="option.value"
                                            :label="option.label" :value="option.value" />
                                    </ElSelect>
                                    <ElFormItem v-if="item.kind === 'custom'" label-width="0"
                                        :prop="`locations.${index}.name`" :rules="nameRule">
                                        <ElInput v-model="item.name" placeholder="自定义名称" maxlength="32" />
                                    </ElFormItem>
                                    <ElSelect v-if="item.kind === 'custom'" v-model="item.serve" class="serve-select"
                                        @change="changeServe(index)">
                                        <ElOption label="反代" value="proxy" />
                                        <ElOption label="静态" value="static" />
                                    </ElSelect>
                                    <ElButton text type="danger" @click="removeLocation(index)">删除</ElButton>
                                </div>
                                <div class="path-fields">
                                    <ElFormItem class="path-field" label="路径" label-width="80px"
                                        :prop="`locations.${index}.path`" :rules="pathRule">
                                        <ElInput v-model="item.path" placeholder="例如 /api" />
                                    </ElFormItem>
                                    <ElFormItem class="path-field" label="端口" label-width="80px"
                                        :prop="`locations.${index}.port`"
                                        :rules="needsPort(item) ? portRule : undefined">
                                        <ElInputNumber v-model="item.port" :disabled="!needsPort(item)" :min="1"
                                            :max="65535" controls-position="right" />
                                    </ElFormItem>
                                    <ElFormItem class="path-field" label="目录" label-width="80px"
                                        :prop="`locations.${index}.root`">
                                        <ElInput v-model="item.root" :disabled="!needsRoot(item)"
                                            :placeholder="needsRoot(item) ? '默认使用网站根目录' : ''" />
                                    </ElFormItem>
                                    <ElFormItem class="path-field" label="上传大小" label-width="80px"
                                        :prop="`locations.${index}.maxBody`"
                                        :rules="needsBody(item) ? bodyRule : undefined">
                                        <ElInput v-model="item.maxBody" :disabled="!needsBody(item)"
                                            :placeholder="needsBody(item) ? '50m' : ''" />
                                    </ElFormItem>
                                </div>
                                <p v-if="item.kind === 'rustfs'" class="hint">
                                    只反代到 127.0.0.1，不会对外开放该端口。
                                    <template v-if="rustfsBucketHint">
                                        默认路径已按存储配置桶名填充为 {{ rustfsBucketHint }}，可手动修改。
                                    </template>
                                </p>
                            </article>
                            <ElEmpty v-if="!form.locations.length" description="暂无路径，请点击「添加路径」" :image-size="64" />
                        </div>
                    </template>

                    <template #certMark>
                        <h3 id="deploy-cert" class="section-title">证书</h3>
                    </template>

                    <template #reloadTip>
                        <ElAlert type="warning" :closable="false" show-icon
                            title="未开启「自动重启」时，续签后需自行到面板重载 Nginx，否则新证书不会生效。" />
                    </template>
                </ArtForm>
            </div>
        </div>

        <template #footer>
            <ElButton @click="dialogVisible = false">取消</ElButton>
            <ElButton type="primary" :loading="loading" @click="handleSubmit">提交</ElButton>
        </template>
    </ElDialog>
</template>

<script setup lang="ts">
import { ElMessage, type FormRules } from 'element-plus'
import type { FormItem } from '@/components/core/forms/art-form/index.vue'
import ArtForm from '@/components/core/forms/art-form/index.vue'
import { fetchCreateDeploy, fetchUpdateDeploy } from '@/api/system/deploy'
import { fetchGetRustFsBucket } from '@/api/system/storage'

type LocationKind = Api.SystemDeploy.LocationKind
type LocationRow = Api.SystemDeploy.LocationItem & { uid: number }

interface Props {
    visible: boolean
    type: string
    data?: Api.SystemDeploy.SiteItem | null
}

interface Emits {
    (e: 'update:visible', value: boolean): void
    (e: 'submit'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const dialogVisible = computed({
    get: () => props.visible,
    set: (value) => emit('update:visible', value),
})
const title = computed(() => (props.type === 'add' ? '新建站点' : '编辑站点'))
const formRef = ref()
const paneRef = ref<HTMLElement>()
const loading = ref(false)
/** RustFS 默认路径：优先匹配「存储」里启用的 RustFS 桶名，失败时回退 /zqwz/ */
const rustfsDefaultPath = ref('/zqwz/')
const rustfsBucketHint = ref('')
let uidSeed = 1

const kindOptions: { label: string; value: LocationKind }[] = [
    { label: '官网首页', value: 'home' },
    { label: '静态后台', value: 'admin' },
    { label: '后端 API', value: 'api' },
    { label: 'RustFS', value: 'rustfs' },
    { label: '自定义', value: 'custom' },
]

/** 读取当前启用的 RustFS 桶路径；失败时回退 /zqwz/ */
async function resolveRustfsDefaultPath() {
    try {
        const data = await fetchGetRustFsBucket()
        if (data?.path) {
            rustfsBucketHint.value = data.path
            return data.path
        }
    } catch {
        /* 接口失败时使用回退路径 */
    }
    rustfsBucketHint.value = ''
    return '/zqwz/'
}

function preset(kind: LocationKind): Api.SystemDeploy.LocationItem {
    if (kind === 'admin') return { kind, path: '/admin', root: '' }
    if (kind === 'api') return { kind, path: '/api', port: 4003 }
    if (kind === 'rustfs') return { kind, path: rustfsDefaultPath.value, port: 9000, maxBody: '50m' }
    if (kind === 'custom') return { kind, name: '', serve: 'proxy', path: '/', port: undefined }
    return { kind: 'home', path: '/', port: 4002 }
}

function withUid(item: Api.SystemDeploy.LocationItem): LocationRow {
    return { ...item, uid: uidSeed++ }
}

function defaultRows(): LocationRow[] {
    return (['home', 'admin', 'api', 'rustfs'] as LocationKind[]).map((kind) => withUid(preset(kind)))
}

function needsPort(item: Api.SystemDeploy.LocationItem) {
    if (item.kind === 'admin') return false
    if (item.kind === 'custom') return item.serve !== 'static'
    return true
}

function needsRoot(item: Api.SystemDeploy.LocationItem) {
    return item.kind === 'admin' || (item.kind === 'custom' && item.serve === 'static')
}

function needsBody(item: Api.SystemDeploy.LocationItem) {
    return item.kind === 'rustfs' || (item.kind === 'custom' && item.serve !== 'static')
}

function blankForm() {
    return {
        siteId: undefined as number | undefined,
        name: '',
        serverName: '',
        wwwRoot: '',
        webRoot: '',
        certDir: '',
        email: '',
        sslAutoRenew: false,
        reloadNginx: false,
        useBaota: true,
        httpRedirect: true,
        locations: defaultRows(),
    }
}

function toRows(input: unknown): LocationRow[] {
    if (Array.isArray(input)) {
        return input
            .filter((item) => kindOptions.some((option) => option.value === item?.kind))
            .map((item) => withUid({
                kind: item.kind,
                name: item.name || '',
                serve: item.serve === 'static' ? 'static' : 'proxy',
                path: String(item.path || '/'),
                port: item.port,
                root: item.root || '',
                maxBody: item.maxBody || '',
            }))
    }
    if (input && typeof input === 'object') {
        const raw = input as Record<string, any>
        const rows: LocationRow[] = []
        if (Array.isArray(raw.webs)) {
            for (const web of raw.webs) rows.push(withUid({ kind: 'home', path: String(web.path || '/'), port: Number(web.port) }))
        }
        if (raw.admin?.enabled !== false && raw.admin?.path) {
            rows.push(withUid({ kind: 'admin', path: String(raw.admin.path), root: raw.admin.root || '' }))
        }
        if (raw.api?.enabled !== false && raw.api?.path) {
            rows.push(withUid({ kind: 'api', path: String(raw.api.path), port: Number(raw.api.port) }))
        }
        if (raw.rustfs?.enabled !== false && raw.rustfs?.path) {
            rows.push(withUid({
                kind: 'rustfs',
                path: String(raw.rustfs.path),
                port: Number(raw.rustfs.port),
                maxBody: raw.rustfs.maxBody || '50m',
            }))
        }
        if ('webs' in raw || 'admin' in raw || 'api' in raw || 'rustfs' in raw) return rows
    }
    return defaultRows()
}

const form = reactive(blankForm())
const challengeHint = computed(() => props.data?.challengeDir || '')

const formItems = computed<FormItem[]>(() => [
    { label: '', key: 'basicMark', span: 24 },
    { label: '站点名', key: 'name', type: 'input', props: { placeholder: '如 demo（字母数字_-，用于宝塔路径）', maxlength: 64 } },
    { label: '域名', key: 'serverName', type: 'input', props: { placeholder: '例如 zone.example.com', maxlength: 255 } },
    { label: '网站根目录', key: 'wwwRoot', type: 'input', props: { placeholder: '/www/wwwroot/域名', maxlength: 512 } },
    { label: '邮箱', key: 'email', type: 'input', props: { placeholder: '申请免费证书时必填', maxlength: 128 } },
    { label: '校验目录', key: 'webRoot', span: 24 },
    { label: '证书目录', key: 'certDir', type: 'input', span: 24, props: { placeholder: '留空则使用 storage/certs/域名', maxlength: 512 } },
    { label: '', key: 'pathsMark', span: 24 },
    { label: '', key: 'locations', span: 24 },
    { label: '', key: 'certMark', span: 24 },
    { label: '自动续签', key: 'sslAutoRenew', type: 'switch' },
    { label: '自动重启', key: 'reloadNginx', type: 'switch' },
    { label: '宝塔目录', key: 'useBaota', type: 'switch' },
    { label: '跳转 HTTPS', key: 'httpRedirect', type: 'switch' },
    { label: '', key: 'reloadTip', span: 24, hidden: form.reloadNginx },
])

const pathRule = [
    { required: true, message: '路径不能为空', trigger: 'blur' },
    { pattern: /^\/(?!.*\.\.)[^;\r\n$`{}]*$/, message: '路径格式不正确', trigger: 'blur' },
]
const portRule = [{ required: true, type: 'number' as const, message: '端口不正确', trigger: 'change' }]
const nameRule = [
    { required: true, message: '请填写自定义名称', trigger: 'blur' },
    { pattern: /^[^;\r\n$`{}]+$/, message: '名称不能包含特殊字符', trigger: 'blur' },
]
const bodyRule = [{ pattern: /^$|^[1-9]\d{0,4}[kmgKMG]?$/, message: '上传大小格式不正确', trigger: 'blur' }]
const rules = computed<FormRules>(() => ({
    name: [
        { required: true, message: '请输入站点名', trigger: 'blur' },
        {
            pattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
            message: '站点名仅允许字母、数字、下划线和连字符，且需以字母或数字开头',
            trigger: 'blur',
        },
    ],
    serverName: [
        { required: true, message: '请输入域名', trigger: 'blur' },
        { pattern: /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/, message: '域名格式不正确', trigger: 'blur' },
    ],
    email: [{
        validator: (_rule, value, callback) => {
            const text = String(value || '').trim()
            if (!text && form.sslAutoRenew) {
                callback(new Error('开启自动续签时邮箱不能为空'))
                return
            }
            if (text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
                callback(new Error('邮箱格式不正确'))
                return
            }
            callback()
        },
        trigger: 'blur',
    }],
}))

async function initForm() {
    rustfsDefaultPath.value = await resolveRustfsDefaultPath()
    const next = blankForm()
    if (props.type === 'edit' && props.data) {
        Object.assign(next, props.data)
        next.name = props.data.name || ''
        next.serverName = props.data.serverName || ''
        next.wwwRoot = props.data.wwwRoot || ''
        next.webRoot = props.data.webRoot || ''
        next.certDir = props.data.certDir || ''
        next.email = props.data.email || ''
        next.sslAutoRenew = Boolean(props.data.sslAutoRenew)
        next.reloadNginx = Boolean(props.data.reloadNginx)
        next.useBaota = props.data.useBaota !== false
        next.httpRedirect = props.data.httpRedirect !== false
        next.locations = toRows(props.data.locations)
    }
    Object.assign(form, next)
    form.locations = next.locations
}

watch(() => props.visible, (open) => {
    if (open) nextTick(() => { void initForm() })
})

function onAnchor(event: MouseEvent) {
    event.preventDefault()
}

function addLocation(kind: LocationKind) {
    form.locations.push(withUid(preset(kind)))
}

function changeKind(index: number, kind: LocationKind) {
    const uid = form.locations[index].uid
    form.locations[index] = { ...preset(kind), uid }
}

function changeServe(index: number) {
    const row = form.locations[index]
    if (row.serve === 'static') {
        row.port = undefined
        row.maxBody = ''
        return
    }
    row.root = ''
}

function removeLocation(index: number) {
    form.locations.splice(index, 1)
}

function toPayload(item: LocationRow): Api.SystemDeploy.LocationItem {
    if (item.kind === 'admin') return { kind: 'admin', path: item.path, root: item.root || '' }
    if (item.kind === 'rustfs') return { kind: 'rustfs', path: item.path, port: item.port, maxBody: item.maxBody || '50m' }
    if (item.kind === 'custom' && item.serve === 'static') {
        return { kind: 'custom', name: item.name, serve: 'static', path: item.path, root: item.root || '' }
    }
    if (item.kind === 'custom') {
        return {
            kind: 'custom',
            name: item.name,
            serve: 'proxy',
            path: item.path,
            port: item.port,
            maxBody: item.maxBody || undefined,
        }
    }
    return { kind: item.kind, path: item.path, port: item.port }
}

function handleSubmit() {
    if (!formRef.value) return
    formRef.value.validate().then(async () => {
        const paths = form.locations.map((item) => item.path)
        if (new Set(paths).size !== paths.length) {
            ElMessage.warning('路径不能重复')
            return
        }
        const payload: Api.SystemDeploy.SiteItem = {
            siteId: form.siteId,
            name: form.name,
            serverName: form.serverName,
            wwwRoot: form.wwwRoot || '',
            webRoot: form.webRoot || '',
            certDir: form.certDir || '',
            email: form.email || '',
            sslAutoRenew: form.sslAutoRenew,
            reloadNginx: form.reloadNginx,
            useBaota: form.useBaota,
            httpRedirect: form.httpRedirect,
            locations: form.locations.map(toPayload),
        }
        loading.value = true
        try {
            if (props.type === 'add') await fetchCreateDeploy(payload)
            else await fetchUpdateDeploy(payload)
            emit('submit')
            dialogVisible.value = false
        } finally {
            loading.value = false
        }
    }).catch(() => {
        ElMessage.error('表单校验失败，请检查输入')
    })
}

function handleClosed() {
    formRef.value?.reset()
}
</script>

<style scoped lang="scss">
.scope-alert {
    margin-bottom: 12px;
}

.split {
    display: flex;
    height: 62vh;
    min-height: 420px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    overflow: hidden;
}

.nav {
    width: 120px;
    flex: none;
    padding: 12px 8px 12px 12px;
    border-right: 1px solid var(--el-border-color-lighter);
    background: var(--el-fill-color-blank);
}

.pane {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding: 4px 12px 8px;
}

.section-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    scroll-margin-top: 8px;
}

.section-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    scroll-margin-top: 8px;
}

.hint {
    margin: 6px 0 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.5;
}

.paths {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.path-card {
    padding: 12px 12px 8px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-bg-color);
}

.card-head {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 12px;
}

.kind-select {
    width: 148px;
    flex: none;
}

.serve-select {
    width: 110px;
    flex: none;
}

.card-head :deep(.el-form-item) {
    flex: 1;
    margin-bottom: 0;
}

.card-head>.el-button {
    margin-left: auto;
}

.path-fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: 16px;
    row-gap: 14px;
}

.path-field {
    margin-bottom: 0 !important;
    min-width: 0;

    :deep(.el-form-item__content) {
        min-width: 0;
        flex: 1;
    }

    :deep(.el-input),
    :deep(.el-input-number) {
        width: 100%;
    }
}

.pane :deep(.el-form-item:has(.section-title)),
.pane :deep(.el-form-item:has(.section-bar)),
.pane :deep(.el-form-item:has(.paths)) {
    margin-bottom: 8px;

    >.el-form-item__content {
        display: block;
        margin-left: 0 !important;
        width: 100%;
        line-height: normal;
    }
}

.pane :deep(section) {
    padding-left: 0 !important;
    padding-right: 0 !important;
    padding-top: 4px !important;
}

@media (max-width: 720px) {
    .path-fields {
        grid-template-columns: 1fr;
    }
}
</style>

<style>
.deploy-site-dialog.el-dialog .el-dialog__body {
    overflow: hidden;
    padding-top: 8px;
}
</style>