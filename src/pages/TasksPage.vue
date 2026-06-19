<script setup lang="ts">
import { computed, ref, watch } from "vue";
import TaskPanel from "../components/TaskPanel.vue";
import type { Member, ProjectConfig, Task } from "../model/types";
import {
  canExportChangePackage,
  getCurrentUser,
} from "../services/permissions";
import { openProject } from "../services/project";
import {
  getTaskProgress,
  getTasksByUser,
  loadTasks,
  setTasksProjectRoot,
  submitTask,
  type TaskProgress,
} from "../services/tasks";

const props = defineProps<{
  project?: ProjectConfig;
  members?: Member[];
  currentUser?: Member | null;
}>();

const allTasks = ref<Task[]>([]);
const myTasks = ref<Task[]>([]);
const selectedTask = ref<Task>();
const selectedProgress = ref<TaskProgress>();
const projectName = ref("");
const isLoading = ref(false);
const isSubmitting = ref(false);
const errorMessage = ref("");
const savedMessage = ref("");

const currentUser = computed(() => props.currentUser ?? getCurrentUser());
const hasProjectContext = computed(() => Boolean(props.project));
const canExportFallback = computed(() =>
  canExportChangePackage(currentUser.value),
);
const submitActionLabel = computed(() => "导出修改包");
const submitActionHint = computed(() =>
  canExportFallback.value
    ? "提交任务后，请导出修改包交给负责人合并。"
    : "当前成员没有导出修改包的权限，请联系负责人处理。",
);
const emptyStateText = computed(() =>
  projectName.value ? "当前项目暂无任务。" : "请打开项目文件夹，查看任务。",
);

async function refreshMyTasks() {
  myTasks.value = currentUser.value?.id
    ? await getTasksByUser(currentUser.value.id)
    : [];
}

async function selectTask(task: Task) {
  selectedTask.value = task;
  selectedProgress.value = await getTaskProgress(task.id);
  savedMessage.value = "";
}

async function loadTaskState() {
  isLoading.value = true;
  errorMessage.value = "";
  savedMessage.value = "";
  selectedTask.value = undefined;
  selectedProgress.value = undefined;

  try {
    allTasks.value = await loadTasks();
    await refreshMyTasks();

    if (myTasks.value[0]) {
      await selectTask(myTasks.value[0]);
    }
  } catch (error) {
    allTasks.value = [];
    myTasks.value = [];
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "任务列表加载失败。请确认项目数据可以读取。";
  } finally {
    isLoading.value = false;
  }
}

async function initializeFromProjectContext() {
  if (!props.project) {
    return;
  }

  projectName.value = props.project.name;

  await loadTaskState();
}

async function handleOpenProject() {
  isLoading.value = true;
  errorMessage.value = "";
  savedMessage.value = "";
  selectedTask.value = undefined;
  selectedProgress.value = undefined;

  try {
    const project = await openProject();

    projectName.value = project.config.name;

    setTasksProjectRoot(project.root);
    await loadTaskState();
  } catch (error) {
    allTasks.value = [];
    myTasks.value = [];

    if (error instanceof DOMException && error.name === "AbortError") {
      errorMessage.value = "没有打开项目文件夹。你可以重新点击按钮选择项目。";
    } else if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = "任务列表加载失败。请确认选择的是项目根目录。";
    }
  } finally {
    isLoading.value = false;
  }
}

async function handleSubmitTask(taskId: string) {
  isSubmitting.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const submittedTask = await submitTask(taskId);

    allTasks.value = allTasks.value.map((task) =>
      task.id === submittedTask.id ? submittedTask : task,
    );
    await refreshMyTasks();
    await selectTask(submittedTask);

    savedMessage.value = canExportFallback.value
      ? "任务已提交。请导出修改包交给负责人合并。"
      : "任务已提交。当前成员没有导出修改包的权限，请联系负责人处理。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "任务提交失败。请稍后再试。";
  } finally {
    isSubmitting.value = false;
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
  <main class="tasks-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">任务管理</p>
        <h1>{{ projectName || "打开项目" }}</h1>
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
    </header>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="savedMessage" class="saved-message">{{ savedMessage }}</p>

    <section v-if="allTasks.length > 0" class="tasks-layout">
      <div class="task-lists">
        <div class="user-field">
          <span>当前成员</span>
          <strong>{{ currentUser?.name || "未登录" }}</strong>
        </div>

        <section>
          <h2>我的任务</h2>
          <button
            v-for="task in myTasks"
            :key="task.id"
            class="task-row"
            :class="{ selected: task.id === selectedTask?.id }"
            type="button"
            @click="selectTask(task)"
          >
            <span>{{ task.title }}</span>
            <small>{{ task.status }}</small>
          </button>
          <p v-if="myTasks.length === 0" class="empty-text">当前用户没有任务。</p>
        </section>

        <section>
          <h2>全部任务</h2>
          <button
            v-for="task in allTasks"
            :key="task.id"
            class="task-row"
            :class="{ selected: task.id === selectedTask?.id }"
            type="button"
            @click="selectTask(task)"
          >
            <span>{{ task.title }}</span>
            <small>{{ task.assignee }} · {{ task.status }}</small>
          </button>
        </section>
      </div>

      <div class="task-side">
        <TaskPanel
          :task="selectedTask"
          :progress="selectedProgress"
          :is-submitting="isSubmitting"
          @submit-task="handleSubmitTask"
        />

        <aside class="submit-mode-card">
          <span>当前提交方式</span>
          <strong>{{ submitActionLabel }}</strong>
          <p>{{ submitActionHint }}</p>
        </aside>
      </div>
    </section>

    <p v-else-if="!isLoading && !errorMessage" class="empty-state">
      {{ emptyStateText }}
    </p>
  </main>
</template>

<style scoped>
.tasks-page {
  min-height: 100vh;
  padding: 28px;
  background: #f6f7f9;
  color: #1f2937;
}

.page-header,
.tasks-layout,
.error-message,
.saved-message,
.empty-state {
  max-width: 1080px;
  margin-left: auto;
  margin-right: auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
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
  margin-bottom: 10px;
  font-size: 18px;
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
  line-height: 1.7;
}

.error-message {
  color: #b42318;
}

.saved-message {
  color: #166534;
}

.empty-state,
.empty-text {
  color: #4b5563;
}

.tasks-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 20px;
}

.task-lists {
  display: grid;
  gap: 22px;
}

.task-side {
  display: grid;
  align-content: start;
  gap: 12px;
}

.submit-mode-card {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.submit-mode-card span {
  color: #5b6472;
  font-size: 14px;
}

.submit-mode-card strong {
  color: #111827;
  font-size: 18px;
}

.submit-mode-card p {
  margin: 0;
  color: #4b5563;
  font-size: 14px;
  line-height: 1.6;
}

.user-field {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.user-field span {
  color: #5b6472;
  font-size: 14px;
}

section {
  min-width: 0;
}

.task-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 46px;
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid #d7dde5;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
}

.task-row:hover,
.task-row.selected {
  border-color: #2563eb;
  background: #eff6ff;
}

.task-row small {
  color: #5b6472;
  white-space: nowrap;
}

@media (max-width: 860px) {
  .page-header,
  .tasks-layout {
    grid-template-columns: 1fr;
  }

  .page-header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
