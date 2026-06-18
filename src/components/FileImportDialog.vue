<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  title: string;
  description: string;
  multiple?: boolean;
  accept?: string;
  confirmLabel: string;
  isSubmitting?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  submit: [files: File[]];
}>();

const selectedFiles = ref<File[]>([]);

const jsonSample = `[
  {
    "key": "KEY 键值",
    "original": "source text 原文",
    "translation": "translation text 译文",
    "context": "Context 上下文 optional"
  },
  {
    "key": "KEY 键值 2",
    "original": "source text 原文 2",
    "translation": "translation text 译文 2"
  }
]`;

const csvSample = `#正式使用时请删除前三行。Please remove the first 3 lines in production.
#键值,原文,译文,上下文（可选）
#Key,Source,Translation,Context(optional)
key_apple,apple,苹果,"A common, round fruit produced by the tree Malus domestica."
key_pear,pear,梨
key_peach,peach,桃子`;

watch(
  () => props.open,
  () => {
    selectedFiles.value = [];
  },
);

function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedFiles.value = Array.from(input.files ?? []);
}

function handleSubmit() {
  if (selectedFiles.value.length > 0) {
    emit("submit", selectedFiles.value);
  }
}

function downloadSample(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section v-if="open" class="dialog-backdrop" role="presentation">
    <article class="dialog" role="dialog" aria-modal="true" :aria-label="title">
      <header>
        <h2>{{ title }}</h2>
        <p>{{ description }}</p>
      </header>

      <label class="file-input">
        <span>选择文件</span>
        <input
          type="file"
          :multiple="multiple"
          :accept="accept"
          @change="handleFiles"
        />
      </label>

      <section class="support-note" aria-label="导入格式说明">
        <p>当前支持导入：</p>
        <ul>
          <li>.txt / .ks：按行生成词条。</li>
          <li>
            .json / .jsonl / .csv：读取 key、source/original、target/translation、context 字段。
          </li>
        </ul>

        <div class="sample-grid">
          <article class="sample-card">
            <div>
              <strong>JSON 示例</strong>
              <span>数组格式，适合结构化词条。</span>
            </div>
            <div class="sample-card-actions">
              <details>
                <summary>查看示例</summary>
                <pre><code>{{ jsonSample }}</code></pre>
              </details>
              <button
                class="sample-button"
                type="button"
                @click="
                  downloadSample(
                    'textile-import-sample.json',
                    jsonSample,
                    'application/json;charset=utf-8',
                  )
                "
              >
                下载示例
              </button>
            </div>
          </article>

          <article class="sample-card">
            <div>
              <strong>CSV 示例</strong>
              <span>逗号分隔，支持注释说明行。</span>
            </div>
            <div class="sample-card-actions">
              <details>
                <summary>查看示例</summary>
                <pre><code>{{ csvSample }}</code></pre>
              </details>
              <button
                class="sample-button"
                type="button"
                @click="
                  downloadSample(
                    'textile-import-sample.csv',
                    csvSample,
                    'text/csv;charset=utf-8',
                  )
                "
              >
                下载示例
              </button>
            </div>
          </article>
        </div>
      </section>

      <ul v-if="selectedFiles.length" class="selected-list">
        <li v-for="file in selectedFiles" :key="file.name">
          {{ file.name }}
        </li>
      </ul>

      <footer>
        <button class="secondary-button" type="button" @click="emit('cancel')">
          取消
        </button>
        <button
          class="primary-button"
          type="button"
          :disabled="selectedFiles.length === 0 || isSubmitting"
          @click="handleSubmit"
        >
          {{ isSubmitting ? "处理中..." : confirmLabel }}
        </button>
      </footer>
    </article>
  </section>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.38);
}

.dialog {
  display: grid;
  gap: 16px;
  width: min(560px, 100%);
  padding: 20px;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.24);
}

h2,
p {
  margin: 0;
}

h2 {
  color: #111827;
  font-size: 22px;
}

p,
.selected-list {
  color: #4b5563;
  line-height: 1.6;
}

.file-input {
  display: grid;
  gap: 8px;
}

.file-input span {
  color: #5b6472;
  font-size: 13px;
}

input[type="file"] {
  min-height: 42px;
  padding: 8px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
}

.support-note {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid #d7dde5;
  border-radius: 6px;
  background: #f8fafb;
  font-size: 13px;
}

.support-note ul {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 20px;
  line-height: 1.6;
}

.sample-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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

.sample-card-actions details {
  min-width: 0;
}

.sample-card-actions summary,
.sample-button {
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
  cursor: pointer;
  white-space: nowrap;
}

pre {
  overflow: auto;
  max-height: 180px;
  margin: 8px 0 0;
  padding: 10px;
  border-radius: 6px;
  background: #eef2f7;
  color: #111827;
  font-size: 12px;
  line-height: 1.5;
}

.selected-list {
  display: grid;
  gap: 4px;
  max-height: 130px;
  overflow: auto;
  margin: 0;
  padding-left: 20px;
}

footer {
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

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

@media (max-width: 640px) {
  .sample-grid,
  .sample-card-actions {
    grid-template-columns: 1fr;
  }
}
</style>
