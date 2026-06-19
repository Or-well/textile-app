<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ChangePreview from "../components/ChangePreview.vue";
import ConflictResolver from "../components/ConflictResolver.vue";
import type {
  Member,
  ProjectConfig,
  ReleaseExportFormat,
  Task,
} from "../model/types";
import { exportProjectPackage } from "../services/projectPackage";
import {
  applyChangePackage,
  detectConflicts,
  exportChangePackage,
  previewChangePackage,
  readChangePackage,
  setChangesProjectRoot,
  validateChangePackage,
  type ChangeConflict,
  type ChangePackagePreview,
  type ConflictResolution,
  type ExportChangePackageMode,
  type ReadChangePackage,
} from "../services/changes";
import {
  exportProject,
  getReleaseExportSummary,
  normalizeReleaseExportOptions,
  setExporterProjectRoot,
  type ReleaseExportSummary,
} from "../services/exporter";
import {
  canDangerousImportChangePackage,
  canExportChangePackage,
  canExportMaintenanceChangePackage,
  canExportRelease,
  canImportChangePackage,
  canImportMaintenanceChangePackage,
  canProjectBackup,
  canReviewChangePackage,
  getCurrentUser,
} from "../services/permissions";
import { openProject } from "../services/project";
import type { ProjectDirectoryHandle } from "../services/projectFs";
import { loadTasks, setTasksProjectRoot } from "../services/tasks";

const props = defineProps<{
  project?: ProjectConfig;
  members?: Member[];
  projectRoot?: ProjectDirectoryHandle;
  currentUser?: Member | null;
}>();

const projectName = ref("");
const localRoot = ref<ProjectDirectoryHandle | null>(null);
const tasks = ref<Task[]>([]);
const selectedTaskId = ref("");
const exportMode = ref<ExportChangePackageMode>("user_changes");
const releaseFormat = ref<ReleaseExportFormat>("json");
const releaseOnlyReviewed = ref(false);
const releaseIncludeSource = ref(true);
const releaseIncludeKey = ref(true);
const releaseIncludeReport = ref(true);
const releaseIncludeManifest = ref(true);
const releaseSummary = ref<ReleaseExportSummary>();
const isLoading = ref(false);
const isExporting = ref(false);
const isExportingRelease = ref(false);
const isExportingProjectFile = ref(false);
const isLoadingReleaseSummary = ref(false);
const isReadingPackage = ref(false);
const isApplyingPackage = ref(false);
const errorMessage = ref("");
const message = ref("");
const changePackage = ref<ReadChangePackage>();
const packagePreview = ref<ChangePackagePreview>();
const conflicts = ref<ChangeConflict[]>([]);

const currentUser = computed(() => props.currentUser ?? getCurrentUser());
const hasProjectContext = computed(() => Boolean(props.project));
const canExportChanges = computed(() => canExportChangePackage(currentUser.value));
const canExportMaintenance = computed(() =>
  canExportMaintenanceChangePackage(currentUser.value),
);
const canImportPackages = computed(() => canImportChangePackage(currentUser.value));
const canImportMaintenance = computed(() =>
  canImportMaintenanceChangePackage(currentUser.value),
);
const canReviewPackages = computed(() => canReviewChangePackage(currentUser.value));
const canDangerousImport = computed(() =>
  canDangerousImportChangePackage(currentUser.value),
);
const canExportFinalRelease = computed(() => canExportRelease(currentUser.value));
const canExportProjectBackup = computed(() => canProjectBackup(currentUser.value));
const projectRootForExport = computed(() => props.projectRoot ?? localRoot.value);
const canSelectImportFile = computed(
  () => canImportPackages.value || canImportMaintenance.value,
);
const canExportSelectedMode = computed(() =>
  exportMode.value === "maintenance_changes"
    ? canExportMaintenance.value
    : canExportChanges.value,
);
const emptyStateText = computed(() =>
  projectName.value
    ? "当前项目暂无可导出的任务。"
    : "请打开项目文件夹，选择用户和任务后导出修改。",
);
const packageValidation = computed(() => packagePreview.value?.validation);
const needsDangerousImport = computed(
  () => packageValidation.value?.requiresDangerousImport ?? false,
);
const canApplySelectedPackage = computed(() => {
  const validation = packageValidation.value;

  if (!validation) {
    return false;
  }

  if (validation.projectMatch !== "matched") {
    return false;
  }

  if (validation.packageType === "maintenance_changes") {
    if (!canImportMaintenance.value) {
      return false;
    }
  } else if (!canImportPackages.value) {
    return false;
  }

  if (validation.requiresDangerousImport) {
    return canDangerousImport.value;
  }

  return validation.canImportNormally;
});
const applyDisabledReason = computed(() => {
  const validation = packageValidation.value;

  if (!canSelectImportFile.value) {
    return "当前成员没有导入修改包的权限。";
  }

  if (!validation) {
    return "";
  }

  if (validation.projectMatch !== "matched") {
    return "修改包不属于当前项目，不能导入。";
  }

  if (
    validation.packageType === "maintenance_changes" &&
    !canImportMaintenance.value
  ) {
    return "当前成员没有导入项目维护修改的权限。";
  }

  if (validation.requiresDangerousImport && !canDangerousImport.value) {
    return "内容完整性未通过，当前成员没有危险导入权限。";
  }

  return "";
});
const releaseOptionPayload = computed(() => ({
  format: releaseFormat.value,
  only_reviewed: releaseOnlyReviewed.value,
  include_source: releaseIncludeSource.value,
  include_key: releaseIncludeKey.value,
  include_report: releaseIncludeReport.value,
  include_manifest: releaseIncludeManifest.value,
}));

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

function applyReleaseSettings(project: ProjectConfig) {
  const options = normalizeReleaseExportOptions(project);

  releaseFormat.value = options.format;
  releaseOnlyReviewed.value = options.only_reviewed;
  releaseIncludeSource.value = options.include_source;
  releaseIncludeKey.value = options.include_key;
  releaseIncludeReport.value = options.include_report;
  releaseIncludeManifest.value = options.include_manifest;
}

async function refreshReleaseSummary() {
  if (!projectName.value) {
    releaseSummary.value = undefined;
    return;
  }

  isLoadingReleaseSummary.value = true;

  try {
    releaseSummary.value = await getReleaseExportSummary(releaseOptionPayload.value);
  } catch {
    releaseSummary.value = undefined;
  } finally {
    isLoadingReleaseSummary.value = false;
  }
}

async function loadImportExportState() {
  isLoading.value = true;
  errorMessage.value = "";
  message.value = "";
  changePackage.value = undefined;
  packagePreview.value = undefined;
  conflicts.value = [];

  try {
    tasks.value = await loadTasks();
    selectedTaskId.value = tasks.value[0]?.id ?? "";
    await refreshReleaseSummary();
  } catch (error) {
    tasks.value = [];
    selectedTaskId.value = "";
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "导入导出准备失败。请确认项目数据可以读取。";
  } finally {
    isLoading.value = false;
  }
}

async function initializeFromProjectContext() {
  if (!props.project) {
    return;
  }

  projectName.value = props.project.name;
  localRoot.value = props.projectRoot ?? null;
  applyReleaseSettings(props.project);

  await loadImportExportState();
}

async function handleOpenProject() {
  isLoading.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const project = await openProject();

    projectName.value = project.config.name;
    localRoot.value = project.root;
    applyReleaseSettings(project.config);

    setChangesProjectRoot(project.root);
    setExporterProjectRoot(project.root);
    setTasksProjectRoot(project.root);
    await loadImportExportState();
  } catch (error) {
    projectName.value = "";
    localRoot.value = null;
    tasks.value = [];
    selectedTaskId.value = "";
    changePackage.value = undefined;
    packagePreview.value = undefined;
    conflicts.value = [];

    if (error instanceof DOMException && error.name === "AbortError") {
      errorMessage.value = "没有打开项目文件夹。你可以重新点击按钮选择项目。";
    } else if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = "导出准备失败。请确认选择的是项目根目录。";
    }
  } finally {
    isLoading.value = false;
  }
}

async function handleExportChanges() {
  if (!currentUser.value) {
    errorMessage.value = "请先登录。";
    return;
  }

  if (exportMode.value === "task_changes" && !selectedTaskId.value) {
    errorMessage.value = "请选择任务。";
    return;
  }

  if (!canExportSelectedMode.value) {
    errorMessage.value =
      exportMode.value === "maintenance_changes"
        ? "当前成员没有导出项目维护修改的权限。"
        : "当前成员没有导出修改包的权限。";
    return;
  }

  isExporting.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const result = await exportChangePackage(currentUser.value.id, {
      mode: exportMode.value,
      taskId: exportMode.value === "task_changes" ? selectedTaskId.value : undefined,
    });

    downloadBlob(result.blob, result.fileName);
    message.value = result.signature
      ? `已导出已签名修改包：${result.fileName}`
      : `已导出未签名修改包：${result.fileName}。当前成员未配置签名私钥。`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导出修改包失败。请稍后再试。";
  } finally {
    isExporting.value = false;
  }
}

async function handleExportRelease() {
  if (!canExportFinalRelease.value) {
    errorMessage.value = "当前成员没有导出成品的权限。";
    return;
  }

  isExportingRelease.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const result = await exportProject({
      ...releaseOptionPayload.value,
      exportedBy: currentUser.value?.id ?? "",
    });

    downloadBlob(result.blob, result.fileName);
    releaseSummary.value = result.summary;
    message.value = `已导出成品：${result.fileName}`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导出成品失败。请稍后再试。";
  } finally {
    isExportingRelease.value = false;
  }
}

async function handleSelectChangePackage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  if (!canSelectImportFile.value) {
    errorMessage.value = "当前成员没有导入修改包的权限。";
    input.value = "";
    return;
  }

  isReadingPackage.value = true;
  errorMessage.value = "";
  message.value = "";
  changePackage.value = undefined;
  packagePreview.value = undefined;
  conflicts.value = [];

  try {
    const nextPackage = await readChangePackage(file);
    const validation = await validateChangePackage(nextPackage);

    changePackage.value = nextPackage;
    packagePreview.value = previewChangePackage(nextPackage);
    conflicts.value =
      validation.projectMatch === "matched"
        ? await detectConflicts(nextPackage)
        : [];
    message.value =
      validation.projectMatch !== "matched"
        ? "修改包已读取，但不属于当前项目，不能导入。"
        : conflicts.value.length > 0
          ? "修改包已读取，请先处理冲突。"
          : "修改包已读取，未发现冲突。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "修改包读取失败。请重新选择文件。";
  } finally {
    isReadingPackage.value = false;
    input.value = "";
  }
}

async function handleApplyPackage(resolutions: ConflictResolution[] = []) {
  if (!changePackage.value) {
    errorMessage.value = "请先选择修改包。";
    return;
  }

  if (!canApplySelectedPackage.value) {
    errorMessage.value = applyDisabledReason.value || "当前修改包不能导入。";
    return;
  }

  if (
    needsDangerousImport.value &&
    !window.confirm(
      "修改包内容完整性未通过。危险导入可能覆盖被篡改的内容，确认继续吗？",
    )
  ) {
    return;
  }

  if (
    packageValidation.value?.requiresMaintenanceConfirmation &&
    !window.confirm(
      "这个修改包包含项目维护变更，可能更新项目设置、成员、权限或密码凭据。确认继续吗？",
    )
  ) {
    return;
  }

  if (
    packageValidation.value?.requiresOwnerCredentialConfirmation &&
    !window.confirm(
      "这个修改包涉及负责人账号凭据或负责人权限变更。再次确认继续导入吗？",
    )
  ) {
    return;
  }

  isApplyingPackage.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const result = await applyChangePackage(changePackage.value, resolutions, {
      allowDangerous: needsDangerousImport.value,
      confirmMaintenance:
        packageValidation.value?.requiresMaintenanceConfirmation ?? false,
      confirmOwnerCredentials:
        packageValidation.value?.requiresOwnerCredentialConfirmation ?? false,
      actor: currentUser.value,
    });

    conflicts.value = [];
    const detail = `应用 ${result.appliedEntries} 条词条，导入 ${result.importedComments} 条评论、${result.importedTerms} 条术语、${result.importedTasks} 条任务。`;
    message.value = needsDangerousImport.value
      ? `危险导入完成：${detail}`
      : `导入完成：${detail}`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导入修改包失败。请检查冲突处理。";
  } finally {
    isApplyingPackage.value = false;
  }
}

async function handleExportProjectFile() {
  if (!canExportProjectBackup.value) {
    errorMessage.value = "当前成员没有导出项目备份的权限。";
    return;
  }

  if (!projectRootForExport.value) {
    errorMessage.value = "请先打开项目，再导出项目备份。";
    return;
  }

  isExportingProjectFile.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const result = await exportProjectPackage(projectRootForExport.value);

    downloadBlob(result.blob, result.fileName);
    message.value = `已导出项目备份：${result.fileName}`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导出项目备份失败。请稍后再试。";
  } finally {
    isExportingProjectFile.value = false;
  }
}

watch(
  () => [
    props.project?.project_id,
    props.members?.length ?? 0,
    props.projectRoot?.name,
    currentUser.value?.id,
  ],
  () => {
    void initializeFromProjectContext();
  },
  { immediate: true },
);

watch(
  () => [
    releaseFormat.value,
    releaseOnlyReviewed.value,
    releaseIncludeSource.value,
    releaseIncludeKey.value,
    releaseIncludeReport.value,
  ],
  () => {
    void refreshReleaseSummary();
  },
);
</script>

<template>
  <main class="import-export-page">
    <section class="export-panel">
      <div class="page-header">
        <div>
          <p class="eyebrow">导入 / 导出</p>
          <h1>{{ projectName || "导出修改包" }}</h1>
        </div>

        <button
          v-if="!hasProjectContext"
          class="open-button"
          type="button"
          :disabled="isLoading"
          @click="handleOpenProject"
        >
          {{ isLoading ? "正在加载..." : "打开项目文件夹" }}
        </button>
      </div>

      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
      <p v-if="message" class="message">{{ message }}</p>

      <section v-if="projectName" class="project-file-section">
        <h2>导出项目备份</h2>
        <p class="section-note">
          导出为 .hproj 项目文件，方便备份或在另一台设备打开。
        </p>
        <button
          class="export-button"
          type="button"
          :disabled="isExportingProjectFile || !canExportProjectBackup"
          @click="handleExportProjectFile"
        >
          {{ isExportingProjectFile ? "正在导出..." : "导出项目备份" }}
        </button>
      </section>

      <section v-if="projectName" class="form-grid change-export-section">
        <h2>导出修改包</h2>
        <p class="section-note">
          成员把自己的译文、评论、术语或任务修改导出为签名修改包。
        </p>

        <div class="current-user-field">
          <span>当前用户</span>
          <strong>{{ currentUser?.name || "未登录" }}</strong>
        </div>

        <fieldset class="export-mode-field">
          <legend>导出范围</legend>
          <label>
            <input
              v-model="exportMode"
              type="radio"
              value="user_changes"
            />
            <span>导出我的全部修改</span>
          </label>
          <label>
            <input
              v-model="exportMode"
              type="radio"
              value="task_changes"
            />
            <span>导出所选任务修改</span>
          </label>
          <label>
            <input
              v-model="exportMode"
              type="radio"
              value="maintenance_changes"
              :disabled="!canExportMaintenance"
            />
            <span>导出项目维护修改</span>
          </label>
        </fieldset>

        <label v-if="exportMode === 'task_changes'">
          <span>任务</span>
          <select v-model="selectedTaskId">
            <option v-for="task in tasks" :key="task.id" :value="task.id">
              {{ task.title }}
            </option>
          </select>
        </label>

        <button
          v-if="canExportSelectedMode"
          class="export-button"
          type="button"
          :disabled="
            isExporting ||
            !currentUser ||
            (exportMode === 'task_changes' && !selectedTaskId)
          "
          @click="handleExportChanges"
        >
          {{ isExporting ? "正在导出..." : "导出修改包" }}
        </button>
        <p v-else class="section-note">
          {{
            exportMode === "maintenance_changes"
              ? "当前成员没有导出项目维护修改的权限。"
              : "当前成员没有导出修改包的权限。"
          }}
        </p>
      </section>

      <section v-if="projectName" class="import-section">
        <h2>导入修改包</h2>
        <p class="section-note">
          负责人可在这里查看待合并修改、验证签名并处理冲突。
        </p>
        <label v-if="canSelectImportFile" class="file-field">
          <span>选择修改包</span>
          <input
            type="file"
            accept=".zip,application/zip"
            :disabled="isReadingPackage || isApplyingPackage"
            @change="handleSelectChangePackage"
          />
        </label>
        <p v-else class="section-note">当前成员没有导入修改包的权限。</p>

        <ChangePreview
          :preview="packagePreview"
          :conflict-count="conflicts.length"
        />

        <p v-if="packagePreview && !canReviewPackages" class="section-note">
          当前成员没有查看待合并修改的权限，只能按已有导入权限继续操作。
        </p>

        <button
          v-if="packagePreview && conflicts.length === 0 && canSelectImportFile"
          :class="['export-button', { 'danger-button': needsDangerousImport }]"
          type="button"
          :disabled="isApplyingPackage || !canApplySelectedPackage"
          @click="handleApplyPackage()"
        >
          {{
            isApplyingPackage
              ? "正在导入..."
              : needsDangerousImport
                ? "危险导入修改包"
                : "应用修改包"
          }}
        </button>
        <p v-if="packagePreview && applyDisabledReason" class="section-note">
          {{ applyDisabledReason }}
        </p>

        <section class="conflict-section">
          <h2>冲突处理</h2>
          <p class="section-note">
            如果修改包和当前项目内容同时改过同一词条，请先选择保留哪一版。
          </p>

        <ConflictResolver
          :conflicts="conflicts"
          :is-applying="isApplyingPackage"
          :can-apply="canApplySelectedPackage"
          :disabled-reason="applyDisabledReason"
          @apply="handleApplyPackage"
        />
        </section>
      </section>

      <section v-if="projectName" class="release-section">
        <h2>导出成品</h2>
        <p class="section-note">
          按当前设置生成成品包、项目清单和检查报告。
        </p>
        <div class="release-settings-grid">
          <label>
            <span>导出格式</span>
            <select v-model="releaseFormat">
              <option value="json">JSON</option>
              <option value="txt">TXT 对照</option>
              <option value="csv">CSV</option>
              <option value="ks">KS</option>
            </select>
          </label>

          <label class="checkbox-line">
            <input v-model="releaseOnlyReviewed" type="checkbox" />
            <span>只导出已审核</span>
          </label>

          <label class="checkbox-line">
            <input v-model="releaseIncludeSource" type="checkbox" />
            <span>包含原文</span>
          </label>

          <label class="checkbox-line">
            <input v-model="releaseIncludeKey" type="checkbox" />
            <span>包含键值</span>
          </label>

          <label class="checkbox-line">
            <input v-model="releaseIncludeReport" type="checkbox" />
            <span>生成报告</span>
          </label>
        </div>

        <section class="release-summary" aria-label="导出前统计摘要">
          <h3>导出前统计</h3>
          <p v-if="isLoadingReleaseSummary" class="section-note">
            正在刷新统计...
          </p>
          <div v-else-if="releaseSummary" class="summary-grid">
            <span>
              <strong>{{ releaseSummary.totalEntries }}</strong>
              总词条数
            </span>
            <span>
              <strong>{{ releaseSummary.reviewedEntries }}</strong>
              已审核数
            </span>
            <span>
              <strong>{{ releaseSummary.untranslatedEntries }}</strong>
              未翻译数
            </span>
            <span>
              <strong>{{ releaseSummary.disputedEntries }}</strong>
              争议数
            </span>
          </div>
        </section>

        <button
          v-if="canExportFinalRelease"
          class="export-button"
          type="button"
          :disabled="isExportingRelease"
          @click="handleExportRelease"
        >
          {{ isExportingRelease ? "正在导出..." : "导出成品" }}
        </button>
        <p v-else class="section-note">当前成员没有导出成品的权限。</p>
      </section>

      <p v-else-if="!isLoading && !errorMessage" class="empty-state">
        {{ emptyStateText }}
      </p>
    </section>
  </main>
</template>

<style scoped>
.import-export-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px;
  background: #f6f7f9;
  color: #1f2937;
}

.export-panel {
  width: min(100%, 720px);
  padding: 28px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.page-header {
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
p {
  margin: 0;
}

h1 {
  font-size: 30px;
  line-height: 1.2;
}

.open-button,
.export-button {
  min-height: 42px;
  padding: 0 16px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: #ffffff;
  font-size: 15px;
  cursor: pointer;
}

button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.error-message,
.message,
.empty-state {
  margin-top: 22px;
  line-height: 1.7;
}

.error-message {
  color: #b42318;
}

.message {
  color: #166534;
}

.empty-state {
  color: #4b5563;
}

.form-grid,
.project-file-section,
.import-section,
.conflict-section,
.release-section {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}

.project-file-section,
.import-section,
.release-section {
  padding-top: 24px;
  border-top: 1px solid #e5e7eb;
}

.section-note {
  color: #4b5563;
  line-height: 1.7;
}

.conflict-section {
  padding-top: 18px;
  border-top: 1px solid #e5e7eb;
}

h2 {
  margin: 0;
  font-size: 20px;
}

h3 {
  margin: 0;
  color: #111827;
  font-size: 16px;
}

label {
  display: grid;
  gap: 8px;
}

.export-mode-field {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 12px;
  border: 1px solid #d7dde5;
  border-radius: 6px;
}

.export-mode-field legend {
  padding: 0 4px;
  color: #5b6472;
  font-size: 14px;
}

.export-mode-field label {
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 10px;
}

.release-settings-grid {
  display: grid;
  gap: 12px;
}

.checkbox-line {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 10px;
}

label span,
.current-user-field span {
  color: #5b6472;
  font-size: 14px;
}

.current-user-field {
  display: grid;
  gap: 8px;
}

.current-user-field strong {
  min-height: 42px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border: 1px solid #d7dde5;
  border-radius: 6px;
  background: #f8fafb;
  color: #111827;
}

select,
input {
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
}

input[type="radio"] {
  min-height: auto;
  width: 16px;
  height: 16px;
  padding: 0;
}

input[type="checkbox"] {
  min-height: auto;
  width: 16px;
  height: 16px;
  padding: 0;
}

.release-summary {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #f8fafb;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.summary-grid span {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #ffffff;
  color: #5b6472;
  font-size: 13px;
}

.summary-grid strong {
  color: #111827;
  font-size: 20px;
}

.export-button {
  justify-self: start;
}

.danger-button {
  background: #b42318;
}

@media (max-width: 680px) {
  .page-header {
    align-items: stretch;
    flex-direction: column;
  }

  .summary-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
