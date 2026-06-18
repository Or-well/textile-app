<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Entry, EntryStatus } from "../model/types";
import { ENTRY_STATUS_LABELS, applyEntryWorkflowStatus } from "../model/status";
import {
  canEditEntry,
  canMarkDisputed,
  canProofreadEntry,
  canResolveDispute,
  canReviewEntry,
  canRollbackEntry,
  canTranslateEntry,
  getCurrentUser,
} from "../services/permissions";

const props = defineProps<{
  entry?: Entry;
  fileName: string;
  isSaving?: boolean;
  canGoPrevious?: boolean;
  canGoNext?: boolean;
}>();

const emit = defineEmits<{
  save: [entry: Entry];
  saveNext: [entry: Entry];
  workflowStatus: [entry: Entry];
  markDisputed: [entry: Entry];
  resolveDispute: [entry: Entry];
  openContext: [];
  previous: [];
  next: [];
  draftTargetChanged: [target: string];
}>();

const target = ref("");
const copyMessage = ref("");

const currentUser = computed(() => getCurrentUser());
const canSaveEntry = computed(() => canEditEntry(currentUser.value, props.entry));
const canSaveAsTranslated = computed(
  () =>
    Boolean(target.value.trim()) &&
    props.entry?.status === "untranslated" &&
    canTranslateEntry(currentUser.value, props.entry),
);
const canProofread = computed(() =>
  canProofreadEntry(currentUser.value, props.entry),
);
const canReview = computed(() => canReviewEntry(currentUser.value, props.entry));
const canRollback = computed(() =>
  canRollbackEntry(currentUser.value, props.entry),
);
const canRollbackToTranslated = computed(
  () => props.entry?.status === "proofread" && canRollback.value,
);
const canRollbackToProofread = computed(
  () => props.entry?.status === "reviewed" && canRollback.value,
);
const canMarkEntryDisputed = computed(() =>
  canMarkDisputed(currentUser.value, props.entry),
);
const canResolveEntryDispute = computed(() =>
  canResolveDispute(currentUser.value, props.entry),
);
const hasWorkflowActions = computed(
  () =>
    canSaveAsTranslated.value ||
    canProofread.value ||
    canReview.value ||
    canRollbackToTranslated.value ||
    canRollbackToProofread.value ||
    canMarkEntryDisputed.value ||
    canResolveEntryDispute.value,
);
const permissionMessage = computed(() =>
  props.entry && !canSaveEntry.value && !hasWorkflowActions.value
    ? "当前用户没有此操作权限"
    : "",
);

watch(
  () => props.entry,
  (entry) => {
    target.value = entry?.target ?? "";
    copyMessage.value = "";
    emit("draftTargetChanged", target.value);
  },
  { immediate: true },
);

watch(target, (value) => {
  emit("draftTargetChanged", value);
});

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

function buildWorkflowEntry(status: EntryStatus): Entry | undefined {
  const draftEntry = buildDraftEntry();

  if (!draftEntry) {
    return undefined;
  }

  return applyEntryWorkflowStatus(
    draftEntry,
    status,
    currentUser.value?.id ?? draftEntry.updated_by,
  );
}

function handleWorkflowStatus(status: EntryStatus) {
  const workflowEntry = buildWorkflowEntry(status);

  if (workflowEntry) {
    emit("workflowStatus", workflowEntry);
  }
}

function handleMarkDisputed() {
  const draftEntry = buildDraftEntry();

  if (draftEntry) {
    emit("markDisputed", draftEntry);
  }
}

function handleResolveDispute() {
  const draftEntry = buildDraftEntry();

  if (draftEntry) {
    emit("resolveDispute", draftEntry);
  }
}

async function copyEntryId() {
  if (!props.entry) {
    return;
  }

  try {
    await navigator.clipboard.writeText(props.entry.id);
    copyMessage.value = "已复制";
  } catch {
    copyMessage.value = "复制失败";
  }
}
</script>

<template>
  <article v-if="entry" class="entry-editor">
    <header class="editor-header">
      <div>
        <div class="status-row">
          <span class="status-badge" :class="entry.status">
            {{ ENTRY_STATUS_LABELS[entry.status] }}
          </span>
          <span v-if="entry.disputed" class="dispute-badge">有争议</span>
        </div>
        <h1>{{ entry.speaker || "旁白" }}</h1>
      </div>

      <div class="entry-nav">
        <button
          class="secondary-button"
          type="button"
          :disabled="!canGoPrevious || isSaving"
          @click="emit('previous')"
        >
          上一条
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="!canGoNext || isSaving"
          @click="emit('next')"
        >
          下一条
        </button>
      </div>
    </header>

    <section class="source-panel">
      <div class="source-toolbar">
        <span class="field-label">原文</span>
        <button
          class="text-button"
          type="button"
          @click="emit('openContext')"
        >
          {{ entry.context ? "查看上下文" : "添加上下文" }}
        </button>
      </div>
      <p>{{ entry.source }}</p>
    </section>

    <label class="target-panel">
      <span class="field-label">译文</span>
      <textarea
        v-model="target"
        rows="6"
        placeholder="请输入译文"
        :disabled="isSaving || entry.locked || !canSaveEntry"
      />
    </label>

    <p v-if="permissionMessage" class="permission-message">
      {{ permissionMessage }}
    </p>

    <footer class="actions">
      <button
        v-if="canSaveEntry"
        class="secondary-button"
        type="button"
        :disabled="isSaving || entry.locked"
        @click="handleSave"
      >
        {{ isSaving ? "保存中..." : "保存修改" }}
      </button>
      <button
        v-if="canSaveEntry"
        class="primary-button"
        type="button"
        :disabled="isSaving || entry.locked"
        @click="handleSaveNext"
      >
        保存并下一条
      </button>
    </footer>

    <footer v-if="hasWorkflowActions" class="actions workflow-actions">
      <button
        v-if="canSaveAsTranslated"
        class="primary-button"
        type="button"
        :disabled="isSaving || entry.locked"
        @click="handleWorkflowStatus('translated')"
      >
        保存为已翻译
      </button>
      <button
        v-if="canProofread"
        class="primary-button"
        type="button"
        :disabled="isSaving || entry.locked"
        @click="handleWorkflowStatus('proofread')"
      >
        校对通过
      </button>
      <button
        v-if="canReview"
        class="primary-button"
        type="button"
        :disabled="isSaving || entry.locked"
        @click="handleWorkflowStatus('reviewed')"
      >
        审核通过
      </button>
      <button
        v-if="canRollbackToTranslated"
        class="secondary-button"
        type="button"
        :disabled="isSaving || entry.locked"
        @click="handleWorkflowStatus('translated')"
      >
        退回翻译
      </button>
      <button
        v-if="canRollbackToProofread"
        class="secondary-button"
        type="button"
        :disabled="isSaving || entry.locked"
        @click="handleWorkflowStatus('proofread')"
      >
        退回校对
      </button>
      <button
        v-if="canMarkEntryDisputed"
        class="secondary-button warning-button"
        type="button"
        :disabled="isSaving || entry.locked"
        @click="handleMarkDisputed"
      >
        标记争议
      </button>
      <button
        v-if="canResolveEntryDispute"
        class="secondary-button"
        type="button"
        :disabled="isSaving || entry.locked"
        @click="handleResolveDispute"
      >
        解决争议
      </button>
    </footer>

    <dl class="meta-grid">
      <div>
        <dt>键值</dt>
        <dd>{{ fileName }}:{{ entry.key }}</dd>
      </div>
      <div>
        <dt>文件</dt>
        <dd>{{ fileName }}</dd>
      </div>
      <div>
        <dt>字数</dt>
        <dd>{{ entry.word_count }}</dd>
      </div>
    </dl>

    <details class="technical-details">
      <summary>技术详情</summary>
      <div class="technical-row">
        <code>{{ entry.id }}</code>
        <button class="text-button" type="button" @click="copyEntryId">
          复制 ID
        </button>
        <span v-if="copyMessage">{{ copyMessage }}</span>
      </div>
    </details>
  </article>

  <section v-else class="empty-editor">
    <h1>请选择词条</h1>
    <p>从左侧列表选择一个词条后，可以在这里编辑译文。</p>
  </section>
</template>

<style scoped>
.entry-editor,
.empty-editor {
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 0;
  padding: 20px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

h1,
p,
dl,
dd {
  margin: 0;
}

h1 {
  margin-top: 8px;
  color: #111827;
  font-size: 24px;
  line-height: 1.25;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 9px;
  border-radius: 999px;
  background: #eef2f7;
  color: #374151;
  font-size: 13px;
  font-weight: 700;
}

.status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.status-badge.translated {
  background: #e6f0ef;
  color: #174346;
}

.status-badge.proofread,
.status-badge.reviewed {
  background: #edf3df;
  color: #445915;
}

.dispute-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 9px;
  border-radius: 999px;
  background: #fff3dc;
  color: #92400e;
  font-size: 13px;
  font-weight: 700;
}

.entry-nav,
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.workflow-actions {
  padding-bottom: 4px;
  border-bottom: 1px solid #eef1f5;
}

.source-panel,
.target-panel {
  display: grid;
  gap: 8px;
}

.source-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.source-panel {
  padding: 16px;
  border-radius: 8px;
  background: #f8fafb;
}

.field-label,
dt {
  color: #5b6472;
  font-size: 13px;
}

.source-panel p {
  color: #111827;
  font-size: 17px;
  line-height: 1.7;
}

textarea {
  width: 100%;
  min-height: 150px;
  height: 160px;
  resize: vertical;
  padding: 12px;
  border: 1px solid #c8d0dc;
  border-radius: 8px;
  color: #1f2937;
  line-height: 1.7;
}

textarea:focus {
  border-color: #2f6f73;
  outline: 3px solid #c7dddb;
}

textarea:disabled {
  background: #f3f4f6;
  color: #6b7280;
}

.permission-message {
  color: #b45309;
  line-height: 1.6;
}

.meta-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr) minmax(88px, 0.45fr);
  gap: 10px;
}

.meta-grid div {
  min-width: 0;
  padding: 10px;
  border-radius: 6px;
  background: #f8fafb;
}

dd {
  overflow-wrap: anywhere;
  color: #111827;
  font-size: 14px;
}

.primary-button,
.secondary-button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 6px;
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

.warning-button {
  border-color: #f0b96a;
  color: #92400e;
}

.text-button {
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #2f6f73;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.technical-details {
  color: #5b6472;
  font-size: 13px;
}

.technical-details summary {
  cursor: pointer;
}

.technical-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.technical-row code {
  overflow-wrap: anywhere;
  color: #374151;
}

.primary-button:disabled,
.secondary-button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.empty-editor {
  align-content: start;
  color: #4b5563;
}

.empty-editor p {
  line-height: 1.7;
}

@media (max-width: 780px) {
  .editor-header {
    flex-direction: column;
  }

  .meta-grid {
    grid-template-columns: 1fr;
  }
}
</style>
