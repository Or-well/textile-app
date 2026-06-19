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
  padding: 20px;
  background: rgba(15, 23, 42, 0.38);
}

.dialog {
  display: grid;
  gap: 16px;
  width: min(760px, 100%);
  max-height: calc(100vh - 40px);
  overflow: auto;
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

p {
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

.selected-file {
  padding: 10px;
  border: 1px solid #d7dde5;
  border-radius: 6px;
  background: #f8fafb;
  font-size: 13px;
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
