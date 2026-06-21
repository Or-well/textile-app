<script setup lang="ts">
import { ref } from "vue";
import { saveBlob } from "../utils/saveBlob";

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
    const saved = await saveBlob(blob, item.fileName);

    saveMessage.value = saved.saved
      ? saved.method === "file-picker"
        ? `示例文件已保存为 ${saved.fileName}。`
        : "示例文件下载已开始。请在浏览器下载列表或系统“下载”文件夹中确认保存结果。"
      : "示例文件保存已取消。";
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
  gap: 10px;
  padding: 10px;
  border: 1px solid #d7dde5;
  border-radius: 6px;
  background: #f8fafb;
  color: #4b5563;
  font-size: 13px;
}

p {
  margin: 0;
}

.sample-save-message,
.sample-save-error {
  padding: 8px 10px;
  border-radius: 6px;
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
  padding-left: 20px;
  line-height: 1.6;
}

.sample-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
}

.sample-card {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.sample-card strong,
.sample-card span {
  display: block;
}

.sample-card strong {
  color: #111827;
  font-size: 14px;
}

.sample-card span {
  margin-top: 3px;
  color: #5b6472;
  line-height: 1.5;
}

.sample-card-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  align-items: start;
}

.sample-button,
.sample-spacer {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
}

.sample-button {
  cursor: pointer;
}

.sample-spacer {
  color: #5b6472;
}

.preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.45);
}

.preview-dialog {
  display: grid;
  gap: 14px;
  width: min(760px, 100%);
  max-height: calc(100vh - 48px);
  padding: 18px;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
}

.preview-dialog header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

h2 {
  margin: 0;
  color: #111827;
  font-size: 20px;
  line-height: 1.3;
}

.preview-dialog header p {
  margin-top: 4px;
  line-height: 1.6;
}

.icon-button {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #4b5563;
  font: inherit;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.preview-code {
  overflow: auto;
  max-height: 520px;
  margin: 0;
  padding: 12px;
  border-radius: 6px;
  background: #eef2f7;
  color: #111827;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.preview-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.primary-button,
.secondary-button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.primary-button {
  border: 0;
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

@media (max-width: 640px) {
  .sample-card-actions {
    grid-template-columns: 1fr;
  }
}
</style>
