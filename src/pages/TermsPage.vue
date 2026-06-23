<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import BatchPreviewDialog from "../components/BatchPreviewDialog.vue";
import BatchSelectionBar from "../components/BatchSelectionBar.vue";
import ProjectPageHeader from "../components/ProjectPageHeader.vue";
import TermEditDialog from "../components/TermEditDialog.vue";
import TermImportDialog from "../components/TermImportDialog.vue";
import type { Term } from "../model/types";
import {
  canCreateTerm,
  canDeleteTerm,
  canExportTerm,
  canImportTerm,
  canUpdateTerm,
  getCurrentUser,
} from "../services/permissions";
import {
  addTerm,
  deleteTerm,
  exportTermsFile,
  importTermsFile,
  loadTerms,
  updateTerm,
  type TermInput,
} from "../services/terms";
import {
  executeTermBatch,
  previewTermBatch,
  type TermBatchOperation,
  type TermBatchPreview,
} from "../services/termBatch";
import {
  compareInstants,
  formatDateTime,
} from "../utils/time";
import { saveGeneratedFile } from "../utils/saveBlob";

type SortMode = "alphabetical" | "created_at" | "updated_at";

interface TermBatchActionOption {
  value: TermBatchOperation;
  label: string;
  permission: "update" | "delete";
}

const partOfSpeechOptions = [
  "全部词性",
  "名词",
  "动词",
  "形容词",
  "副词",
  "人名",
  "地名",
  "组织名",
  "专有名词",
  "短语",
  "其他",
];

const sortOptions: Array<{ value: SortMode; label: string }> = [
  { value: "alphabetical", label: "按字母顺序" },
  { value: "created_at", label: "按创建时间" },
  { value: "updated_at", label: "按更新时间" },
];
const termBatchActionOptions: TermBatchActionOption[] = [
  { value: "set_part_of_speech", label: "统一设置词性", permission: "update" },
  { value: "set_case_sensitive", label: "设为区分大小写", permission: "update" },
  { value: "clear_case_sensitive", label: "设为忽略大小写", permission: "update" },
  { value: "delete", label: "删除术语", permission: "delete" },
];

const terms = ref<Term[]>([]);
const searchText = ref("");
const partOfSpeechFilter = ref("全部词性");
const sortMode = ref<SortMode>("alphabetical");
const selectedTermIds = ref(new Set<string>());
const selectedBatchOperation = ref<TermBatchOperation>("set_part_of_speech");
const batchPartOfSpeech = ref("名词");
const batchPreview = ref<TermBatchPreview | null>(null);
const editingTerm = ref<Term>();
const isDialogOpen = ref(false);
const isImportDialogOpen = ref(false);
const isLoading = ref(false);
const isSaving = ref(false);
const isPreviewingBatch = ref(false);
const isExecutingBatch = ref(false);
const errorMessage = ref("");
const message = ref("");
const currentUser = ref(getCurrentUser());

const canCreate = computed(() => canCreateTerm(currentUser.value));
const canUpdate = computed(() => canUpdateTerm(currentUser.value));
const canDelete = computed(() => canDeleteTerm(currentUser.value));
const canImport = computed(() => canImportTerm(currentUser.value));
const canExport = computed(() => canExportTerm(currentUser.value));
const hasManagementActions = computed(
  () =>
    canCreate.value ||
    canUpdate.value ||
    canDelete.value ||
    canImport.value ||
    canExport.value,
);
const availableBatchActions = computed(() =>
  termBatchActionOptions.filter((option) =>
    option.permission === "update" ? canUpdate.value : canDelete.value,
  ),
);

const filteredTerms = computed(() => {
  const keyword = searchText.value.trim().toLowerCase();
  const filtered = terms.value.filter((term) => {
    if (
      partOfSpeechFilter.value !== "全部词性" &&
      term.part_of_speech !== partOfSpeechFilter.value
    ) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    const values = [
      term.source,
      term.target,
      term.part_of_speech,
      term.note,
      ...term.variants,
    ].map((value) => value.toLowerCase());

    return values.some((value) => value.includes(keyword));
  });

  return [...filtered].sort((a, b) => {
    if (sortMode.value === "created_at") {
      return compareInstants(b.created_at, a.created_at) || a.id.localeCompare(b.id);
    }

    if (sortMode.value === "updated_at") {
      return compareInstants(b.updated_at, a.updated_at) || a.id.localeCompare(b.id);
    }

    return (
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      a.id.localeCompare(b.id)
    );
  });
});
const selectedCount = computed(() => selectedTermIds.value.size);
const selectedFilteredCount = computed(() =>
  filteredTerms.value.reduce(
    (count, term) => count + (selectedTermIds.value.has(term.id) ? 1 : 0),
    0,
  ),
);
const hiddenSelectedCount = computed(
  () => selectedCount.value - selectedFilteredCount.value,
);
const selectedBatchLabel = computed(
  () =>
    termBatchActionOptions.find(
      (option) => option.value === selectedBatchOperation.value,
    )?.label ?? "术语批量操作",
);
const batchNeedsPartOfSpeech = computed(
  () => selectedBatchOperation.value === "set_part_of_speech",
);
const batchRequest = computed(() => ({
  termIds: Array.from(selectedTermIds.value),
  operation: selectedBatchOperation.value,
  actor: currentUser.value,
  value: batchNeedsPartOfSpeech.value ? batchPartOfSpeech.value : undefined,
}));

function getCurrentUserId(): string {
  return currentUser.value?.id ?? "unknown_user";
}

function replaceSelection(ids: Iterable<string>) {
  selectedTermIds.value = new Set(ids);
}

function toggleTerm(termId: string) {
  const nextIds = new Set(selectedTermIds.value);

  if (nextIds.has(termId)) {
    nextIds.delete(termId);
  } else {
    nextIds.add(termId);
  }

  replaceSelection(nextIds);
}

function selectAllFilteredTerms() {
  const nextIds = new Set(selectedTermIds.value);

  for (const term of filteredTerms.value) {
    nextIds.add(term.id);
  }

  replaceSelection(nextIds);
}

function clearTermSelection() {
  replaceSelection([]);
}

function closeBatchPreview() {
  if (!isExecutingBatch.value) {
    batchPreview.value = null;
  }
}

async function handlePreviewTermBatch() {
  if (selectedCount.value === 0) {
    return;
  }

  isPreviewingBatch.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    batchPreview.value = await previewTermBatch(batchRequest.value);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "术语批量操作预检失败。";
  } finally {
    isPreviewingBatch.value = false;
  }
}

async function handleExecuteTermBatch() {
  if (!batchPreview.value) {
    return;
  }

  isExecutingBatch.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const result = await executeTermBatch(batchRequest.value);

    message.value =
      `术语批量操作完成：处理 ${result.applicableTermIds.length} 条` +
      (result.skipped.length > 0
        ? `，跳过 ${result.skipped.length} 条。`
        : "。");
    batchPreview.value = null;
    clearTermSelection();
    terms.value = await loadTerms();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "术语批量操作执行失败。";
  } finally {
    isExecutingBatch.value = false;
  }
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

function openCreateDialog() {
  if (!canCreate.value) {
    return;
  }

  editingTerm.value = undefined;
  message.value = "";
  errorMessage.value = "";
  isDialogOpen.value = true;
}

function openEditDialog(term: Term) {
  if (!canUpdate.value) {
    return;
  }

  editingTerm.value = term;
  message.value = "";
  errorMessage.value = "";
  isDialogOpen.value = true;
}

function closeDialog() {
  if (!isSaving.value) {
    isDialogOpen.value = false;
  }
}

async function handleSaveTerm(input: TermInput) {
  if (editingTerm.value && !canUpdate.value) {
    return;
  }

  if (!editingTerm.value && !canCreate.value) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    if (editingTerm.value) {
      await updateTerm(editingTerm.value.id, input);
      message.value = "术语已更新。";
    } else {
      await addTerm(input, getCurrentUserId());
      message.value = "术语已创建。";
    }

    isDialogOpen.value = false;
    editingTerm.value = undefined;
    terms.value = await loadTerms();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "术语保存失败。";
  } finally {
    isSaving.value = false;
  }
}

async function handleDeleteTerm(term: Term) {
  if (!canDelete.value) {
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
    const nextIds = new Set(selectedTermIds.value);
    nextIds.delete(term.id);
    replaceSelection(nextIds);
    terms.value = await loadTerms();
    message.value = "术语已删除。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "术语删除失败。";
  } finally {
    isSaving.value = false;
  }
}

function triggerImport() {
  if (!canImport.value || isSaving.value) {
    return;
  }

  isImportDialogOpen.value = true;
}

function closeImportDialog() {
  if (!isSaving.value) {
    isImportDialogOpen.value = false;
  }
}

async function handleImportTerms(file: File) {
  if (!canImport.value) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const result = await importTermsFile(file, getCurrentUserId());

    terms.value = await loadTerms();
    message.value = `已导入 ${result.total} 条术语，新增 ${result.added} 条，更新 ${result.updated} 条。`;
    isImportDialogOpen.value = false;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "术语导入失败。";
  } finally {
    isSaving.value = false;
  }
}

async function handleExportTerms() {
  if (!canExport.value) {
    return;
  }

  errorMessage.value = "";
  message.value = "";

  try {
    const result = await exportTermsFile();
    const saved = await saveGeneratedFile(result.blob, result.fileName);

    message.value = saved.saved
      ? `术语文件已保存为 ${saved.fileName}。`
      : saved.reason;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "术语导出失败。";
  }
}

watch(
  availableBatchActions,
  (actions) => {
    if (
      actions.length > 0 &&
      !actions.some((action) => action.value === selectedBatchOperation.value)
    ) {
      selectedBatchOperation.value = actions[0].value;
    }
  },
  { immediate: true },
);

onMounted(loadTermRows);
</script>

<template>
  <section class="terms-page">
    <ProjectPageHeader
      eyebrow="术语表"
      title="术语"
      summary="维护项目术语，统一原文、译名和使用规则。"
    >
      <template #actions>
        <span class="count-badge">{{ filteredTerms.length }} / {{ terms.length }} 条</span>
      </template>
    </ProjectPageHeader>

    <section class="toolbar">
      <select v-model="partOfSpeechFilter" aria-label="词性筛选">
        <option v-for="option in partOfSpeechOptions" :key="option" :value="option">
          {{ option }}
        </option>
      </select>

      <select v-model="sortMode" aria-label="排序">
        <option v-for="option in sortOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>

      <input
        v-model="searchText"
        class="search-input"
        type="search"
        placeholder="输入术语或翻译进行搜索"
      />

      <div v-if="canImport || canExport || canCreate" class="toolbar-actions">
        <button
          v-if="canImport"
          class="secondary-button"
          type="button"
          :disabled="isSaving"
          @click="triggerImport"
        >
          导入术语
        </button>
        <button
          v-if="canExport"
          class="secondary-button"
          type="button"
          :disabled="isLoading"
          @click="handleExportTerms"
        >
          导出术语
        </button>
        <button
          v-if="canCreate"
          class="primary-button"
          type="button"
          :disabled="isSaving"
          @click="openCreateDialog"
        >
          创建术语
        </button>
      </div>
    </section>

    <BatchSelectionBar
      :selected-count="selectedCount"
      :hidden-selected-count="hiddenSelectedCount"
      :filtered-count="filteredTerms.length"
      :busy="isPreviewingBatch"
      :submit-disabled="
        availableBatchActions.length === 0 ||
        (batchNeedsPartOfSpeech && !batchPartOfSpeech.trim())
      "
      submit-label="预检并执行"
      :permission-message="
        availableBatchActions.length === 0
          ? '当前成员没有可用的术语批量操作权限。'
          : undefined
      "
      @select-all="selectAllFilteredTerms"
      @clear="clearTermSelection"
      @submit="handlePreviewTermBatch"
    >
      <select
        v-model="selectedBatchOperation"
        class="batch-operation-select"
        aria-label="术语批量操作"
      >
        <option
          v-for="action in availableBatchActions"
          :key="action.value"
          :value="action.value"
        >
          {{ action.label }}
        </option>
      </select>
      <select
        v-if="batchNeedsPartOfSpeech"
        v-model="batchPartOfSpeech"
        class="batch-value-select"
        aria-label="批量设置词性"
      >
        <option
          v-for="option in partOfSpeechOptions.slice(1)"
          :key="option"
          :value="option"
        >
          {{ option }}
        </option>
      </select>
    </BatchSelectionBar>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="message" class="message">{{ message }}</p>

    <p v-if="!hasManagementActions" class="readonly-note">
      当前用户只能查看术语。
    </p>

    <p v-if="isLoading" class="empty-state">正在加载术语...</p>

    <div v-else-if="filteredTerms.length > 0" class="term-list">
      <article
        v-for="term in filteredTerms"
        :key="term.id"
        class="term-card"
        :class="{ selected: selectedTermIds.has(term.id) }"
      >
        <label class="term-selector">
          <input
            type="checkbox"
            :checked="selectedTermIds.has(term.id)"
            :aria-label="`选择术语 ${term.source}`"
            @change="toggleTerm(term.id)"
          />
        </label>
        <div class="term-main">
          <div>
            <span class="field-label">原文</span>
            <strong>{{ term.source }}</strong>
          </div>
          <div>
            <span class="field-label">译文</span>
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
            <dd>{{ formatDateTime(term.updated_at) || "时间无效" }}</dd>
          </div>
          <div>
            <dt>匹配规则</dt>
            <dd>{{ term.case_sensitive ? "大小写敏感" : "忽略大小写" }}</dd>
          </div>
        </dl>

        <p v-if="term.note" class="term-note">{{ term.note }}</p>

        <div v-if="term.variants.length > 0" class="variant-list">
          <span v-for="variant in term.variants" :key="variant">
            {{ variant }}
          </span>
        </div>

        <div v-if="canUpdate || canDelete" class="card-actions">
          <button
            v-if="canUpdate"
            class="secondary-button"
            type="button"
            :disabled="isSaving"
            @click="openEditDialog(term)"
          >
            编辑
          </button>
          <button
            v-if="canDelete"
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
        v-if="canCreate && terms.length === 0"
        class="primary-button"
        type="button"
        @click="openCreateDialog"
      >
        创建第一条术语
      </button>
    </section>

    <TermEditDialog
      v-if="isDialogOpen"
      :term="editingTerm"
      :is-saving="isSaving"
      @cancel="closeDialog"
      @save="handleSaveTerm"
    />

    <TermImportDialog
      :open="isImportDialogOpen"
      :is-submitting="isSaving"
      @cancel="closeImportDialog"
      @submit="handleImportTerms"
    />

    <BatchPreviewDialog
      :open="batchPreview !== null"
      :title="selectedBatchLabel"
      item-unit="条"
      :selected-count="batchPreview?.selectedCount ?? 0"
      :applicable-count="batchPreview?.applicableTermIds.length ?? 0"
      :skipped-reason-counts="batchPreview?.skippedReasonCounts ?? []"
      :is-executing="isExecutingBatch"
      :danger="selectedBatchOperation === 'delete'"
      note="执行时会重新读取术语表并再次校验；不存在、无变化或权限不符的术语不会被写入。"
      @cancel="closeBatchPreview"
      @confirm="handleExecuteTermBatch"
    />
  </section>
</template>

<style scoped>
.terms-page {
  display: grid;
  gap: 16px;
}

.field-label,
dt,
.readonly-note {
  color: #5b6472;
}

p,
dl,
dd {
  margin: 0;
}

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
.term-card,
.empty-state,
.readonly-note {
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.toolbar {
  display: grid;
  grid-template-columns: 150px 150px minmax(220px, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 12px;
}

.batch-operation-select,
.batch-value-select {
  width: auto;
  min-width: 150px;
}

.toolbar-actions,
.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-actions {
  justify-content: flex-end;
}

select,
input {
  width: 100%;
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  font-size: 14px;
}

select:focus,
input:focus {
  outline: none;
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

.primary-button,
.secondary-button,
.danger-button {
  min-height: 38px;
  padding: 0 12px;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.primary-button {
  border: 1px solid #2f6f73;
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

.danger-button {
  border: 1px solid #f0b8aa;
  background: #ffffff;
  color: #b42318;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
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

.empty-state,
.readonly-note {
  padding: 16px;
  color: #4b5563;
}

.empty-state {
  display: grid;
  gap: 10px;
}

.empty-state button {
  justify-self: start;
}

.term-list {
  display: grid;
  gap: 12px;
}

.term-card {
  position: relative;
  display: grid;
  gap: 12px;
  padding: 16px 16px 16px 50px;
}

.term-card.selected {
  border-color: #2f6f73;
  background: #f0f8f6;
}

.term-selector {
  position: absolute;
  top: 18px;
  left: 16px;
}

.term-selector input {
  width: 18px;
  min-height: 18px;
  margin: 0;
  padding: 0;
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

.field-label,
dt {
  font-size: 13px;
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
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

@media (max-width: 980px) {
  .toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .search-input,
  .toolbar-actions {
    grid-column: 1 / -1;
  }

  .toolbar-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 760px) {
  .term-main,
  .term-meta {
    grid-template-columns: 1fr;
  }

  .toolbar {
    grid-template-columns: 1fr;
  }

  .search-input,
  .toolbar-actions {
    grid-column: auto;
  }
}
</style>
