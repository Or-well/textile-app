<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import FileImportDialog from "../components/FileImportDialog.vue";
import FileListItem from "../components/FileListItem.vue";
import FileToolbar from "../components/FileToolbar.vue";
import type { Member, ProjectConfig, ProjectFile } from "../model/types";
import { PERMISSION_ACTIONS } from "../model/permissions";
import { loadEntries } from "../services/entries";
import {
  addSourceFileToProject,
  deleteProjectFile,
  importTranslationFileToProject,
  updateProjectFile,
  updateSourceFileInProject,
} from "../services/project";
import type { ProjectDirectoryHandle } from "../services/projectFs";
import {
  can,
  canCreateFile,
  canDeleteFile,
  canHideFile,
  canImportFileTranslation,
  canLockFile,
  canManageFileFolder,
  canRenameFile,
  canUpdateFile,
} from "../services/permissions";
import { calculateEntryProgress } from "../services/stats";

type SortKey = "name" | "updated" | "translated" | "proofread" | "reviewed";
type FileFilter = "visible" | "all" | "hidden" | "locked" | "disputed";
type DialogMode = "add" | "batch-add" | "update" | "import-translation" | "batch-import";

interface FileSummary {
  file: ProjectFile;
  totalEntries: number;
  untranslatedEntries: number;
  disputedEntries: number;
  translatedPercent: number;
  proofreadPercent: number;
  reviewedPercent: number;
  updatedAt: string;
}

interface BatchFailure {
  name: string;
  reason: string;
}

const props = defineProps<{
  project: ProjectConfig;
  projectRoot: ProjectDirectoryHandle;
  currentUser: Member | null;
}>();

const emit = defineEmits<{
  openFile: [fileId: string];
  projectUpdated: [config: ProjectConfig];
}>();

const currentProject = ref<ProjectConfig>(props.project);
const fileSummaries = ref<FileSummary[]>([]);
const searchText = ref("");
const sortKey = ref<SortKey>("name");
const fileFilter = ref<FileFilter>("visible");
const isLoading = ref(false);
const isSubmitting = ref(false);
const errorMessage = ref("");
const noticeMessage = ref("");
const dialogMode = ref<DialogMode | null>(null);
const activeFileId = ref("");
const pendingFolder = ref("");
const batchSuccessCount = ref(0);
const batchFailures = ref<BatchFailure[]>([]);

const canViewFiles = computed(() => can(props.currentUser, PERMISSION_ACTIONS.FILE_VIEW));
const canCreate = computed(() => canCreateFile(props.currentUser));
const canUpdate = computed(() => canUpdateFile(props.currentUser));
const canImportTranslation = computed(() =>
  canImportFileTranslation(props.currentUser),
);
const canRename = computed(() => canRenameFile(props.currentUser));
const canLock = computed(() => canLockFile(props.currentUser));
const canHide = computed(() => canHideFile(props.currentUser));
const canDelete = computed(() => canDeleteFile(props.currentUser));
const canManageFolder = computed(() => canManageFileFolder(props.currentUser));

const visibleFiles = computed(() => {
  const keyword = searchText.value.trim().toLowerCase();
  const files = fileSummaries.value.filter((summary) => {
    if (fileFilter.value === "visible" && summary.file.hidden) {
      return false;
    }

    if (fileFilter.value === "hidden" && !summary.file.hidden) {
      return false;
    }

    if (fileFilter.value === "locked" && !summary.file.locked) {
      return false;
    }

    if (fileFilter.value === "disputed" && summary.disputedEntries === 0) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    return (
      summary.file.name.toLowerCase().includes(keyword) ||
      summary.file.id.toLowerCase().includes(keyword) ||
      (summary.file.folder ?? "").toLowerCase().includes(keyword)
    );
  });

  return [...files].sort((a, b) => {
    if (sortKey.value === "updated") {
      return b.updatedAt.localeCompare(a.updatedAt);
    }

    if (sortKey.value === "translated") {
      return b.translatedPercent - a.translatedPercent;
    }

    if (sortKey.value === "proofread") {
      return b.proofreadPercent - a.proofreadPercent;
    }

    if (sortKey.value === "reviewed") {
      return b.reviewedPercent - a.reviewedPercent;
    }

    return a.file.name.localeCompare(b.file.name);
  });
});

const dialogTitle = computed(() => {
  if (dialogMode.value === "batch-add") {
    return "批量添加源文件";
  }

  if (dialogMode.value === "update") {
    return "更新源文件";
  }

  if (dialogMode.value === "import-translation") {
    return "导入译文";
  }

  if (dialogMode.value === "batch-import") {
    return "批量导入译文";
  }

  return "添加源文件";
});

const dialogDescription = computed(() => {
  if (dialogMode.value === "update") {
    return "按 key / index 尽量保留已有译文。";
  }

  if (dialogMode.value === "import-translation") {
    return "按 key / index 匹配并更新当前文件译文。";
  }

  if (dialogMode.value === "batch-import") {
    return "按文件名匹配项目文件，再按 key / index 更新译文。";
  }

  return "添加后会生成文件记录和 entries 词条数据。";
});

const dialogMultiple = computed(
  () => dialogMode.value === "batch-add" || dialogMode.value === "batch-import",
);

function latestUpdatedAt(entries: { updated_at: string }[], file: ProjectFile): string {
  const latest = entries
    .map((entry) => entry.updated_at)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0];

  return latest || file.updated_at || "暂无记录";
}

function setProject(config: ProjectConfig) {
  currentProject.value = config;
  emit("projectUpdated", config);
}

function resetBatchResult() {
  batchSuccessCount.value = 0;
  batchFailures.value = [];
}

async function loadFileSummaries() {
  if (!canViewFiles.value) {
    fileSummaries.value = [];
    errorMessage.value = "当前用户没有查看文件的权限。";
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    const summaries = await Promise.all(
      currentProject.value.files.map(async (file) => {
        const entries = await loadEntries(file.id);
        const visibleEntries = entries.map((entry) => ({
          ...entry,
          locked: entry.locked || file.locked,
          hidden: entry.hidden || file.hidden,
        }));
        const progress = calculateEntryProgress(
          visibleEntries,
          currentProject.value.settings.progress_weights,
          currentProject.value.settings.workflow,
        );

        return {
          file,
          totalEntries: progress.totalEntries,
          untranslatedEntries: progress.untranslatedEntries,
          disputedEntries: progress.disputedEntries,
          translatedPercent: progress.translationProgress,
          proofreadPercent: progress.proofreadProgress,
          reviewedPercent: progress.reviewProgress,
          updatedAt: latestUpdatedAt(entries, file),
        };
      }),
    );

    fileSummaries.value = summaries;
  } catch (error) {
    fileSummaries.value = [];
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "文件列表加载失败。请确认项目数据可以读取。";
  } finally {
    isLoading.value = false;
  }
}

function openDialog(mode: DialogMode, fileId = "") {
  dialogMode.value = mode;
  activeFileId.value = fileId;
  errorMessage.value = "";
  noticeMessage.value = "";
  resetBatchResult();
}

function closeDialog() {
  dialogMode.value = null;
  activeFileId.value = "";
  pendingFolder.value = "";
}

async function handleDialogSubmit(files: File[]) {
  if (!dialogMode.value) {
    return;
  }

  isSubmitting.value = true;
  errorMessage.value = "";
  noticeMessage.value = "";
  resetBatchResult();

  try {
    if (dialogMode.value === "add" || dialogMode.value === "batch-add") {
      await handleAddSources(files);
    } else if (dialogMode.value === "update") {
      await handleUpdateSource(files[0]);
    } else if (dialogMode.value === "import-translation") {
      await handleImportTranslation(files[0]);
    } else {
      await handleBatchImportTranslations(files);
    }

    closeDialog();
    await loadFileSummaries();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "文件处理失败，请稍后再试。";
  } finally {
    isSubmitting.value = false;
  }
}

async function handleAddSources(files: File[]) {
  let nextConfig = currentProject.value;

  for (const file of files) {
    try {
      const result = await addSourceFileToProject(
        props.projectRoot,
        nextConfig,
        file,
        pendingFolder.value,
        props.currentUser,
      );
      nextConfig = result.config;
      batchSuccessCount.value += 1;
    } catch (error) {
      batchFailures.value.push({
        name: file.name,
        reason: error instanceof Error ? error.message : "导入失败。",
      });
    }
  }

  setProject(nextConfig);
  noticeMessage.value = `添加完成：成功 ${batchSuccessCount.value} 个，失败 ${batchFailures.value.length} 个。`;
}

async function handleUpdateSource(file?: File) {
  if (!file || !activeFileId.value) {
    throw new Error("请选择要更新的源文件。");
  }

  const result = await updateSourceFileInProject(
    props.projectRoot,
    currentProject.value,
    activeFileId.value,
    file,
    props.currentUser,
  );

  setProject(result.config);
  noticeMessage.value = `源文件已更新，当前 ${result.entryCount} 条词条。`;
}

async function handleImportTranslation(file?: File) {
  if (!file || !activeFileId.value) {
    throw new Error("请选择要导入的译文文件。");
  }

  const result = await importTranslationFileToProject(
    props.projectRoot,
    currentProject.value,
    activeFileId.value,
    file,
    props.currentUser,
  );

  setProject(result.config);
  noticeMessage.value = `译文导入完成：更新 ${result.matched} 条，跳过 ${result.skipped} 条。`;
}

async function handleBatchImportTranslations(files: File[]) {
  let nextConfig = currentProject.value;

  for (const file of files) {
    const projectFile = nextConfig.files.find(
      (item) => item.name === file.name || item.name.replace(/\.[^.]+$/, "") === file.name.replace(/\.[^.]+$/, ""),
    );

    if (!projectFile) {
      batchFailures.value.push({
        name: file.name,
        reason: "没有找到同名项目文件。",
      });
      continue;
    }

    try {
      const result = await importTranslationFileToProject(
        props.projectRoot,
        nextConfig,
        projectFile.id,
        file,
        props.currentUser,
      );
      nextConfig = result.config;
      batchSuccessCount.value += 1;
    } catch (error) {
      batchFailures.value.push({
        name: file.name,
        reason: error instanceof Error ? error.message : "导入失败。",
      });
    }
  }

  setProject(nextConfig);
  noticeMessage.value = `批量导入完成：成功 ${batchSuccessCount.value} 个，失败 ${batchFailures.value.length} 个。`;
}

async function handleRename(fileId: string) {
  const file = currentProject.value.files.find((item) => item.id === fileId);
  const nextName = window.prompt("请输入新的文件显示名。", file?.name ?? "");

  if (!nextName) {
    return;
  }

  setProject(
    await updateProjectFile(props.projectRoot, currentProject.value, fileId, {
      name: nextName,
    }, props.currentUser),
  );
  noticeMessage.value = "文件已重命名。";
  await loadFileSummaries();
}

async function handleCreateFolder() {
  const folder = window.prompt("请输入文件夹 / 分组名称。");

  if (!folder) {
    return;
  }

  pendingFolder.value = folder.trim();
  openDialog("batch-add");
  noticeMessage.value = `将添加文件到“${pendingFolder.value}”分组。`;
}

async function handleToggleHidden(fileId: string) {
  const file = currentProject.value.files.find((item) => item.id === fileId);

  if (!file) {
    return;
  }

  setProject(
    await updateProjectFile(props.projectRoot, currentProject.value, fileId, {
      hidden: !file.hidden,
    }, props.currentUser),
  );
  noticeMessage.value = file.hidden ? "文件已取消隐藏。" : "文件已隐藏。";
  await loadFileSummaries();
}

async function handleToggleLocked(fileId: string) {
  const file = currentProject.value.files.find((item) => item.id === fileId);

  if (!file) {
    return;
  }

  setProject(
    await updateProjectFile(props.projectRoot, currentProject.value, fileId, {
      locked: !file.locked,
    }, props.currentUser),
  );
  noticeMessage.value = file.locked ? "文件已解锁。" : "文件已锁定。";
  await loadFileSummaries();
}

async function handleDelete(fileId: string) {
  const file = currentProject.value.files.find((item) => item.id === fileId);

  if (!file) {
    return;
  }

  const confirmed = window.confirm(
    `确定删除“${file.name}”？这会删除文件记录、源文件和词条数据。`,
  );

  if (!confirmed) {
    return;
  }

  errorMessage.value = "";
  noticeMessage.value = "";

  try {
    setProject(await deleteProjectFile(props.projectRoot, currentProject.value, fileId, props.currentUser));
    noticeMessage.value = "文件已删除。";
    await loadFileSummaries();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "删除文件失败。请稍后再试。";
  }
}

function handleHistory() {
  noticeMessage.value = "查看历史需要历史日志视图，本页当前只提供入口。";
}

watch(
  () => props.project,
  (project) => {
    currentProject.value = project;
    void loadFileSummaries();
  },
);

onMounted(loadFileSummaries);
</script>

<template>
  <section class="files-page">
    <div class="page-title">
      <div>
        <p class="eyebrow">项目文件</p>
        <h1>文件</h1>
      </div>
      <span class="file-count">{{ visibleFiles.length }} 个文件</span>
    </div>

    <FileToolbar
      :search-text="searchText"
      :sort-key="sortKey"
      :status-filter="fileFilter"
      :can-create="canCreate"
      :can-manage-folder="canManageFolder"
      @add-source="openDialog('add')"
      @batch-add-source="openDialog('batch-add')"
      @batch-import-translation="openDialog('batch-import')"
      @create-folder="handleCreateFolder"
      @update-search-text="searchText = $event"
      @update-sort-key="sortKey = $event as SortKey"
      @update-status-filter="fileFilter = $event as FileFilter"
    />

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="noticeMessage" class="notice-message">{{ noticeMessage }}</p>

    <section v-if="batchFailures.length" class="batch-result">
      <strong>失败原因</strong>
      <ul>
        <li v-for="failure in batchFailures" :key="failure.name">
          {{ failure.name }}：{{ failure.reason }}
        </li>
      </ul>
    </section>

    <p v-if="isLoading" class="empty-state">正在加载文件列表...</p>

    <section
      v-else-if="currentProject.files.length === 0"
      class="empty-project-state"
    >
      <h2>暂无文件</h2>
      <p>你可以添加源文件开始翻译。</p>
      <div>
        <button
          class="primary-button"
          type="button"
          :disabled="!canCreate"
          @click="openDialog('add')"
        >
          添加源文件
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="!canCreate"
          @click="openDialog('batch-add')"
        >
          批量添加
        </button>
      </div>
    </section>

    <div v-else-if="visibleFiles.length > 0" class="file-list">
      <FileListItem
        v-for="summary in visibleFiles"
        :key="summary.file.id"
        :file="summary.file"
        :total-entries="summary.totalEntries"
        :translated-percent="summary.translatedPercent"
        :proofread-percent="summary.proofreadPercent"
        :reviewed-percent="summary.reviewedPercent"
        :disputed-entries="summary.disputedEntries"
        :updated-at="summary.updatedAt"
        :can-update="canUpdate"
        :can-import-translation="canImportTranslation"
        :can-rename="canRename"
        :can-lock="canLock"
        :can-hide="canHide"
        :can-delete="canDelete"
        @open="emit('openFile', $event)"
        @update-source="openDialog('update', $event)"
        @import-translation="openDialog('import-translation', $event)"
        @rename="handleRename"
        @toggle-hidden="handleToggleHidden"
        @toggle-locked="handleToggleLocked"
        @delete="handleDelete"
        @history="handleHistory"
      />
    </div>

    <p v-else class="empty-state">没有符合筛选条件的文件。</p>

    <FileImportDialog
      :open="dialogMode !== null"
      :title="dialogTitle"
      :description="dialogDescription"
      :multiple="dialogMultiple"
      accept=".txt,.ks,.jsonl,.json,.csv,text/plain,text/csv,application/json"
      confirm-label="开始处理"
      :is-submitting="isSubmitting"
      @cancel="closeDialog"
      @submit="handleDialogSubmit"
    />
  </section>
</template>

<style scoped>
.files-page {
  display: grid;
  gap: 16px;
}

.page-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #5b6472;
  font-size: 14px;
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  color: #111827;
  font-size: 28px;
  line-height: 1.2;
}

h2 {
  color: #111827;
  font-size: 22px;
}

.file-count {
  padding: 5px 10px;
  border-radius: 999px;
  background: #e6f0ef;
  color: #174346;
  font-size: 13px;
  font-weight: 700;
}

.error-message,
.notice-message {
  line-height: 1.7;
}

.error-message {
  color: #b42318;
}

.notice-message {
  color: #166534;
}

.batch-result,
.empty-state,
.empty-project-state {
  padding: 18px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #4b5563;
}

.batch-result {
  display: grid;
  gap: 8px;
  border-color: #f0b96a;
  background: #fffaf0;
}

.batch-result ul {
  margin: 0;
  padding-left: 20px;
  line-height: 1.7;
}

.empty-project-state {
  display: grid;
  gap: 12px;
  justify-items: start;
}

.empty-project-state div {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.file-list {
  display: grid;
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
