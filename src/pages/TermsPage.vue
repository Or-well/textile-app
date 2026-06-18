<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { Term } from "../model/types";
import { canManageTerm, getCurrentUser } from "../services/permissions";
import {
  addTerm,
  deleteTerm,
  exportTermsFile,
  importTermsFile,
  loadTerms,
  updateTerm,
  type TermInput,
} from "../services/terms";

interface TermDraft {
  source: string;
  target: string;
  part_of_speech: string;
  note: string;
  variantsText: string;
}

const terms = ref<Term[]>([]);
const searchText = ref("");
const editingTermId = ref("");
const draft = ref<TermDraft>(createEmptyDraft());
const isLoading = ref(false);
const isSaving = ref(false);
const errorMessage = ref("");
const message = ref("");
const currentUser = ref(getCurrentUser());

const canManageTerms = computed(() => canManageTerm(currentUser.value));
const isEditing = computed(() => Boolean(editingTermId.value));

const filteredTerms = computed(() => {
  const keyword = searchText.value.trim().toLowerCase();

  if (!keyword) {
    return terms.value;
  }

  return terms.value.filter((term) => {
    const values = [
      term.source,
      term.target,
      term.part_of_speech,
      term.note,
      ...term.variants,
    ].map((value) => value.toLowerCase());

    return values.some((value) => value.includes(keyword));
  });
});

function createEmptyDraft(): TermDraft {
  return {
    source: "",
    target: "",
    part_of_speech: "",
    note: "",
    variantsText: "",
  };
}

function splitVariants(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/\r?\n|,/)
        .map((variant) => variant.trim())
        .filter(Boolean),
    ),
  );
}

function createInputFromDraft(): TermInput {
  return {
    source: draft.value.source,
    target: draft.value.target,
    part_of_speech: draft.value.part_of_speech,
    note: draft.value.note,
    variants: splitVariants(draft.value.variantsText),
  };
}

function getCurrentUserId(): string {
  return currentUser.value?.id ?? "unknown_user";
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadTermRows() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    terms.value = await loadTerms();
  } catch (error) {
    terms.value = [];
    errorMessage.value =
      error instanceof Error ? error.message : "术语表无法读取。";
  } finally {
    isLoading.value = false;
  }
}

function resetDraft() {
  editingTermId.value = "";
  draft.value = createEmptyDraft();
}

function startEdit(term: Term) {
  editingTermId.value = term.id;
  draft.value = {
    source: term.source,
    target: term.target,
    part_of_speech: term.part_of_speech,
    note: term.note,
    variantsText: term.variants.join("\n"),
  };
  message.value = "";
  errorMessage.value = "";
}

async function handleSaveTerm() {
  if (!canManageTerms.value) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    if (isEditing.value) {
      await updateTerm(editingTermId.value, createInputFromDraft());
      message.value = "术语已更新。";
    } else {
      await addTerm(createInputFromDraft(), getCurrentUserId());
      message.value = "术语已新增。";
    }

    resetDraft();
    terms.value = await loadTerms();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "术语保存失败。";
  } finally {
    isSaving.value = false;
  }
}

async function handleDeleteTerm(term: Term) {
  if (!canManageTerms.value) {
    return;
  }

  if (!window.confirm(`删除术语“${term.source}”？`)) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    await deleteTerm(term.id);
    terms.value = await loadTerms();

    if (editingTermId.value === term.id) {
      resetDraft();
    }

    message.value = "术语已删除。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "术语删除失败。";
  } finally {
    isSaving.value = false;
  }
}

async function handleImportTerms(event: Event) {
  if (!canManageTerms.value) {
    return;
  }

  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const result = await importTermsFile(file, getCurrentUserId());

    terms.value = await loadTerms();
    message.value = `已导入 ${result.total} 条术语，新增 ${result.added} 条，更新 ${result.updated} 条。`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "术语导入失败。";
  } finally {
    isSaving.value = false;
    input.value = "";
  }
}

async function handleExportTerms() {
  errorMessage.value = "";
  message.value = "";

  try {
    const result = await exportTermsFile();

    downloadBlob(result.blob, result.fileName);
    message.value = `已导出术语：${result.fileName}`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "术语导出失败。";
  }
}

onMounted(loadTermRows);
</script>

<template>
  <section class="terms-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">术语</p>
        <h1>术语</h1>
        <p class="summary">查看、检索和维护当前项目的术语表。</p>
      </div>

      <span class="count-badge">{{ filteredTerms.length }} / {{ terms.length }} 条</span>
    </header>

    <section class="toolbar">
      <label>
        <span>搜索</span>
        <input
          v-model="searchText"
          type="search"
          placeholder="搜索原文、译名、词性、备注或变体"
        />
      </label>

      <div class="toolbar-actions">
        <button type="button" :disabled="isLoading" @click="handleExportTerms">
          导出术语
        </button>
        <label v-if="canManageTerms" class="import-button">
          <span>导入术语</span>
          <input
            type="file"
            accept=".jsonl,.json,application/json"
            :disabled="isSaving"
            @change="handleImportTerms"
          />
        </label>
      </div>
    </section>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="message" class="message">{{ message }}</p>

    <section v-if="canManageTerms" class="term-form-panel">
      <h2>{{ isEditing ? "编辑术语" : "新增术语" }}</h2>

      <div class="term-form-grid">
        <label>
          <span>原文</span>
          <input v-model="draft.source" type="text" placeholder="例如 魔術回路" />
        </label>
        <label>
          <span>推荐译名</span>
          <input v-model="draft.target" type="text" placeholder="例如 魔术回路" />
        </label>
        <label>
          <span>词性</span>
          <input v-model="draft.part_of_speech" type="text" placeholder="名词 / 人名 / 地名" />
        </label>
        <label>
          <span>变体</span>
          <textarea
            v-model="draft.variantsText"
            rows="4"
            placeholder="每行一个变体，也可用逗号分隔"
          />
        </label>
      </div>

      <label>
        <span>备注</span>
        <textarea v-model="draft.note" rows="3" placeholder="补充使用范围、禁用译名或注意事项" />
      </label>

      <div class="form-actions">
        <button
          class="primary-button"
          type="button"
          :disabled="isSaving"
          @click="handleSaveTerm"
        >
          {{ isSaving ? "保存中..." : isEditing ? "保存修改" : "新增术语" }}
        </button>
        <button
          v-if="isEditing"
          type="button"
          :disabled="isSaving"
          @click="resetDraft"
        >
          取消编辑
        </button>
      </div>
    </section>

    <p v-else class="readonly-note">
      当前用户只能查看术语。新增、编辑、删除和导入需要术语管理权限。
    </p>

    <p v-if="isLoading" class="empty-state">正在加载术语...</p>

    <div v-else-if="filteredTerms.length > 0" class="term-list">
      <article v-for="term in filteredTerms" :key="term.id" class="term-card">
        <div class="term-main">
          <div>
            <span class="field-label">原文</span>
            <strong>{{ term.source }}</strong>
          </div>
          <div>
            <span class="field-label">推荐译名</span>
            <strong class="target-text">{{ term.target }}</strong>
          </div>
        </div>

        <dl class="term-meta">
          <div>
            <dt>词性</dt>
            <dd>{{ term.part_of_speech || "未填写" }}</dd>
          </div>
          <div>
            <dt>创建人</dt>
            <dd>{{ term.created_by || "未记录" }}</dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd>{{ term.updated_at || "暂无记录" }}</dd>
          </div>
        </dl>

        <p v-if="term.note" class="term-note">{{ term.note }}</p>

        <div v-if="term.variants.length > 0" class="variant-list">
          <span v-for="variant in term.variants" :key="variant">
            {{ variant }}
          </span>
        </div>

        <div v-if="canManageTerms" class="card-actions">
          <button type="button" :disabled="isSaving" @click="startEdit(term)">
            编辑
          </button>
          <button
            class="danger-button"
            type="button"
            :disabled="isSaving"
            @click="handleDeleteTerm(term)"
          >
            删除
          </button>
        </div>
      </article>
    </div>

    <section v-else-if="!errorMessage" class="empty-state">
      <p>{{ terms.length === 0 ? "暂无术语。" : "没有找到匹配的术语。" }}</p>
      <button
        v-if="canManageTerms && terms.length === 0"
        type="button"
        @click="resetDraft"
      >
        新增第一条术语
      </button>
    </section>
  </section>
</template>

<style scoped>
.terms-page {
  display: grid;
  gap: 16px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.eyebrow,
.summary,
.field-label,
dt,
label span,
.readonly-note {
  color: #5b6472;
}

.eyebrow,
h1,
h2,
.summary,
p,
dl,
dd {
  margin: 0;
}

.eyebrow {
  margin-bottom: 6px;
  font-size: 14px;
}

h1 {
  color: #111827;
  font-size: 28px;
  line-height: 1.2;
}

h2 {
  color: #111827;
  font-size: 18px;
}

.summary,
.readonly-note {
  margin-top: 8px;
  line-height: 1.7;
}

.count-badge {
  flex: 0 0 auto;
  padding: 5px 10px;
  border-radius: 999px;
  background: #e6f0ef;
  color: #174346;
  font-size: 13px;
  font-weight: 700;
}

.toolbar,
.term-form-panel,
.empty-state,
.readonly-note {
  padding: 12px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.toolbar-actions,
.form-actions,
.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

label {
  display: grid;
  gap: 6px;
}

label span,
.field-label,
dt {
  font-size: 13px;
}

input,
textarea {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
}

textarea {
  min-height: 86px;
  padding-top: 8px;
  resize: vertical;
  line-height: 1.6;
}

button,
.import-button {
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  cursor: pointer;
}

.primary-button {
  border-color: #2f6f73;
  background: #2f6f73;
  color: #ffffff;
}

.danger-button {
  border-color: #f0b8aa;
  color: #b42318;
}

button:disabled,
.import-button:has(input:disabled) {
  cursor: wait;
  opacity: 0.68;
}

.import-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
}

.import-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.term-form-panel {
  display: grid;
  gap: 14px;
  padding: 16px;
}

.term-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.error-message,
.message,
.empty-state {
  line-height: 1.7;
}

.error-message {
  color: #b42318;
}

.message {
  color: #166534;
}

.empty-state {
  display: grid;
  gap: 10px;
  color: #4b5563;
}

.empty-state button {
  justify-self: start;
}

.term-list {
  display: grid;
  gap: 12px;
}

.term-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.term-main {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.term-main div,
.term-meta div {
  display: grid;
  gap: 5px;
  min-width: 0;
}

strong,
dd {
  overflow-wrap: anywhere;
  color: #111827;
}

.target-text {
  color: #166534;
}

.term-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

dd {
  font-size: 14px;
}

.term-note {
  color: #4b5563;
  line-height: 1.7;
}

.variant-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.variant-list span {
  padding: 3px 8px;
  border-radius: 999px;
  background: #f3f5f7;
  color: #4b5563;
  font-size: 13px;
}

@media (max-width: 760px) {
  .page-header,
  .toolbar,
  .term-main,
  .term-meta,
  .term-form-grid {
    grid-template-columns: 1fr;
  }

  .page-header {
    display: grid;
  }
}
</style>
