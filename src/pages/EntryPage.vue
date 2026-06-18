<script setup lang="ts">
import { computed, ref } from "vue";
import EntryEditor from "../components/EntryEditor.vue";
import EntryList from "../components/EntryList.vue";
import ProgressBar from "../components/ProgressBar.vue";
import TaskPanel from "../components/TaskPanel.vue";
import type { Entry, Task } from "../model/types";
import { setCommentsProjectRoot } from "../services/comments";
import { setHistoryProjectRoot } from "../services/history";
import { openProject } from "../services/project";
import {
  getEntryById,
  loadEntries,
  saveEntry,
  setEntriesProjectRoot,
} from "../services/entries";
import { getProjectStats, type BasicProjectStats } from "../services/stats";
import {
  getTaskProgress,
  isEntryInTask,
  loadTasks,
  setTasksProjectRoot,
  submitTask,
  type TaskProgress,
} from "../services/tasks";
import { setTermsProjectRoot } from "../services/terms";

const entries = ref<Entry[]>([]);
const tasks = ref<Task[]>([]);
const selectedEntry = ref<Entry>();
const selectedTaskId = ref("");
const stats = ref<BasicProjectStats>();
const taskProgress = ref<TaskProgress>();
const projectName = ref("");
const isLoading = ref(false);
const isSaving = ref(false);
const isSubmittingTask = ref(false);
const errorMessage = ref("");
const savedMessage = ref("");

const selectedTask = computed(
  () => tasks.value.find((task) => task.id === selectedTaskId.value),
);
const visibleEntries = computed(() => {
  if (!selectedTask.value) {
    return entries.value;
  }

  return entries.value.filter((entry) => isEntryInTask(entry, selectedTask.value!));
});
const hasEntries = computed(() => visibleEntries.value.length > 0);

async function refreshStats() {
  stats.value = await getProjectStats(entries.value);
}

async function refreshTaskProgress() {
  taskProgress.value = selectedTask.value
    ? await getTaskProgress(selectedTask.value.id)
    : undefined;
}

async function handleOpenProject() {
  isLoading.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const project = await openProject();
    projectName.value = project.config.name;
    setEntriesProjectRoot(project.root);
    setTermsProjectRoot(project.root);
    setTasksProjectRoot(project.root);
    setCommentsProjectRoot(project.root);
    setHistoryProjectRoot(project.root);

    entries.value = await loadEntries("script_001");
    tasks.value = await loadTasks();
    selectedTaskId.value = "";
    selectedEntry.value = visibleEntries.value[0];
    await refreshStats();
    await refreshTaskProgress();
  } catch (error) {
    entries.value = [];
    tasks.value = [];
    selectedEntry.value = undefined;
    selectedTaskId.value = "";
    stats.value = undefined;
    taskProgress.value = undefined;

    if (error instanceof DOMException && error.name === "AbortError") {
      errorMessage.value = "没有打开项目文件夹。你可以重新点击按钮选择项目。";
    } else if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = "词条列表加载失败。请确认选择的是项目根目录。";
    }
  } finally {
    isLoading.value = false;
  }
}

async function handleSelectEntry(entry: Entry) {
  selectedEntry.value = await getEntryById(entry.id);
  savedMessage.value = "";
}

async function handleSelectTask() {
  selectedEntry.value = visibleEntries.value[0];
  savedMessage.value = "";
  await refreshTaskProgress();
}

function replaceEntry(savedEntry: Entry) {
  entries.value = entries.value.map((entry) =>
    entry.id === savedEntry.id ? savedEntry : entry,
  );
  selectedEntry.value = savedEntry;
}

function selectNextEntry(currentEntryId: string) {
  const currentIndex = visibleEntries.value.findIndex(
    (entry) => entry.id === currentEntryId,
  );
  const nextEntry = visibleEntries.value[currentIndex + 1];

  if (nextEntry) {
    selectedEntry.value = nextEntry;
  }
}

async function handleSaveEntry(entry: Entry) {
  isSaving.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const savedEntry = await saveEntry(entry);

    replaceEntry(savedEntry);
    await refreshStats();
    await refreshTaskProgress();
    savedMessage.value = "已保存译文。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "保存失败。请确认项目文件夹仍然可以访问。";
  } finally {
    isSaving.value = false;
  }
}

async function handleSaveAndNext(entry: Entry) {
  isSaving.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const savedEntry = await saveEntry(entry);

    replaceEntry(savedEntry);
    await refreshStats();
    await refreshTaskProgress();
    selectNextEntry(savedEntry.id);
    savedMessage.value = "已保存译文。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "保存失败。请确认项目文件夹仍然可以访问。";
  } finally {
    isSaving.value = false;
  }
}

async function handleEntryUpdated(entry: Entry) {
  replaceEntry(entry);
  await refreshStats();
  await refreshTaskProgress();
  savedMessage.value = "词条状态已更新。";
}

async function handleSubmitTask(taskId: string) {
  isSubmittingTask.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const submittedTask = await submitTask(taskId);

    tasks.value = tasks.value.map((task) =>
      task.id === submittedTask.id ? submittedTask : task,
    );
    await refreshTaskProgress();
    savedMessage.value = "任务已提交。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "任务提交失败。请稍后再试。";
  } finally {
    isSubmittingTask.value = false;
  }
}
</script>

<template>
  <main class="entry-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">词条浏览</p>
        <h1>{{ projectName || "打开项目" }}</h1>
      </div>

      <button
        class="open-button"
        type="button"
        :disabled="isLoading"
        @click="handleOpenProject"
      >
        {{ isLoading ? "正在加载..." : "打开项目文件夹" }}
      </button>
    </header>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="savedMessage" class="saved-message">{{ savedMessage }}</p>

    <section v-if="tasks.length > 0" class="task-filter">
      <label>
        <span>任务筛选</span>
        <select v-model="selectedTaskId" @change="handleSelectTask">
          <option value="">全部词条</option>
          <option v-for="task in tasks" :key="task.id" :value="task.id">
            {{ task.title }}
          </option>
        </select>
      </label>

      <TaskPanel
        :task="selectedTask"
        :progress="taskProgress"
        :is-submitting="isSubmittingTask"
        @submit-task="handleSubmitTask"
      />
    </section>

    <section v-if="stats" class="stats-summary">
      <ProgressBar :percent="stats.progressPercent" label="当前文件进度" />
      <div class="stats-counts">
        <span>总词条：{{ stats.totalEntries }}</span>
        <span>未翻译：{{ stats.untranslatedEntries }}</span>
        <span>已翻译：{{ stats.translatedEntries }}</span>
        <span>已校对：{{ stats.proofreadEntries }}</span>
        <span>已审核：{{ stats.reviewedEntries }}</span>
        <span>有争议：{{ stats.disputedEntries }}</span>
      </div>
    </section>

    <section v-if="hasEntries" class="entry-workspace">
      <EntryList
        class="list-pane"
        :entries="visibleEntries"
        :selected-entry-id="selectedEntry?.id"
        @select="handleSelectEntry"
      />

      <EntryEditor
        class="detail-pane"
        :entry="selectedEntry"
        :is-saving="isSaving"
        @save="handleSaveEntry"
        @save-next="handleSaveAndNext"
        @entry-updated="handleEntryUpdated"
      />
    </section>

    <p v-else-if="!isLoading" class="empty-state">
      请选择样例项目文件夹，加载 script_001 的词条。
    </p>
  </main>
</template>

<style scoped>
.entry-page {
  min-height: 100vh;
  padding: 28px;
  background: #f6f7f9;
  color: #1f2937;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  max-width: 1180px;
  margin: 0 auto 20px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #5b6472;
  font-size: 14px;
}

h1,
h2 {
  margin: 0;
  line-height: 1.2;
}

h1 {
  font-size: 30px;
}

h2 {
  font-size: 22px;
}

.open-button {
  min-height: 42px;
  padding: 0 16px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: #ffffff;
  font-size: 15px;
  cursor: pointer;
}

.open-button:disabled {
  cursor: wait;
  opacity: 0.72;
}

.error-message,
.saved-message,
.empty-state {
  max-width: 1180px;
  margin: 0 auto;
  line-height: 1.7;
}

.error-message {
  color: #b42318;
}

.saved-message {
  color: #166534;
}

.empty-state {
  padding: 28px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #4b5563;
}

.task-filter {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 20px;
  max-width: 1180px;
  margin: 0 auto 20px;
}

.task-filter label {
  display: grid;
  gap: 8px;
  align-self: start;
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.task-filter span {
  color: #5b6472;
  font-size: 14px;
}

.task-filter select {
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  font: inherit;
}

.stats-summary {
  display: grid;
  gap: 12px;
  max-width: 1180px;
  margin: 0 auto 20px;
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.stats-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  color: #4b5563;
  font-size: 14px;
}

.entry-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
  gap: 20px;
  max-width: 1180px;
  margin: 0 auto;
}

.list-pane,
.detail-pane {
  min-width: 0;
}

.detail-pane {
  align-self: start;
}

@media (max-width: 900px) {
  .entry-page {
    padding: 18px;
  }

  .page-header,
  .task-filter,
  .entry-workspace {
    grid-template-columns: 1fr;
  }

  .page-header {
    align-items: stretch;
  }
}
</style>
