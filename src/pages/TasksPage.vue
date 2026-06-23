<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ProjectPageHeader from "../components/ProjectPageHeader.vue";
import TaskEditDialog from "../components/TaskEditDialog.vue";
import TaskListItem from "../components/TaskListItem.vue";
import TaskPanel from "../components/TaskPanel.vue";
import { buildMemberOptions } from "../model/memberOptions";
import { canTransitionTaskStatus } from "../model/taskStatus";
import type { Member, ProjectConfig, Task, TaskStatus } from "../model/types";
import {
  canAssignTask,
  canCompleteTask,
  canCreateTask,
  canDeleteTask,
  canManageTask,
  canReclaimTask,
  canReopenTask,
  canSubmitTask,
  canUpdateTask,
  canViewTask,
  getCurrentUser,
} from "../services/permissions";
import {
  assignTask,
  cancelTaskSubmission,
  completeTask,
  createTask,
  deleteTask,
  getTaskOpenTargets,
  getTaskProgress,
  loadTasks,
  reclaimTask,
  reopenTask,
  submitTask,
  updateTask,
  type TaskDraft,
  type TaskOpenTarget,
  type TaskProgress,
} from "../services/tasks";

type TaskFilter = "mine" | "all" | TaskStatus;

const props = defineProps<{
  project: ProjectConfig;
  members: Member[];
  currentUser?: Member | null;
}>();

const emit = defineEmits<{
  openTaskTarget: [fileId: string, entryId: string, entryIndex: number];
  tasksChanged: [];
}>();

const tasks = ref<Task[]>([]);
const selectedTask = ref<Task>();
const selectedProgress = ref<TaskProgress>();
const filter = ref<TaskFilter>("mine");
const memberFilter = ref("all");
const fileFilter = ref("all");
const isLoading = ref(false);
const isBusy = ref(false);
const errorMessage = ref("");
const savedMessage = ref("");
const dialogOpen = ref(false);
const dialogMode = ref<"create" | "edit">("create");
const editingTask = ref<Task>();
const openTargets = ref<TaskOpenTarget[]>([]);
const openTargetsDialogOpen = ref(false);
const openTargetsTaskTitle = ref("");

const currentUser = computed(() => props.currentUser ?? getCurrentUser());
const canView = computed(() => canViewTask(currentUser.value));
const canCreate = computed(() => canCreateTask(currentUser.value));
const memberFilterOptions = computed(() =>
  buildMemberOptions(
    props.members,
    tasks.value.map((task) => task.assignee),
  ),
);

const filters: Array<{ value: TaskFilter; label: string }> = [
  { value: "mine", label: "我的任务" },
  { value: "all", label: "全部任务" },
  { value: "unassigned", label: "未分配" },
  { value: "assigned", label: "已分配" },
  { value: "in_progress", label: "进行中" },
  { value: "submitted", label: "已提交" },
  { value: "completed", label: "已完成" },
];

const visibleTasks = computed(() => {
  return tasks.value.filter((task) => {
    if (filter.value === "mine" && task.assignee !== currentUser.value?.id) {
      return false;
    }

    if (filter.value !== "mine" && filter.value !== "all" && task.status !== filter.value) {
      return false;
    }

    if (memberFilter.value !== "all" && task.assignee !== memberFilter.value) {
      return false;
    }

    if (
      fileFilter.value !== "all" &&
      task.file_id !== fileFilter.value &&
      !task.file_ids?.includes(fileFilter.value)
    ) {
      return false;
    }

    return true;
  });
});

const selectedTaskActions = computed(() => {
  const task = selectedTask.value;
  const isAssignee = Boolean(task?.assignee && task.assignee === currentUser.value?.id);

  return {
    update: Boolean(task && canUpdateTask(currentUser.value)),
    assign: Boolean(task && canAssignTask(currentUser.value)),
    submit: Boolean(
      task &&
        canSubmitTask(currentUser.value) &&
        (isAssignee || canManageTask(currentUser.value)) &&
        canTransitionTaskStatus("submit", task.status),
    ),
    cancelSubmit: Boolean(
      task &&
        canSubmitTask(currentUser.value) &&
        (isAssignee || canManageTask(currentUser.value)) &&
        canTransitionTaskStatus("cancel_submit", task.status),
    ),
    complete: Boolean(
      task &&
        canCompleteTask(currentUser.value) &&
        canTransitionTaskStatus("complete", task.status),
    ),
    reclaim: Boolean(
      task &&
        canReclaimTask(currentUser.value) &&
        canTransitionTaskStatus("reclaim", task.status),
    ),
    delete: Boolean(task && canDeleteTask(currentUser.value)),
    reopen: Boolean(
      task &&
        canReopenTask(currentUser.value) &&
        canTransitionTaskStatus("reopen", task.status),
    ),
  };
});

function showSaved(message: string) {
  savedMessage.value = message;
  errorMessage.value = "";
}

function showError(error: unknown, fallback: string) {
  errorMessage.value = error instanceof Error ? error.message : fallback;
  savedMessage.value = "";
}

async function selectTask(task: Task) {
  selectedTask.value = task;
  savedMessage.value = "";

  try {
    selectedProgress.value = await getTaskProgress(task.id);
  } catch {
    selectedProgress.value = undefined;
  }
}

async function refreshTasks(preferredTaskId?: string) {
  if (!canView.value) {
    tasks.value = [];
    selectedTask.value = undefined;
    selectedProgress.value = undefined;
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    tasks.value = await loadTasks();
    const nextVisibleTasks = visibleTasks.value;
    const nextSelected =
      nextVisibleTasks.find((task) => task.id === preferredTaskId) ??
      nextVisibleTasks.find((task) => task.id === selectedTask.value?.id) ??
      nextVisibleTasks[0];

    if (nextSelected) {
      await selectTask(nextSelected);
    } else {
      selectedTask.value = undefined;
      selectedProgress.value = undefined;
    }
  } catch (error) {
    tasks.value = [];
    selectedTask.value = undefined;
    selectedProgress.value = undefined;
    showError(error, "任务列表加载失败。请确认项目数据可以读取。");
  } finally {
    isLoading.value = false;
  }
}

function openCreateDialog() {
  dialogMode.value = "create";
  editingTask.value = undefined;
  dialogOpen.value = true;
}

function openEditDialog(task: Task) {
  dialogMode.value = "edit";
  editingTask.value = task;
  dialogOpen.value = true;
}

async function handleSaveTask(draft: TaskDraft) {
  if (!currentUser.value) {
    errorMessage.value = "请先登录成员。";
    return;
  }

  isBusy.value = true;

  try {
    const savedTask =
      dialogMode.value === "create"
        ? await createTask(draft, currentUser.value.id)
        : await updateTask(editingTask.value?.id ?? "", draft);

    dialogOpen.value = false;
    await refreshTasks(savedTask.id);
    emit("tasksChanged");
    showSaved(dialogMode.value === "create" ? "任务已创建。" : "任务已保存。");
  } catch (error) {
    showError(error, "任务保存失败。请检查任务内容后再试。");
  } finally {
    isBusy.value = false;
  }
}

async function runTaskAction(
  action: () => Promise<Task | void>,
  successMessage: string,
) {
  isBusy.value = true;

  try {
    const updatedTask = await action();
    await refreshTasks(updatedTask && "id" in updatedTask ? updatedTask.id : undefined);
    emit("tasksChanged");
    showSaved(successMessage);
  } catch (error) {
    showError(error, "任务操作失败。请稍后再试。");
  } finally {
    isBusy.value = false;
  }
}

function handleAssignTask(taskId: string, assignee: string) {
  void runTaskAction(() => assignTask(taskId, assignee), "任务已分配。");
}

function handleSubmitTask(taskId: string) {
  void runTaskAction(() => submitTask(taskId), "任务已提交。");
}

function handleCancelTaskSubmission(taskId: string) {
  void runTaskAction(() => cancelTaskSubmission(taskId), "已取消提交。");
}

function handleCompleteTask(taskId: string) {
  void runTaskAction(() => completeTask(taskId), "任务已完成。");
}

function handleReclaimTask(taskId: string) {
  void runTaskAction(() => reclaimTask(taskId), "任务已回收。");
}

function handleReopenTask(taskId: string) {
  void runTaskAction(() => reopenTask(taskId), "任务已退回。");
}

function handleDeleteTask(taskId: string) {
  const confirmed = window.confirm("删除后需要从备份或修改包恢复。确认删除这个任务？");

  if (!confirmed) {
    return;
  }

  void runTaskAction(() => deleteTask(taskId), "任务已删除。");
}

function openResolvedTarget(target: TaskOpenTarget) {
  openTargetsDialogOpen.value = false;
  emit(
    "openTaskTarget",
    target.fileId,
    target.entryId,
    target.entryIndex,
  );
}

async function handleOpenTarget(task: Task) {
  try {
    const targets = await getTaskOpenTargets(task.id);

    if (targets.length === 0) {
      showError(undefined, "任务范围内没有可打开的词条。");
      return;
    }

    if (targets.length === 1) {
      openResolvedTarget(targets[0]);
      return;
    }

    openTargets.value = targets;
    openTargetsTaskTitle.value = task.title;
    openTargetsDialogOpen.value = true;
  } catch (error) {
    showError(error, "无法读取任务关联词条。");
  }
}

watch(
  () => [props.project.project_id, props.members.length, currentUser.value?.id],
  () => {
    void refreshTasks();
  },
  { immediate: true },
);

watch(visibleTasks, (nextTasks) => {
  if (!selectedTask.value || nextTasks.some((task) => task.id === selectedTask.value?.id)) {
    return;
  }

  if (nextTasks[0]) {
    void selectTask(nextTasks[0]);
  }
});
</script>

<template>
  <section class="tasks-page">
    <ProjectPageHeader
      eyebrow="任务管理"
      title="任务"
      summary="分配、跟踪和处理成员的翻译协作任务。"
    >
      <template #actions>
        <button
          v-if="canCreate"
          class="primary-button"
          type="button"
          :disabled="isBusy"
          @click="openCreateDialog"
        >
          创建任务
        </button>
      </template>
    </ProjectPageHeader>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="savedMessage" class="saved-message">{{ savedMessage }}</p>

    <p v-if="!canView" class="empty-state">当前成员没有查看任务的权限。</p>
    <p v-else-if="isLoading" class="empty-state">正在加载任务...</p>

    <section v-else class="tasks-layout">
      <aside class="task-filters">
        <h2>筛选</h2>
        <div class="filter-stack">
          <button
            v-for="item in filters"
            :key="item.value"
            class="filter-button"
            :class="{ selected: filter === item.value }"
            type="button"
            @click="filter = item.value"
          >
            {{ item.label }}
          </button>
        </div>

        <label>
          <span>成员</span>
          <select v-model="memberFilter">
            <option value="all">全部成员</option>
            <option value="">未分配</option>
            <option
              v-for="member in memberFilterOptions"
              :key="member.id"
              :value="member.id"
            >
              {{ member.label }}
            </option>
          </select>
        </label>

        <label>
          <span>文件</span>
          <select v-model="fileFilter">
            <option value="all">全部文件</option>
            <option value="">未关联文件</option>
            <option v-for="file in project.files" :key="file.id" :value="file.id">
              {{ file.name }}
            </option>
          </select>
        </label>
      </aside>

      <section class="task-list-column">
        <header class="list-header">
          <h2>任务列表</h2>
          <span>{{ visibleTasks.length }} / {{ tasks.length }}</span>
        </header>

        <div v-if="visibleTasks.length > 0" class="task-list">
          <TaskListItem
            v-for="task in visibleTasks"
            :key="task.id"
            :task="task"
            :selected="task.id === selectedTask?.id"
            :members="members"
            :files="project.files"
            :progress="task.id === selectedTask?.id ? selectedProgress : undefined"
            @select="selectTask"
          />
        </div>

        <p v-else class="empty-state compact">没有符合条件的任务。</p>
      </section>

      <TaskPanel
        :task="selectedTask"
        :progress="selectedProgress"
        :members="members"
        :files="project.files"
        :is-busy="isBusy"
        :actions="selectedTaskActions"
        @edit-task="openEditDialog"
        @delete-task="handleDeleteTask"
        @assign-task="handleAssignTask"
        @submit-task="handleSubmitTask"
        @cancel-task-submission="handleCancelTaskSubmission"
        @complete-task="handleCompleteTask"
        @reclaim-task="handleReclaimTask"
        @reopen-task="handleReopenTask"
        @open-target="handleOpenTarget"
      />
    </section>

    <TaskEditDialog
      :open="dialogOpen"
      :mode="dialogMode"
      :task="editingTask"
      :project="project"
      :members="members"
      @close="dialogOpen = false"
      @save="handleSaveTask"
    />

    <Teleport to="body">
      <div
        v-if="openTargetsDialogOpen"
        class="dialog-backdrop"
        role="presentation"
        @click.self="openTargetsDialogOpen = false"
      >
        <section
          class="target-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-target-dialog-title"
        >
          <header class="target-dialog-header">
            <div>
              <p>打开关联词条</p>
              <h2 id="task-target-dialog-title">{{ openTargetsTaskTitle }}</h2>
            </div>
            <button
              class="close-button"
              type="button"
              aria-label="关闭"
              @click="openTargetsDialogOpen = false"
            >
              ×
            </button>
          </header>
          <div class="target-options">
            <button
              v-for="target in openTargets"
              :key="target.fileId"
              class="target-option"
              type="button"
              @click="openResolvedTarget(target)"
            >
              <span>{{ target.fileName }}</span>
              <small>{{ target.entryCount }} 条任务词条</small>
            </button>
          </div>
          <footer class="target-dialog-actions">
            <button
              class="cancel-button"
              type="button"
              @click="openTargetsDialogOpen = false"
            >
              取消
            </button>
          </footer>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.tasks-page {
  display: grid;
  align-content: start;
  gap: 16px;
  min-height: calc(100vh - 108px);
}

h2,
.error-message,
.saved-message,
.empty-state {
  margin: 0;
}

h2 {
  color: #172033;
  font-size: 16px;
  line-height: 1.3;
}

.tasks-layout {
  display: grid;
  grid-template-columns: 220px minmax(320px, 1fr) minmax(400px, 430px);
  gap: 16px;
  min-height: 0;
}

.task-filters,
.task-list-column {
  display: grid;
  align-content: start;
  gap: 14px;
  min-width: 0;
  padding: 16px;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #ffffff;
}

.filter-stack {
  display: grid;
  gap: 6px;
}

.filter-button {
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid #d8dee8;
  border-radius: 6px;
  background: #ffffff;
  color: #172033;
  text-align: left;
  cursor: pointer;
}

.filter-button:hover,
.filter-button.selected {
  border-color: #2f6f73;
  background: #f1f8f7;
  color: #174346;
}

label {
  display: grid;
  gap: 6px;
}

label span {
  color: #5b6472;
  font-size: 13px;
}

select {
  min-height: 38px;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #172033;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.list-header span {
  color: #5b6472;
  font-size: 13px;
}

.task-list {
  display: grid;
  align-content: start;
  gap: 10px;
  max-height: calc(100vh - 210px);
  overflow: auto;
  padding-right: 2px;
}

.primary-button {
  min-height: 40px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  background: #2f6f73;
  color: #ffffff;
  font-size: 14px;
  cursor: pointer;
}

.primary-button:disabled {
  cursor: wait;
  opacity: 0.7;
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

.empty-state {
  padding: 16px;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #ffffff;
  color: #526071;
}

.empty-state.compact {
  padding: 12px;
}

@media (max-width: 1180px) {
  .tasks-layout {
    grid-template-columns: 1fr;
  }

  .task-list {
    max-height: none;
  }
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(17, 24, 39, 0.42);
}

.target-dialog {
  display: grid;
  gap: 14px;
  width: min(520px, 100%);
  max-height: min(640px, calc(100vh - 32px));
  padding: 16px;
  overflow: hidden;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.26);
}

.target-dialog-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: start;
  gap: 12px;
}

.target-dialog-header p,
.target-dialog-header h2 {
  margin: 0;
}

.target-dialog-header p {
  color: #5b6472;
  font-size: 13px;
}

.target-dialog-header h2 {
  margin-top: 4px;
  font-size: 18px;
  overflow-wrap: anywhere;
}

.close-button {
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid #ccd4df;
  border-radius: 6px;
  background: #ffffff;
  color: #344054;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.target-options {
  display: grid;
  gap: 8px;
  overflow: auto;
}

.target-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 8px 12px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #172033;
  text-align: left;
  cursor: pointer;
}

.target-option:hover {
  border-color: #2f6f73;
  background: #f1f8f7;
}

.target-option span {
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-option small {
  color: #5b6472;
  font-size: 12px;
  white-space: nowrap;
}

.target-dialog-actions {
  display: flex;
  justify-content: flex-end;
}

.cancel-button {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #172033;
  font-size: 14px;
  cursor: pointer;
}

</style>
