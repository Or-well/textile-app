<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ChangePreview from "../components/ChangePreview.vue";
import ConflictResolver from "../components/ConflictResolver.vue";
import type { Member, ProjectConfig, Task } from "../model/types";
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
  type ReadChangePackage,
} from "../services/changes";
import { exportProject, setExporterProjectRoot } from "../services/exporter";
import { getCurrentUser } from "../services/permissions";
import { openProject } from "../services/project";
import { loadTasks, setTasksProjectRoot } from "../services/tasks";

const props = defineProps<{
  project?: ProjectConfig;
  members?: Member[];
  currentUser?: Member | null;
}>();

const projectName = ref("");
const tasks = ref<Task[]>([]);
const selectedTaskId = ref("");
const isLoading = ref(false);
const isExporting = ref(false);
const isExportingRelease = ref(false);
const isReadingPackage = ref(false);
const isApplyingPackage = ref(false);
const errorMessage = ref("");
const message = ref("");
const changePackage = ref<ReadChangePackage>();
const packagePreview = ref<ChangePackagePreview>();
const conflicts = ref<ChangeConflict[]>([]);

const currentUser = computed(() => props.currentUser ?? getCurrentUser());
const hasProjectContext = computed(() => Boolean(props.project));
const emptyStateText = computed(() =>
  projectName.value
    ? "当前项目暂无可导出的任务。"
    : "请打开项目文件夹，选择用户和任务后导出修改。",
);

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

  await loadImportExportState();
}

async function handleOpenProject() {
  isLoading.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const project = await openProject();

    projectName.value = project.config.name;

    setChangesProjectRoot(project.root);
    setExporterProjectRoot(project.root);
    setTasksProjectRoot(project.root);
    await loadImportExportState();
  } catch (error) {
    projectName.value = "";
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
  if (!currentUser.value || !selectedTaskId.value) {
    errorMessage.value = "请先登录并选择任务。";
    return;
  }

  isExporting.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const result = await exportChangePackage(
      currentUser.value.id,
      selectedTaskId.value,
    );

    downloadBlob(result.blob, result.fileName);
    message.value = `已导出修改包：${result.fileName}`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导出修改包失败。请稍后再试。";
  } finally {
    isExporting.value = false;
  }
}

async function handleExportRelease() {
  isExportingRelease.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const result = await exportProject();

    downloadBlob(result.blob, result.fileName);
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

  isReadingPackage.value = true;
  errorMessage.value = "";
  message.value = "";
  changePackage.value = undefined;
  packagePreview.value = undefined;
  conflicts.value = [];

  try {
    const nextPackage = await readChangePackage(file);

    await validateChangePackage(nextPackage);
    changePackage.value = nextPackage;
    packagePreview.value = previewChangePackage(nextPackage);
    conflicts.value = await detectConflicts(nextPackage);
    message.value =
      conflicts.value.length > 0
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

  isApplyingPackage.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const result = await applyChangePackage(changePackage.value, resolutions);

    conflicts.value = [];
    message.value = `导入完成：应用 ${result.appliedEntries} 条词条，导入 ${result.importedComments} 条评论。`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导入修改包失败。请检查冲突处理。";
  } finally {
    isApplyingPackage.value = false;
  }
}

watch(
  () => [props.project?.project_id, props.members?.length ?? 0, currentUser.value?.id],
  () => {
    void initializeFromProjectContext();
  },
  { immediate: true },
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

      <div v-if="projectName" class="form-grid">
        <div class="current-user-field">
          <span>当前用户</span>
          <strong>{{ currentUser?.name || "未登录" }}</strong>
        </div>

        <label>
          <span>任务</span>
          <select v-model="selectedTaskId">
            <option v-for="task in tasks" :key="task.id" :value="task.id">
              {{ task.title }}
            </option>
          </select>
        </label>

        <button
          class="export-button"
          type="button"
          :disabled="isExporting || !currentUser || !selectedTaskId"
          @click="handleExportChanges"
        >
          {{ isExporting ? "正在导出..." : "导出我的修改" }}
        </button>
      </div>

      <section v-if="projectName" class="import-section">
        <h2>导入修改包</h2>
        <label class="file-field">
          <span>选择修改包</span>
          <input
            type="file"
            accept=".zip,application/zip"
            :disabled="isReadingPackage || isApplyingPackage"
            @change="handleSelectChangePackage"
          />
        </label>

        <ChangePreview
          :preview="packagePreview"
          :conflict-count="conflicts.length"
        />

        <button
          v-if="packagePreview && conflicts.length === 0"
          class="export-button"
          type="button"
          :disabled="isApplyingPackage"
          @click="handleApplyPackage()"
        >
          {{ isApplyingPackage ? "正在导入..." : "应用修改包" }}
        </button>

        <ConflictResolver
          :conflicts="conflicts"
          :is-applying="isApplyingPackage"
          @apply="handleApplyPackage"
        />
      </section>

      <section v-if="projectName" class="release-section">
        <h2>导出成品</h2>
        <p class="section-note">
          暂时导出为简单文本格式，并包含 manifest 和检查报告。
        </p>
        <button
          class="export-button"
          type="button"
          :disabled="isExportingRelease"
          @click="handleExportRelease"
        >
          {{ isExportingRelease ? "正在导出..." : "导出成品" }}
        </button>
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
.import-section,
.release-section {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}

.import-section,
.release-section {
  padding-top: 24px;
  border-top: 1px solid #e5e7eb;
}

.section-note {
  color: #4b5563;
  line-height: 1.7;
}

h2 {
  margin: 0;
  font-size: 20px;
}

label {
  display: grid;
  gap: 8px;
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

.export-button {
  justify-self: start;
}

@media (max-width: 680px) {
  .page-header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
