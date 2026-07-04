<script setup lang="ts">
import { ref, watch } from "vue";
import ImportFormatHelp from "./ImportFormatHelp.vue";
import { createTermSampleXlsxBlob } from "../services/terms";

const props = defineProps<{
  open: boolean;
  isSubmitting?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  submit: [file: File];
}>();

const selectedFile = ref<File | null>(null);

const termJsonSample = `[
  {
    "source": "魔術回路",
    "target": "魔术回路",
    "part_of_speech": "名词",
    "note": "专有名词",
    "variants": ["魔術迴路"],
    "case_sensitive": false
  }
]`;

const termJsonlSample = `{"source":"魔術回路","target":"魔术回路","part_of_speech":"名词","note":"专有名词","variants":["魔術迴路"],"case_sensitive":false}
{"source":"遠坂凛","target":"远坂凛","part_of_speech":"人名","note":"角色名","variants":["遠坂 凛"],"case_sensitive":true}`;

const termCsvSample = `source,target,part_of_speech,note,variants,case_sensitive
魔術回路,魔术回路,名词,专有名词,"魔術迴路;魔术迴路",false
遠坂凛,远坂凛,人名,角色名,遠坂 凛,true`;

const termImportNotes = [
  ".json：术语数组。",
  ".jsonl：每行一个术语对象。",
  ".csv：带表头 CSV，source 和 target 必填。",
  ".xlsx：读取第一个工作表，第一行必须是表头；不支持 .xls。",
];

const termImportSamples = [
  {
    title: "JSON 示例",
    description: "术语数组，适合结构化维护。",
    fileName: "textile-term-sample.json",
    mimeType: "application/json;charset=utf-8",
    sampleText: termJsonSample,
    previewable: true,
  },
  {
    title: "JSONL 示例",
    description: "一行一个术语对象，适合版本 diff。",
    fileName: "textile-term-sample.jsonl",
    mimeType: "application/x-jsonlines;charset=utf-8",
    sampleText: termJsonlSample,
    previewable: true,
  },
  {
    title: "CSV 示例",
    description: "带表头，variants 用分号分隔。",
    fileName: "textile-term-sample.csv",
    mimeType: "text/csv;charset=utf-8",
    sampleText: termCsvSample,
  },
  {
    title: "Excel 示例",
    description: "下载 .xlsx 示例；不支持 .xls。",
    fileName: "textile-term-sample.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buildBlob: createTermSampleXlsxBlob,
  },
];

watch(
  () => props.open,
  () => {
    selectedFile.value = null;
  },
);

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;

  selectedFile.value = input.files?.[0] ?? null;
}

function handleSubmit() {
  if (selectedFile.value) {
    emit("submit", selectedFile.value);
  }
}
</script>

<template>
  <section v-if="open" class="dialog-backdrop" role="presentation">
    <article class="dialog" role="dialog" aria-modal="true" aria-label="导入术语">
      <header>
        <h2>导入术语</h2>
        <p>选择术语文件后，会按 id 或 source 更新已有术语，否则新增。</p>
      </header>

      <label class="file-input">
        <span>选择文件</span>
        <input
          type="file"
          accept=".jsonl,.json,.csv,.xlsx,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          @change="handleFileChange"
        />
      </label>

      <ImportFormatHelp :notes="termImportNotes" :samples="termImportSamples" />

      <p v-if="selectedFile" class="selected-file">
        已选择：{{ selectedFile.name }}
      </p>

      <footer>
        <button class="secondary-button" type="button" @click="emit('cancel')">
          取消
        </button>
        <button
          class="primary-button"
          type="button"
          :disabled="!selectedFile || isSubmitting"
          @click="handleSubmit"
        >
          {{ isSubmitting ? "导入中..." : "开始导入" }}
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
  padding: var(--space-7);
  background: rgba(15, 23, 42, 0.38);
}

.dialog {
  display: grid;
  gap: var(--space-4);
  width: min(760px, 100%);
  max-height: calc(100vh - 40px);
  overflow: auto;
  padding: var(--panel-padding);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.24);
}

h2,
p {
  margin: 0;
}

h2 {
  color: var(--color-heading);
  font-size: 18px;
  line-height: 1.3;
}

p {
  color: var(--color-muted);
  line-height: 1.5;
}

.file-input {
  display: grid;
  gap: var(--space-2);
}

.file-input span {
  color: var(--color-muted);
  font-size: var(--font-sm);
}

input[type="file"] {
  min-height: var(--control-lg);
  padding: var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
}

.selected-file {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  font-size: var(--font-sm);
}

footer {
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

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}
</style>
