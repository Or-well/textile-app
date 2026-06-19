<script setup lang="ts">
import { ref, watch } from "vue";
import ImportFormatHelp from "./ImportFormatHelp.vue";

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

const importNotes = [
  ".txt / .ks：按行生成词条。",
  ".json / .jsonl / .csv：读取 key、source/original、target/translation、context 字段。",
];

const importSamples = [
  {
    title: "JSON 示例",
    description: "数组格式，适合结构化词条。",
    fileName: "textile-import-sample.json",
    mimeType: "application/json;charset=utf-8",
    sampleText: jsonSample,
    previewable: true,
  },
  {
    title: "CSV 示例",
    description: "逗号分隔，支持注释说明行。",
    fileName: "textile-import-sample.csv",
    mimeType: "text/csv;charset=utf-8",
    sampleText: csvSample,
  },
];

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

      <ImportFormatHelp :notes="importNotes" :samples="importSamples" />

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

</style>
