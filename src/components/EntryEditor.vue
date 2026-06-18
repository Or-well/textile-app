<script setup lang="ts">
import { ref, watch } from "vue";
import TermHint from "./TermHint.vue";
import type { Entry } from "../model/types";
import { checkTermUsage, type TermUsageResult } from "../services/terms";

const props = defineProps<{
  entry?: Entry;
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  save: [entry: Entry];
  saveNext: [entry: Entry];
}>();

const target = ref("");
const termResults = ref<TermUsageResult[]>([]);
const termErrorMessage = ref("");
let termRequestId = 0;

watch(
  () => props.entry,
  (entry) => {
    target.value = entry?.target ?? "";
  },
  { immediate: true },
);

watch(
  [() => props.entry?.source, target],
  async ([sourceText, targetText]) => {
    const requestId = (termRequestId += 1);

    if (!sourceText) {
      termResults.value = [];
      termErrorMessage.value = "";
      return;
    }

    try {
      const results = await checkTermUsage(sourceText, targetText);

      if (requestId === termRequestId) {
        termResults.value = results;
        termErrorMessage.value = "";
      }
    } catch (error) {
      if (requestId === termRequestId) {
        termResults.value = [];
        termErrorMessage.value =
          error instanceof Error ? error.message : "术语提示无法读取。";
      }
    }
  },
  { immediate: true },
);

function buildDraftEntry(): Entry | undefined {
  if (!props.entry) {
    return undefined;
  }

  return {
    ...props.entry,
    target: target.value,
  };
}

function handleSave() {
  const draftEntry = buildDraftEntry();

  if (draftEntry) {
    emit("save", draftEntry);
  }
}

function handleSaveNext() {
  const draftEntry = buildDraftEntry();

  if (draftEntry) {
    emit("saveNext", draftEntry);
  }
}
</script>

<template>
  <article v-if="entry" class="entry-editor">
    <p class="entry-index">#{{ entry.index }}</p>
    <h2>{{ entry.speaker || "旁白" }}</h2>

    <div class="field-group">
      <span class="field-label">原文</span>
      <p class="source-text">{{ entry.source }}</p>
    </div>

    <div class="field-group">
      <span class="field-label">上下文</span>
      <p>{{ entry.context || "无" }}</p>
    </div>

    <label class="field-group">
      <span class="field-label">译文</span>
      <textarea
        v-model="target"
        class="target-input"
        rows="8"
        placeholder="请输入译文"
        :disabled="isSaving || entry.locked"
      />
    </label>

    <div class="meta-row">
      <span>状态：{{ entry.status }}</span>
      <span>键名：{{ entry.key }}</span>
    </div>

    <p v-if="termErrorMessage" class="term-error">{{ termErrorMessage }}</p>
    <TermHint v-else :terms="termResults" />

    <div class="actions">
      <button
        class="secondary-button"
        type="button"
        :disabled="isSaving || entry.locked"
        @click="handleSave"
      >
        {{ isSaving ? "保存中..." : "保存" }}
      </button>
      <button
        class="primary-button"
        type="button"
        :disabled="isSaving || entry.locked"
        @click="handleSaveNext"
      >
        保存并下一条
      </button>
    </div>
  </article>
</template>

<style scoped>
.entry-editor {
  padding: 22px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.entry-index,
.field-label,
.meta-row {
  color: #5b6472;
  font-size: 13px;
}

.entry-index {
  margin: 0 0 6px;
}

h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}

.field-group {
  display: grid;
  gap: 6px;
  margin-top: 18px;
}

.field-group p {
  margin: 0;
  line-height: 1.7;
}

.source-text {
  font-size: 17px;
}

.target-input {
  width: 100%;
  min-height: 180px;
  resize: vertical;
  padding: 12px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  color: #1f2937;
  font: inherit;
  line-height: 1.7;
}

.target-input:focus {
  border-color: #2563eb;
  outline: 3px solid #dbeafe;
}

.target-input:disabled {
  background: #f3f4f6;
  color: #6b7280;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 14px;
}

.term-error {
  margin: 18px 0 0;
  color: #b42318;
  line-height: 1.6;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
}

.primary-button,
.secondary-button {
  min-height: 40px;
  padding: 0 15px;
  border-radius: 6px;
  font-size: 15px;
  cursor: pointer;
}

.primary-button {
  border: 0;
  background: #2563eb;
  color: #ffffff;
}

.secondary-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

.primary-button:disabled,
.secondary-button:disabled {
  cursor: wait;
  opacity: 0.68;
}
</style>
