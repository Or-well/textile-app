<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Entry, EntryStatus } from "../model/types";
import { canEditEntry, getCurrentUser } from "../services/permissions";

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
  previous: [];
  next: [];
  draftTargetChanged: [target: string];
}>();

const target = ref("");

const statusLabels: Record<EntryStatus, string> = {
  untranslated: "未翻译",
  translated: "已翻译",
  proofread: "已校对",
  reviewed: "已审核",
  disputed: "有争议",
};

const currentUser = computed(() => getCurrentUser());
const canSaveEntry = computed(() => canEditEntry(currentUser.value, props.entry));
const permissionMessage = computed(() =>
  props.entry && !canSaveEntry.value ? "当前用户没有此操作权限" : "",
);

watch(
  () => props.entry,
  (entry) => {
    target.value = entry?.target ?? "";
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
</script>

<template>
  <article v-if="entry" class="entry-editor">
    <header class="editor-header">
      <div>
        <span class="status-badge" :class="entry.status">
          {{ statusLabels[entry.status] }}
        </span>
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
      <span class="field-label">原文</span>
      <p>{{ entry.source }}</p>
    </section>

    <section class="source-panel compact">
      <span class="field-label">上下文</span>
      <p>{{ entry.context || "无" }}</p>
    </section>

    <label class="target-panel">
      <span class="field-label">译文</span>
      <textarea
        v-model="target"
        rows="11"
        placeholder="请输入译文"
        :disabled="isSaving || entry.locked || !canSaveEntry"
      />
    </label>

    <p v-if="permissionMessage" class="permission-message">
      {{ permissionMessage }}
    </p>

    <dl class="meta-grid">
      <div>
        <dt>文件</dt>
        <dd>{{ fileName }}</dd>
      </div>
      <div>
        <dt>词条 ID</dt>
        <dd>{{ entry.id }}</dd>
      </div>
      <div>
        <dt>键名</dt>
        <dd>{{ entry.key }}</dd>
      </div>
      <div>
        <dt>字数</dt>
        <dd>{{ entry.word_count }}</dd>
      </div>
    </dl>

    <footer class="actions">
      <button
        class="secondary-button"
        type="button"
        :disabled="isSaving || entry.locked || !canSaveEntry"
        @click="handleSave"
      >
        {{ isSaving ? "保存中..." : "保存" }}
      </button>
      <button
        class="primary-button"
        type="button"
        :disabled="isSaving || entry.locked || !canSaveEntry"
        @click="handleSaveNext"
      >
        保存并下一条
      </button>
    </footer>
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
  gap: 18px;
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

.status-badge.translated {
  background: #e6f0ef;
  color: #174346;
}

.status-badge.proofread,
.status-badge.reviewed {
  background: #edf3df;
  color: #445915;
}

.status-badge.disputed {
  background: #fff3dc;
  color: #92400e;
}

.entry-nav,
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.source-panel,
.target-panel {
  display: grid;
  gap: 8px;
}

.source-panel {
  padding: 16px;
  border-radius: 8px;
  background: #f8fafb;
}

.source-panel.compact {
  padding: 12px 16px;
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

.source-panel.compact p {
  color: #4b5563;
  font-size: 14px;
}

textarea {
  width: 100%;
  min-height: 230px;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
