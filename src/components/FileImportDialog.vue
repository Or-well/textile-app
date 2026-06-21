<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ImportFormatHelp from "./ImportFormatHelp.vue";

const props = defineProps<{
  open: boolean;
  title: string;
  description: string;
  multiple?: boolean;
  accept?: string;
  confirmLabel: string;
  isSubmitting?: boolean;
  importMode?: "source" | "source-update" | "translation";
}>();

const emit = defineEmits<{
  cancel: [];
  submit: [files: File[]];
}>();

const selectedFiles = ref<File[]>([]);

const legacyJsonSample = `[
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

const exchangeJsonSample = `[
  {
    "key": "line_000001",
    "index": 1,
    "speaker": "角色名",
    "source": "原文",
    "target": "译文",
    "context": "上下文",
    "status": "proofread",
    "translated_by": "",
    "proofread_count": 1,
    "proofread_by": [],
    "reviewed_by": ""
  }
]`;

const exchangeJsonlSample = `{"key":"line_000001","index":1,"speaker":"角色名","source":"原文","target":"译文","context":"上下文","status":"proofread","translated_by":"","proofread_count":1,"proofread_by":[],"reviewed_by":""}
{"key":"line_000002","index":2,"speaker":"","source":"第二条原文","target":"","context":"","status":"untranslated","translated_by":"","proofread_count":0,"proofread_by":[],"reviewed_by":""}`;

const csvSample = `#正式使用时请删除前三行。Please remove the first 3 lines in production.
#键值,原文,译文,上下文（可选）
#Key,Source,Translation,Context(optional)
key_apple,apple,苹果,"A common, round fruit produced by the tree Malus domestica."
key_pear,pear,梨
key_peach,peach,桃子`;

const importNotes = computed(() => {
  if (props.importMode === "translation") {
    return [
      "此入口只按 key / index 更新译文，文件中的状态和校对、审核字段不会被采用。",
      "译文内容发生变化时，词条会回到已翻译或未翻译，并清空原有校对和审核结果。",
      ".json / .jsonl / .csv 可按 key / index 匹配；.txt / .ks 按行号匹配。",
    ];
  }

  if (props.importMode === "source-update") {
    return [
      "更新源文件时优先保留项目内已有译文和工作流状态。",
      "交换 JSON / JSONL 中的工作流字段不会覆盖项目内现有审计信息。",
      ".txt / .ks 按行读取；.json / .jsonl / .csv 读取结构化词条。",
    ];
  }

  return [
    ".txt / .ks：按行生成词条；.csv：只读取词条内容，不保存工作流状态。",
    "旧 JSON / JSONL 继续按 key、source/original、target/translation、context 等字段导入。",
    "Textile 词条交换 JSON / JSONL 可额外保留 status、校对次数和相关成员记录。",
  ];
});

const importSamples = computed(() => {
  const contentSamples = [
    {
      title: "普通 JSON 示例",
      description: "兼容旧格式，只包含词条内容。",
      fileName: "textile-content-sample.json",
      mimeType: "application/json;charset=utf-8",
      sampleText: legacyJsonSample,
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

  if (props.importMode === "translation") {
    return contentSamples;
  }

  return [
    ...contentSamples,
    {
      title: "词条交换 JSON",
      description: "数组格式，可保留工作流状态。",
      fileName: "textile-entry-exchange-sample.json",
      mimeType: "application/json;charset=utf-8",
      sampleText: exchangeJsonSample,
      previewable: true,
    },
    {
      title: "词条交换 JSONL",
      description: "每行一个词条，可保留工作流状态。",
      fileName: "textile-entry-exchange-sample.jsonl",
      mimeType: "application/x-ndjson;charset=utf-8",
      sampleText: exchangeJsonlSample,
      previewable: true,
    },
  ];
});

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
