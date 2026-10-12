<template>
    <ElDialog v-model="dialogVisible" title="复制配置" width="840px" align-center destroy-on-close>
        <div class="panel">
            <div class="panel__head">
                <ElRadioGroup v-model="mode">
                    <ElRadioButton value="httpOnly" label="httpOnly">仅 HTTP</ElRadioButton>
                    <ElRadioButton value="ssl" label="ssl">含 SSL</ElRadioButton>
                </ElRadioGroup>
                <p class="panel__desc">
                    {{
                        mode === 'httpOnly'
                            ? '证书尚未就绪时先用这份，贴进面板后重载完成校验。'
                            : '证书落盘后改用这份，ssl_certificate 指向后端目录再重载。'
                    }}
                </p>
            </div>

            <div v-if="metaItems.length" class="paths">
                <div v-for="item in metaItems" :key="item.label" class="paths__row">
                    <span class="paths__label">{{ item.label }}</span>
                    <code class="paths__value">{{ item.value }}</code>
                </div>
            </div>

            <ElAlert v-if="pathWarning" class="path-warn" type="warning" :closable="false" show-icon
                :title="pathWarning" />
        </div>

        <div class="code-box">
            <div class="code-box__bar">
                <span class="code-box__name">{{ mode === 'httpOnly' ? 'http.conf' : 'ssl.conf' }}</span>
                <button type="button" class="code-box__copy" :class="{ ok: copied }" :disabled="!currentText"
                    @click="copyCurrent">
                    {{ copied ? '已复制' : '复制' }}
                </button>
            </div>
            <pre>{{ currentText || '暂无配置内容' }}</pre>
        </div>
    </ElDialog>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'

const props = defineProps<{ visible: boolean; preview: Api.SystemDeploy.PreviewResult | null }>()
const emit = defineEmits<{ 'update:visible': [boolean] }>()
const dialogVisible = computed({
    get: () => props.visible,
    set: (value: boolean) => emit('update:visible', value),
})
const mode = ref<'httpOnly' | 'ssl'>('httpOnly')
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const currentText = computed(() => props.preview?.[mode.value] || '')
const metaItems = computed(() => {
    const items: { label: string; value: string }[] = []
    if (props.preview?.challengeDir) {
        items.push({ label: '校验目录', value: props.preview.challengeDir })
    }
    if (mode.value === 'ssl' && props.preview?.certDir) {
        items.push({ label: '证书目录', value: props.preview.certDir })
    }
    return items
})

/** 本机盘符路径贴到 Linux 宝塔会失效 */
const pathWarning = computed(() => {
    const paths = [props.preview?.challengeDir, props.preview?.certDir].filter(Boolean) as string[]
    const localLike = paths.some((p) => /^[A-Za-z]:[\\/]/.test(p) || p.includes('\\'))
    if (localLike) {
        return '当前证书/校验路径像是本机开发目录。贴到 Linux 宝塔前，请在目标服务器上重新复制配置，或把校验目录、证书目录改成服务器绝对路径。'
    }
    if (mode.value === 'ssl') {
        return '请确认 ssl_certificate 路径在目标服务器上真实存在后再重载。'
    }
    return '';
});

watch(() => props.visible, (open) => {
    if (open) {
        mode.value = 'httpOnly'
        copied.value = false
    }
})

watch(mode, () => {
    copied.value = false
})

async function copyCurrent() {
    if (!currentText.value) return
    await navigator.clipboard.writeText(currentText.value)
    copied.value = true
    ElMessage.success('已复制')
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
        copied.value = false
    }, 1600)
}
</script>

<style scoped lang="scss">
.panel {
    margin-bottom: 12px;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--el-border-color-lighter);
    background: var(--el-fill-color-blank);
}

.panel__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
}

.panel__desc {
    flex: 1;
    min-width: 220px;
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--el-text-color-secondary);
}

.paths {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px dashed var(--el-border-color-lighter);
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.path-warn {
    margin-top: 12px;
}

.paths__row {
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 10px;
    align-items: start;
    font-size: 13px;
}

.paths__label {
    color: var(--el-text-color-secondary);
    line-height: 1.6;
}

.paths__value {
    margin: 0;
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--el-fill-color-light, var(--el-fill-color));
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.6;
    word-break: break-all;
    color: var(--el-text-color-primary);
}

.code-box {
    overflow: hidden;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--el-text-color-primary) 14%, var(--el-border-color));
    background: #1a1f2a;
}

.code-box__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 40px;
    padding: 0 12px;
    background: color-mix(in srgb, #000 22%, #1a1f2a);
    border-bottom: 1px solid color-mix(in srgb, #fff 8%, transparent);
}

.code-box__name {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    color: #9aa3b2;
}

.code-box__copy {
    height: 28px;
    padding: 0 12px;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    color: #e8edf5;
    background: color-mix(in srgb, #fff 12%, transparent);
    transition: background 0.2s ease, color 0.2s ease;

    &:hover:not(:disabled) {
        background: color-mix(in srgb, #fff 18%, transparent);
    }

    &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    &.ok {
        color: #0b3d2e;
        background: #6ee7b7;
    }
}

pre {
    margin: 0;
    min-height: 360px;
    max-height: 52vh;
    overflow: auto;
    padding: 14px 16px;
    color: #e7ebf2;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.65;
    white-space: pre-wrap;
}
</style>
