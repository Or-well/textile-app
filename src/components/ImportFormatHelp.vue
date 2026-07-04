<script setup lang="ts">
import { ref } from "vue";
import { saveGeneratedFile } from "../utils/saveBlob";

interface ImportFormatSample {
  title: string;
  description: string;
  fileName: string;
  mimeType: string;
  sampleText?: string;
  previewable?: boolean;
  buildBlob?: () => Blob | Promise<Blob>;
}

defineProps<{
  notes: string[];
  samples: ImportFormatSample[];
}>();

const previewItem = ref<ImportFormatSample | null>(null);
const saveMessage = ref("");
const saveError = ref("");

async function downloadSample(item: ImportFormatSample) {
  saveMessage.value = "";
  saveError.value = "";

  try {
    const blob = item.buildBlob
      ? await item.buildBlob()
      : new Blob([item.sampleText ?? ""], { type: item.mimeType });
    const saved = await saveGeneratedFile(blob, item.fileName);

    saveMessage.value = saved.saved
      ? `示例文件已保存为 ${saved.fileName}。`
      : saved.reason;
  } catch (error) {
    saveError.value =
      error instanceof Error ? error.message : "示例文件保存失败。";
  }
}

function openPreview(item: ImportFormatSample) {
  if (item.previewable && item.sampleText) {
    previewItem.value = item;
  }
}

function closePreview() {
  previewItem.value = null;
}
</script>

<template>
  <section class="import-format-help" aria-label="导入格式说明">
    <p>当前支持导入：</p>
    <p v-if="saveMessage" class="sample-save-message">{{ saveMessage }}</p>
    <p v-if="saveError" class="sample-save-error">{{ saveError }}</p>
    <ul>
      <li v-for="note in notes" :key="note">{{ note }}</li>
    </ul>

    <div class="sample-grid">
      <article v-for="item in samples" :key="item.fileName" class="sample-card">
        <div>
          <strong>{{ item.title }}</strong>
          <span>{{ item.description }}</span>
        </div>
        <div class="sample-card-actions">
          <button
            v-if="item.previewable && item.sampleText"
            class="sample-button"
            type="button"
            @click="openPreview(item)"
          >
            查看示例
          </button>
          <span v-else class="sample-spacer">仅下载</span>
          <button class="sample-button" type="button" @click="downloadSample(item)">
            下载示例
          </button>
        </div>
      </article>
    </div>

    <section v-if="previewItem" class="preview-backdrop" role="presentation">
      <article class="preview-dialog" role="dialog" aria-modal="true" :aria-label="previewItem.title">
        <header>
          <div>
            <h2>{{ previewItem.title }}</h2>
            <p>{{ previewItem.description }}</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭预览" @click="closePreview">
            ×
          </button>
        </header>

        <pre class="preview-code"><code>{{ previewItem.sampleText }}</code></pre>

        <footer>
          <button
            class="secondary-button"
            type="button"
            @click="downloadSample(previewItem)"
          >
            下载示例
          </button>
          <button class="primary-button" type="button" @click="closePreview">
            关闭
          </button>
        </footer>
      </article>
    </section>
  </section>
</template>

<style scoped>
.import-format-help {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  color: var(--color-muted);
  font-size: var(--font-sm);
}

p {
  margin: 0;
}

.sample-save-message,
.sample-save-error {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  line-height: 1.5;
}

.sample-save-message {
  border: 1px solid #b7dfc2;
  color: #166534;
}

.sample-save-error {
  border: 1px solid #f0b8aa;
  color: #b42318;
}

ul {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: var(--space-6);
  line-height: 1.5;
}

.sample-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: var(--space-3);
}

.sample-card {
  display: grid;
  align-content: start;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.sample-card strong,
.sample-card span {
  display: block;
}

.sample-card strong {
  color: var(--color-heading);
  font-size: var(--font-sm);
}

.sample-card span {
  margin-top: var(--space-1);
  color: var(--color-muted);
  line-height: 1.45;
}

.sample-card-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
  align-items: start;
}

.sample-button,
.sample-spacer {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  min-height: var(--control-sm);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-sm);
  white-space: nowrap;
}

.sample-button {
  cursor: pointer;
}

.sample-spacer {
  color: var(--color-muted);
}

.preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: var(--space-7);
  background: rgba(15, 23, 42, 0.45);
}

.preview-dialog {
  display: grid;
  gap: var(--space-4);
  width: min(760px, 100%);
  max-height: calc(100vh - 40px);
  padding: var(--panel-padding);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
}

.preview-dialog header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

h2 {
  margin: 0;
  color: var(--color-heading);
  font-size: 18px;
  line-height: 1.3;
}

.preview-dialog header p {
  margin-top: var(--space-1);
  line-height: 1.5;
}

.icon-button {
  flex: 0 0 auto;
  width: var(--control-md);
  height: var(--control-md);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-muted);
  font: inherit;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.preview-code {
  overflow: auto;
  max-height: 520px;
  margin: 0;
  padding: var(--space-4);
  border-radius: var(--radius-sm);
  background: #eef2f7;
  color: var(--color-heading);
  font-size: var(--font-xs);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.preview-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}

.primary-button,
.secondary-button {
  min-height: var(--control-md);
  padding: 0 var(--space-4);
  border-radius: var(--radius-sm);
  font: inherit;
  cursor: pointer;
}

.primary-button {
  border: 0;
  background: var(--color-brand);
  color: #ffffff;
}

.secondary-button {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
}

@media (max-width: 640px) {
  .sample-card-actions {
    grid-template-columns: 1fr;
  }
}
</style>
