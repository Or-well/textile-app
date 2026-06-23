<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import BatchPreviewDialog from "../components/BatchPreviewDialog.vue";
import BatchSelectionBar from "../components/BatchSelectionBar.vue";
import FileGroupDialog from "../components/FileGroupDialog.vue";
import FileGroupSection from "../components/FileGroupSection.vue";
import FileHistoryDialog from "../components/FileHistoryDialog.vue";
import FileImportDialog from "../components/FileImportDialog.vue";
import FileListItem from "../components/FileListItem.vue";
import FileToolbar from "../components/FileToolbar.vue";
import ProjectPageHeader from "../components/ProjectPageHeader.vue";
import type { Member, ProjectConfig, ProjectFile } from "../model/types";
import { PERMISSION_ACTIONS } from "../model/permissions";
import { loadEntries } from "../services/entries";
import {
  exportEntryExchangeFile,
  type EntryExchangeFormat,
} from "../services/entryExchange";
import {
  executeFileBatch,
  previewFileBatch,
  type FileBatchOperation,
  type FileBatchPreview,
} from "../services/fileBatch";
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
import {
  getFileHistory,
  type FileHistoryRow,
} from "../services/history";
import { calculateEntryProgress } from "../services/stats";
import {
  compareInstants,
  formatDateTime,
} from "../utils/time";
import {
  fileMatchesGroupFilter,
  listFileGroups,
  normalizeFileGroupName,
  UNGROUPED_FILE_FILTER,
} from "../utils/fileGroups";
import { saveGeneratedFile } from "../utils/saveBlob";

type SortKey = "name" | "updated" | "translated" | "proofread" | "reviewed";
type FileFilter = "visible" | "all" | "hidden" | "locked" | "disputed";
type DialogMode = "add" | "batch-add" | "update" | "import-translation" | "batch-import";
type GroupDialogMode = "add-files" | "move-file" | "rename-group";

interface FileSummary {
  file: ProjectFile;
  totalEntries: number;
  untranslatedEntries: number;
  disputedEntries: number;
  translatedPercent: number;
  proofreadPercent: number;
  reviewedPercent: number;
  updatedAt: string;
  updatedAtValue: string;
}

interface BatchFailure {
  name: string;
  reason: string;
}

interface VisibleFileGroup {
  key: string;
  name: string;
  ungrouped: boolean;
  files: FileSummary[];
}

interface FileBatchActionOption {
  value: FileBatchOperation;
  label: string;
  permission: "hide" | "lock" | "folder" | "delete";
}

const fileBatchActionOptions: FileBatchActionOption[] = [
  { value: "hide", label: "隐藏文件", permission: "hide" },
  { value: "unhide", label: "取消隐藏", permission: "hide" },
  { value: "lock", label: "锁定文件", permission: "lock" },
  { value: "unlock", label: "解锁文件", permission: "lock" },
  { value: "move_folder", label: "移动到分组", permission: "folder" },
  { value: "clear_folder", label: "清除分组", permission: "folder" },
  { value: "delete", label: "删除文件", permission: "delete" },
];

const props = defineProps<{
  project: ProjectConfig;
  projectRoot: ProjectDirectoryHandle;
  currentUser: Member | null;
  lastViewedFileId?: string;
}>();

const emit = defineEmits<{
  openFile: [fileId: string];
  manageEntries: [fileId?: string];
  projectUpdated: [config: ProjectConfig];
}>();

const currentProject = ref<ProjectConfig>(props.project);
const fileSummaries = ref<FileSummary[]>([]);
const searchText = ref("");
const sortKey = ref<SortKey>("name");
const fileFilter = ref<FileFilter>("visible");
const groupFilter = ref("");
const collapsedGroupKeys = ref(new Set<string>());
const selectedFileIds = ref(new Set<string>());
const selectedBatchOperation = ref<FileBatchOperation>("hide");
const batchFolder = ref("");
const managementBatchPreview = ref<FileBatchPreview | null>(null);
const isLoading = ref(false);
const isSubmitting = ref(false);
const isExportingExchange = ref(false);
const isPreviewingBatch = ref(false);
const isExecutingBatch = ref(false);
const errorMessage = ref("");
const noticeMessage = ref("");
const fileListElement = ref<HTMLElement | null>(null);
const lastAutoScrolledFileId = ref("");
const dialogMode = ref<DialogMode | null>(null);
const activeFileId = ref("");
const pendingFolder = ref("");
const batchSuccessCount = ref(0);
const batchFailures = ref<BatchFailure[]>([]);
const historyDialogOpen = ref(false);
const historyFileName = ref("");
const historyRows = ref<FileHistoryRow[]>([]);
const isLoadingHistory = ref(false);
const historyErrorMessage = ref("");
const groupDialogMode = ref<GroupDialogMode | null>(null);
const groupDialogFileId = ref("");
const groupDialogSourceName = ref("");
const isSubmittingGroup = ref(false);

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
const canExportExchange = computed(() =>
  can(props.currentUser, PERMISSION_ACTIONS.FILE_VIEW, currentProject.value),
);
const availableBatchActions = computed(() =>
  fileBatchActionOptions.filter((option) => {
    if (option.permission === "hide") {
      return canHide.value;
    }

    if (option.permission === "lock") {
      return canLock.value;
    }

    if (option.permission === "folder") {
      return canManageFolder.value;
    }

    return canDelete.value;
  }),
);
const fileGroups = computed(() => listFileGroups(currentProject.value.files));
const groupSuggestions = computed(() =>
  fileGroups.value.map((group) => group.name),
);

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

    if (!fileMatchesGroupFilter(summary.file, groupFilter.value)) {
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
      return (
        compareInstants(b.updatedAtValue, a.updatedAtValue) ||
        a.file.id.localeCompare(b.file.id)
      );
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
const visibleFileGroups = computed<VisibleFileGroup[]>(() => {
  const groups = new Map<string, FileSummary[]>();

  for (const summary of visibleFiles.value) {
    const name = normalizeFileGroupName(summary.file.folder);
    const key = name || UNGROUPED_FILE_FILTER;
    const files = groups.get(key) ?? [];

    files.push(summary);
    groups.set(key, files);
  }

  return Array.from(groups, ([key, files]) => ({
    key,
    name: key === UNGROUPED_FILE_FILTER ? "" : key,
    ungrouped: key === UNGROUPED_FILE_FILTER,
    files,
  })).sort((left, right) => {
    if (left.ungrouped !== right.ungrouped) {
      return left.ungrouped ? 1 : -1;
    }

    return left.name.localeCompare(right.name);
  });
});
const selectedCount = computed(() => selectedFileIds.value.size);
const selectedFilteredCount = computed(() =>
  visibleFiles.value.reduce(
    (count, summary) =>
      count + (selectedFileIds.value.has(summary.file.id) ? 1 : 0),
    0,
  ),
);
const hiddenSelectedCount = computed(
  () => selectedCount.value - selectedFilteredCount.value,
);
const selectedBatchLabel = computed(
  () =>
    fileBatchActionOptions.find(
      (option) => option.value === selectedBatchOperation.value,
    )?.label ?? "文件批量操作",
);
const batchNeedsFolder = computed(
  () => selectedBatchOperation.value === "move_folder",
);
const batchRequest = computed(() => ({
  fileIds: Array.from(selectedFileIds.value),
  operation: selectedBatchOperation.value,
  actor: props.currentUser,
  project: currentProject.value,
  folder: batchNeedsFolder.value ? batchFolder.value : undefined,
}));
const batchAffectedDetail = computed(() => {
  const entryCount = managementBatchPreview.value?.affectedEntryCount ?? 0;

  return selectedBatchOperation.value === "delete"
    ? `将同时删除这些文件下的 ${entryCount} 条词条数据；批注、任务和历史记录沿用现有文件删除规则。`
    : `所选文件共包含 ${entryCount} 条词条；本次操作不会改写词条正文。`;
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
const groupDialogTitle = computed(() => {
  if (groupDialogMode.value === "add-files") {
    return "按分组添加文件";
  }

  if (groupDialogMode.value === "rename-group") {
    return "重命名分组";
  }

  return "调整文件分组";
});
const groupDialogDescription = computed(() => {
  if (groupDialogMode.value === "add-files") {
    return "选择已有分组或输入新名称，随后添加的文件都会进入该分组。";
  }

  if (groupDialogMode.value === "rename-group") {
    return `分组“${groupDialogSourceName.value}”中的全部文件将移动到新的分组名称。`;
  }

  return "选择已有分组或输入新名称；也可以将当前文件移出分组。";
});
const groupDialogInitialValue = computed(() => {
  if (groupDialogMode.value === "rename-group") {
    return groupDialogSourceName.value;
  }

  if (groupDialogMode.value === "move-file") {
    const file = currentProject.value.files.find(
      (item) => item.id === groupDialogFileId.value,
    );

    return normalizeFileGroupName(file?.folder);
  }

  return "";
});

function latestUpdatedAt(entries: { updated_at: string }[], file: ProjectFile): string {
  const latest = entries
    .map((entry) => entry.updated_at)
    .filter(Boolean)
    .sort((a, b) => compareInstants(b, a))[0];

  return latest || file.updated_at || "";
}

function setProject(config: ProjectConfig) {
  currentProject.value = config;
  emit("projectUpdated", config);
}

function replaceSelection(ids: Iterable<string>) {
  selectedFileIds.value = new Set(ids);
}

function toggleFileSelection(fileId: string) {
  const nextIds = new Set(selectedFileIds.value);

  if (nextIds.has(fileId)) {
    nextIds.delete(fileId);
  } else {
    nextIds.add(fileId);
  }

  replaceSelection(nextIds);
}

function selectAllFilteredFiles() {
  const nextIds = new Set(selectedFileIds.value);

  for (const summary of visibleFiles.value) {
    nextIds.add(summary.file.id);
  }

  replaceSelection(nextIds);
}

function clearFileSelection() {
  replaceSelection([]);
}

function toggleGroup(groupKey: string) {
  const nextKeys = new Set(collapsedGroupKeys.value);

  if (nextKeys.has(groupKey)) {
    nextKeys.delete(groupKey);
  } else {
    nextKeys.add(groupKey);
  }

  collapsedGroupKeys.value = nextKeys;
}

function openGroupDialog(
  mode: GroupDialogMode,
  options: { fileId?: string; sourceName?: string } = {},
) {
  groupDialogMode.value = mode;
  groupDialogFileId.value = options.fileId ?? "";
  groupDialogSourceName.value = options.sourceName ?? "";
  errorMessage.value = "";
  noticeMessage.value = "";
}

function closeGroupDialog() {
  if (isSubmittingGroup.value) {
    return;
  }

  groupDialogMode.value = null;
  groupDialogFileId.value = "";
  groupDialogSourceName.value = "";
}

async function executeGroupChange(fileIds: string[], folder: string) {
  const result = await executeFileBatch(props.projectRoot, {
    fileIds,
    operation: folder ? "move_folder" : "clear_folder",
    actor: props.currentUser,
    project: currentProject.value,
    folder: folder || undefined,
  });

  setProject(result.project);
  await loadFileSummaries();

  return result;
}

async function handleGroupDialogConfirm(value: string) {
  const mode = groupDialogMode.value;

  if (!mode) {
    return;
  }

  const folder = value.trim();

  if (mode === "add-files") {
    if (!folder) {
      return;
    }

    pendingFolder.value = folder;
    closeGroupDialog();
    openDialog("batch-add");
    noticeMessage.value = `将添加文件到“${folder}”分组。`;
    return;
  }

  if (
    mode === "rename-group" &&
    (!folder || folder === groupDialogSourceName.value)
  ) {
    closeGroupDialog();
    return;
  }

  isSubmittingGroup.value = true;
  errorMessage.value = "";
  noticeMessage.value = "";

  try {
    if (mode === "move-file") {
      const result = await executeGroupChange(
        [groupDialogFileId.value],
        folder,
      );

      noticeMessage.value =
        result.applicableFileIds.length > 0
          ? folder
            ? `文件已移动到“${folder}”分组。`
            : "文件已移出分组。"
          : "文件分组没有变化。";
    } else {
      const sourceName = groupDialogSourceName.value;
      const fileIds = currentProject.value.files
        .filter(
          (file) => normalizeFileGroupName(file.folder) === sourceName,
        )
        .map((file) => file.id);
      const result = await executeGroupChange(fileIds, folder);

      noticeMessage.value = `分组“${sourceName}”已重命名为“${folder}”，移动 ${result.applicableFileIds.length} 个文件。`;
    }

    groupDialogMode.value = null;
    groupDialogFileId.value = "";
    groupDialogSourceName.value = "";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "调整文件分组失败。";
  } finally {
    isSubmittingGroup.value = false;
  }
}

async function handleClearGroup(groupName: string) {
  const fileIds = currentProject.value.files
    .filter((file) => normalizeFileGroupName(file.folder) === groupName)
    .map((file) => file.id);

  if (
    fileIds.length === 0 ||
    !window.confirm(
      `确定将“${groupName}”中的 ${fileIds.length} 个文件全部移出分组？文件本身不会被删除。`,
    )
  ) {
    return;
  }

  isSubmittingGroup.value = true;
  errorMessage.value = "";
  noticeMessage.value = "";

  try {
    const result = await executeGroupChange(fileIds, "");
    noticeMessage.value = `已将 ${result.applicableFileIds.length} 个文件移出“${groupName}”分组。`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "清空文件分组失败。";
  } finally {
    isSubmittingGroup.value = false;
  }
}

function closeManagementBatchPreview() {
  if (!isExecutingBatch.value) {
    managementBatchPreview.value = null;
  }
}

async function handlePreviewFileBatch() {
  if (selectedCount.value === 0) {
    return;
  }

  isPreviewingBatch.value = true;
  errorMessage.value = "";
  noticeMessage.value = "";

  try {
    managementBatchPreview.value = await previewFileBatch(
      props.projectRoot,
      batchRequest.value,
    );
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "文件批量操作预检失败。";
  } finally {
    isPreviewingBatch.value = false;
  }
}

async function handleExecuteFileBatch() {
  if (!managementBatchPreview.value) {
    return;
  }

  isExecutingBatch.value = true;
  errorMessage.value = "";
  noticeMessage.value = "";

  try {
    const result = await executeFileBatch(
      props.projectRoot,
      batchRequest.value,
    );

    setProject(result.project);
    noticeMessage.value =
      `文件批量操作完成：处理 ${result.applicableFileIds.length} 个` +
      (result.skipped.length > 0
        ? `，跳过 ${result.skipped.length} 个。`
        : "。");
    managementBatchPreview.value = null;
    clearFileSelection();
    await loadFileSummaries();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "文件批量操作执行失败。";
  } finally {
    isExecutingBatch.value = false;
  }
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

        const updatedAtValue = latestUpdatedAt(entries, file);

        return {
          file,
          totalEntries: progress.totalEntries,
          untranslatedEntries: progress.untranslatedEntries,
          disputedEntries: progress.disputedEntries,
          translatedPercent: progress.translationProgress,
          proofreadPercent: progress.proofreadProgress,
          reviewedPercent: progress.reviewProgress,
          updatedAt: updatedAtValue
            ? formatDateTime(updatedAtValue) || "时间无效"
            : "暂无记录",
          updatedAtValue,
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

async function handleExportExchange(
  fileId: string,
  format: EntryExchangeFormat,
) {
  isExportingExchange.value = true;
  errorMessage.value = "";
  noticeMessage.value = "";

  try {
    const result = await exportEntryExchangeFile(
      currentProject.value,
      fileId,
      format,
      props.currentUser,
    );
    const saved = await saveGeneratedFile(result.blob, result.fileName);

    noticeMessage.value = saved.saved
      ? `已保存词条交换文件：${saved.fileName}（${result.entryCount} 条）。`
      : saved.reason;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导出词条交换文件失败。";
  } finally {
    isExportingExchange.value = false;
  }
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
    const nextIds = new Set(selectedFileIds.value);
    nextIds.delete(fileId);
    replaceSelection(nextIds);
    noticeMessage.value = "文件已删除。";
    await loadFileSummaries();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "删除文件失败。请稍后再试。";
  }
}

async function handleHistory(fileId: string) {
  const file = currentProject.value.files.find((item) => item.id === fileId);

  historyDialogOpen.value = true;
  historyFileName.value = file?.name ?? fileId;
  historyRows.value = [];
  historyErrorMessage.value = "";
  isLoadingHistory.value = true;

  try {
    historyRows.value = await getFileHistory(fileId);
  } catch (error) {
    historyErrorMessage.value =
      error instanceof Error ? error.message : "文件历史加载失败。";
  } finally {
    isLoadingHistory.value = false;
  }
}

async function scrollToLastViewedFile() {
  const fileId = props.lastViewedFileId ?? "";

  if (
    !fileId ||
    isLoading.value ||
    lastAutoScrolledFileId.value === fileId ||
    typeof window === "undefined"
  ) {
    return;
  }

  const fileIndex = visibleFiles.value.findIndex(
    (summary) => summary.file.id === fileId,
  );

  if (fileIndex < 0) {
    return;
  }

  const targetFile = visibleFiles.value[fileIndex]?.file;
  const targetGroupKey =
    normalizeFileGroupName(targetFile?.folder) || UNGROUPED_FILE_FILTER;

  if (collapsedGroupKeys.value.has(targetGroupKey)) {
    const nextKeys = new Set(collapsedGroupKeys.value);
    nextKeys.delete(targetGroupKey);
    collapsedGroupKeys.value = nextKeys;
  }

  await nextTick();
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

  const rows = Array.from(
    fileListElement.value?.querySelectorAll<HTMLElement>("[data-file-id]") ?? [],
  );
  const targetRowIndex = rows.findIndex(
    (element) => element.dataset.fileId === fileId,
  );
  const targetRow = rows[targetRowIndex];

  if (!targetRow) {
    return;
  }

  const anchorRow = rows[Math.max(0, targetRowIndex - 2)] ?? targetRow;
  const headerBottom =
    document
      .querySelector<HTMLElement>(".workspace-header")
      ?.getBoundingClientRect().bottom ?? 0;
  const anchorTop =
    anchorRow.getBoundingClientRect().top + window.scrollY;

  window.scrollTo({
    top: Math.max(0, anchorTop - Math.max(0, headerBottom)),
  });
  lastAutoScrolledFileId.value = fileId;
}

watch(
  () => props.project,
  (project) => {
    currentProject.value = project;
    const validIds = new Set(project.files.map((file) => file.id));
    replaceSelection(
      Array.from(selectedFileIds.value).filter((fileId) => validIds.has(fileId)),
    );
    lastAutoScrolledFileId.value = "";
    void loadFileSummaries();
  },
);

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

watch(
  fileGroups,
  (groups) => {
    if (
      groupFilter.value &&
      groupFilter.value !== UNGROUPED_FILE_FILTER &&
      !groups.some((group) => group.name === groupFilter.value)
    ) {
      groupFilter.value = "";
    }

    const validKeys = new Set([
      UNGROUPED_FILE_FILTER,
      ...groups.map((group) => group.name),
    ]);
    collapsedGroupKeys.value = new Set(
      Array.from(collapsedGroupKeys.value).filter((key) =>
        validKeys.has(key),
      ),
    );
  },
  { immediate: true },
);

watch(
  () => props.lastViewedFileId,
  () => {
    lastAutoScrolledFileId.value = "";
  },
);

watch(
  [
    () => props.lastViewedFileId,
    () => isLoading.value,
    () => visibleFiles.value.map((summary) => summary.file.id).join("\0"),
  ],
  () => {
    void scrollToLastViewedFile();
  },
  { flush: "post" },
);

onMounted(loadFileSummaries);
</script>

<template>
  <section class="files-page">
    <ProjectPageHeader
      eyebrow="项目文件"
      title="文件"
      summary="管理源文件、导入译文，并查看各文件翻译进度。"
    >
      <template #actions>
        <div class="title-actions">
          <span class="file-count">{{ visibleFiles.length }} 个文件</span>
          <button
            class="secondary-button"
            type="button"
            @click="emit('manageEntries')"
          >
            管理全部词条
          </button>
        </div>
      </template>
    </ProjectPageHeader>

    <FileToolbar
      :search-text="searchText"
      :sort-key="sortKey"
      :status-filter="fileFilter"
      :group-filter="groupFilter"
      :groups="fileGroups"
      :can-create="canCreate"
      :can-manage-folder="canManageFolder"
      @add-source="openDialog('add')"
      @batch-add-source="openDialog('batch-add')"
      @batch-import-translation="openDialog('batch-import')"
      @add-grouped-sources="openGroupDialog('add-files')"
      @update-search-text="searchText = $event"
      @update-sort-key="sortKey = $event as SortKey"
      @update-status-filter="fileFilter = $event as FileFilter"
      @update-group-filter="groupFilter = $event"
    />

    <BatchSelectionBar
      :selected-count="selectedCount"
      :hidden-selected-count="hiddenSelectedCount"
      :filtered-count="visibleFiles.length"
      :busy="isPreviewingBatch"
      :submit-disabled="
        availableBatchActions.length === 0 ||
        (batchNeedsFolder && !batchFolder.trim())
      "
      submit-label="预检并执行"
      :permission-message="
        availableBatchActions.length === 0
          ? '当前成员没有可用的文件批量操作权限。'
          : undefined
      "
      @select-all="selectAllFilteredFiles"
      @clear="clearFileSelection"
      @submit="handlePreviewFileBatch"
    >
      <select
        v-model="selectedBatchOperation"
        class="batch-operation-select"
        aria-label="文件批量操作"
      >
        <option
          v-for="action in availableBatchActions"
          :key="action.value"
          :value="action.value"
        >
          {{ action.label }}
        </option>
      </select>
      <input
        v-if="batchNeedsFolder"
        v-model="batchFolder"
        class="batch-folder-input"
        type="text"
        maxlength="120"
        placeholder="目标文件分组"
        list="batch-file-groups"
      />
      <datalist id="batch-file-groups">
        <option
          v-for="group in fileGroups"
          :key="group.name"
          :value="group.name"
        />
      </datalist>
    </BatchSelectionBar>

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

    <div
      v-else-if="visibleFiles.length > 0"
      ref="fileListElement"
      class="file-groups"
    >
      <FileGroupSection
        v-for="group in visibleFileGroups"
        :key="group.key"
        :name="group.name"
        :file-count="group.files.length"
        :collapsed="collapsedGroupKeys.has(group.key)"
        :can-manage="canManageFolder"
        :ungrouped="group.ungrouped"
        @toggle="toggleGroup(group.key)"
        @rename="
          openGroupDialog('rename-group', { sourceName: group.name })
        "
        @clear="handleClearGroup(group.name)"
      >
        <FileListItem
          v-for="summary in group.files"
          :key="summary.file.id"
          :data-file-id="summary.file.id"
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
          :can-manage-folder="canManageFolder"
          :can-delete="canDelete"
          :can-export-exchange="canExportExchange && !isExportingExchange"
          :is-recently-viewed="summary.file.id === props.lastViewedFileId"
          :selected="selectedFileIds.has(summary.file.id)"
          @select="toggleFileSelection"
          @open="emit('openFile', $event)"
          @manage-entries="emit('manageEntries', $event)"
          @update-source="openDialog('update', $event)"
          @import-translation="openDialog('import-translation', $event)"
          @rename="handleRename"
          @toggle-hidden="handleToggleHidden"
          @toggle-locked="handleToggleLocked"
          @change-folder="
            openGroupDialog('move-file', { fileId: $event })
          "
          @delete="handleDelete"
          @history="handleHistory"
          @export-exchange="handleExportExchange"
        />
      </FileGroupSection>
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
      :import-mode="
        dialogMode === 'import-translation' || dialogMode === 'batch-import'
          ? 'translation'
          : dialogMode === 'update'
            ? 'source-update'
            : 'source'
      "
      @cancel="closeDialog"
      @submit="handleDialogSubmit"
    />

    <FileHistoryDialog
      :open="historyDialogOpen"
      :file-name="historyFileName"
      :rows="historyRows"
      :is-loading="isLoadingHistory"
      :error-message="historyErrorMessage"
      @close="historyDialogOpen = false"
    />

    <FileGroupDialog
      :open="groupDialogMode !== null"
      :title="groupDialogTitle"
      :description="groupDialogDescription"
      :initial-value="groupDialogInitialValue"
      :suggestions="groupSuggestions"
      :confirm-label="
        groupDialogMode === 'add-files'
          ? '继续添加文件'
          : groupDialogMode === 'rename-group'
            ? '重命名'
            : '保存分组'
      "
      :allow-clear="groupDialogMode === 'move-file'"
      :is-submitting="isSubmittingGroup"
      @cancel="closeGroupDialog"
      @confirm="handleGroupDialogConfirm"
    />

    <BatchPreviewDialog
      :open="managementBatchPreview !== null"
      :title="selectedBatchLabel"
      item-unit="个"
      :selected-count="managementBatchPreview?.selectedCount ?? 0"
      :applicable-count="managementBatchPreview?.applicableFileIds.length ?? 0"
      :skipped-reason-counts="
        managementBatchPreview?.skippedReasonCounts ?? []
      "
      :affected-detail="batchAffectedDetail"
      :is-executing="isExecutingBatch"
      :danger="selectedBatchOperation === 'delete'"
      note="执行时会重新读取 project.json 并再次校验；文件批量删除作为一个写入计划提交，失败时会尝试恢复原数据。"
      @cancel="closeManagementBatchPreview"
      @confirm="handleExecuteFileBatch"
    />
  </section>
</template>

<style scoped>
.files-page {
  display: grid;
  gap: 16px;
}

.title-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

h2,
p {
  margin: 0;
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

.file-groups {
  display: grid;
  gap: 18px;
}

.batch-operation-select,
.batch-folder-input {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
}

.batch-operation-select {
  min-width: 150px;
}

.batch-folder-input {
  min-width: 180px;
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
