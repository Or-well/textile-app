<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  buildMemberOptions,
  getMemberDisplayName,
} from "../model/memberOptions";
import { getTaskTypeLabel } from "../model/taskPresentation";
import type { Member, ProjectFile, Task } from "../model/types";
import type { TaskProgress } from "../services/tasks";
import {
  formatDateTime,
  getCurrentTimeZone,
  hasExplicitTimeZone,
} from "../utils/time";

const props = defineProps<{
  task?: Task;
  progress?: TaskProgress;
  members: Member[];
  files: ProjectFile[];
  isBusy?: boolean;
  actions: {
    update: boolean;
    assign: boolean;
    submit: boolean;
    cancelSubmit: boolean;
    complete: boolean;
    reclaim: boolean;
    delete: boolean;
    reopen: boolean;
  };
}>();

const emit = defineEmits<{
  editTask: [task: Task];
  deleteTask: [taskId: string];
  assignTask: [taskId: string, assignee: string];
  submitTask: [taskId: string];
  cancelTaskSubmission: [taskId: string];
  completeTask: [taskId: string];
  reclaimTask: [taskId: string];
  reopenTask: [taskId: string];
  openTarget: [task: Task];
}>();

const selectedAssignee = ref("");

const statusLabels: Record<Task["status"], string> = {
  unassigned: "未分配",
  assigned: "已分配",
  in_progress: "进行中",
  submitted: "已提交",
  completed: "已完成",
};

const submitMethodLabels: Record<Task["submit_method"], string> = {
  change_package: "导出修改包",
  owner_manual: "由负责人处理",
};

const assigneeName = computed(() => {
  return getMemberDisplayName(props.members, props.task?.assignee ?? "");
});
const assignmentOptions = computed(() =>
  buildMemberOptions(
    props.members,
    props.task?.assignee ? [props.task.assignee] : [],
  ),
);

const fileName = computed(() => {
  if (props.task?.file_ids?.length) {
    const names = props.task.file_ids.map(
      (fileId) =>
        props.files.find((file) => file.id === fileId)?.name || fileId,
    );

    return names.join("、");
  }

  if (!props.task?.file_id) {
    return "未关联文件";
  }

  return (
    props.files.find((file) => file.id === props.task?.file_id)?.name ||
    props.task.file_id
  );
});

const taskSummary = computed(() => {
  if (!props.task) {
    return "";
  }

  return `${getTaskTypeLabel(props.task.type)} · ${statusLabels[props.task.status]} · ${assigneeName.value}`;
});

const dueAtText = computed(() => {
  const value = props.task?.due_at;

  if (!value) {
    return "";
  }

  if (!hasExplicitTimeZone(value)) {
    return `${value.replace("T", " ")}（旧数据，时区未记录）`;
  }

  return formatDateTime(value, {
    includeTimeZone: true,
    seconds: false,
  });
});
const originalDueAtText = computed(() => {
  const task = props.task;

  if (
    !task?.due_at ||
    !task.due_time_zone ||
    task.due_time_zone === getCurrentTimeZone() ||
    !hasExplicitTimeZone(task.due_at)
  ) {
    return "";
  }

  return formatDateTime(task.due_at, {
    timeZone: task.due_time_zone,
    includeTimeZone: true,
    seconds: false,
  });
});

const progressPercent = computed(() => props.progress?.progressPercent ?? 0);

watch(
  () => props.task?.id,
  () => {
    selectedAssignee.value = props.task?.assignee ?? "";
  },
  { immediate: true },
);
</script>

<template>
  <aside class="task-work-order">
    <p v-if="!task" class="empty-text">从中间列表选择一个任务。</p>

    <template v-else>
      <header class="work-order-header">
        <div class="header-copy">
          <p class="section-label">任务详情</p>
          <h2>{{ task.title }}</h2>
          <p class="task-summary">{{ taskSummary }}</p>
        </div>
        <button
          v-if="actions.update"
          class="secondary-button edit-button"
          type="button"
          :disabled="isBusy"
          @click="emit('editTask', task)"
        >
          编辑
        </button>
      </header>

      <section class="range-card">
        <dl class="detail-grid">
          <div>
            <dt>文件</dt>
            <dd>{{ fileName }}</dd>
          </div>
          <div>
            <dt>范围</dt>
            <dd>
              {{
                task.entry_ids.length > 0
                  ? `指定 ${task.entry_ids.length} 条`
                  : task.file_ids?.length
                    ? "所选文件全部词条"
                    : `${task.range_start}-${task.range_end}`
              }}
            </dd>
          </div>
          <div>
            <dt>提交方式</dt>
            <dd>{{ submitMethodLabels[task.submit_method] }}</dd>
          </div>
          <div v-if="task.type === 'proofread' && task.proofread_round">
            <dt>校对轮次</dt>
            <dd>第 {{ task.proofread_round }} 轮</dd>
          </div>
          <div v-if="dueAtText">
            <dt>截止时间</dt>
            <dd>{{ dueAtText }}</dd>
            <small v-if="originalDueAtText">任务时区：{{ originalDueAtText }}</small>
          </div>
        </dl>
      </section>

      <section v-if="task.description || task.target" class="note-card">
        <p v-if="task.description">{{ task.description }}</p>
        <p v-if="task.target">目标：{{ task.target }}</p>
      </section>

      <button
        v-if="task.file_id || task.file_ids?.length || task.entry_ids.length"
        class="secondary-button open-entry-button"
        type="button"
        @click="emit('openTarget', task)"
      >
        打开关联词条
      </button>

      <section v-if="progress?.progressAvailable" class="progress-card">
        <div class="progress-heading">
          <span>{{ getTaskTypeLabel(task.type) }}任务进度</span>
          <strong>{{ progress.progressPercent }}%</strong>
        </div>
        <div class="progress-track" aria-label="任务进度">
          <span :style="{ width: `${progressPercent}%` }"></span>
        </div>
        <div class="stat-chips">
          <span>总 {{ progress.totalEntries }}</span>
          <span>未译 {{ progress.untranslatedEntries }}</span>
          <span>已译 {{ progress.translatedEntries }}</span>
          <span>校对 {{ progress.proofreadEntries }}</span>
          <span>审核 {{ progress.reviewedEntries }}</span>
          <span>争议 {{ progress.disputedEntries }}</span>
        </div>
      </section>

      <footer class="action-area">
        <div v-if="actions.assign" class="assign-row">
          <select v-model="selectedAssignee" :disabled="isBusy">
            <option value="">未分配</option>
            <option
              v-for="member in assignmentOptions"
              :key="member.id"
              :value="member.id"
              :disabled="!member.active"
            >
              {{ member.label }}
            </option>
          </select>
          <button
            class="secondary-button"
            type="button"
            :disabled="isBusy"
            @click="emit('assignTask', task.id, selectedAssignee)"
          >
            分配
          </button>
        </div>

        <div class="action-buttons">
          <button
            v-if="actions.submit"
            class="primary-button"
            type="button"
            :disabled="isBusy"
            @click="emit('submitTask', task.id)"
          >
            提交任务
          </button>
          <button
            v-if="actions.cancelSubmit"
            class="secondary-button"
            type="button"
            :disabled="isBusy"
            @click="emit('cancelTaskSubmission', task.id)"
          >
            取消提交
          </button>
          <button
            v-if="actions.complete"
            class="primary-button"
            type="button"
            :disabled="isBusy"
            @click="emit('completeTask', task.id)"
          >
            完成任务
          </button>
          <button
            v-if="actions.reopen"
            class="secondary-button"
            type="button"
            :disabled="isBusy"
            @click="emit('reopenTask', task.id)"
          >
            退回任务
          </button>
          <button
            v-if="actions.reclaim"
            class="secondary-button"
            type="button"
            :disabled="isBusy"
            @click="emit('reclaimTask', task.id)"
          >
            回收任务
          </button>
          <button
            v-if="actions.delete"
            class="danger-button"
            type="button"
            :disabled="isBusy"
            @click="emit('deleteTask', task.id)"
          >
            删除任务
          </button>
        </div>
      </footer>
    </template>
  </aside>
</template>

<style scoped>
.task-work-order {
  --task-action-width: 76px;
  --task-gap: 10px;
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
  padding: 18px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.work-order-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--task-action-width);
  gap: var(--task-gap);
  align-items: start;
}

.header-copy {
  min-width: 0;
}

.section-label,
.task-summary,
h2,
p,
dl,
dd {
  margin: 0;
}

.detail-grid small {
  display: block;
  margin-top: 4px;
  color: #5b6472;
  font-size: 12px;
  line-height: 1.45;
}

.section-label {
  color: #4f5f74;
  font-size: 14px;
  line-height: 1.4;
}

h2 {
  margin-top: 6px;
  color: #111827;
  font-size: 22px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.task-summary {
  margin-top: 4px;
  color: #4f5f74;
  font-size: 15px;
  line-height: 1.5;
}

.progress-card {
  border-radius: 8px;
  background: #f8fafb;
}

dt {
  color: #4f5f74;
  font-size: 13px;
  line-height: 1.4;
}

.range-card,
.note-card {
  padding: 12px;
  border: 1px solid #ccd4df;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
}

dd {
  margin-top: 6px;
  color: #1f2937;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.note-card {
  display: grid;
  gap: 8px;
}

.note-card p,
.empty-text {
  color: #4f5f74;
  font-size: 15px;
  line-height: 1.7;
}

.open-entry-button {
  justify-self: stretch;
  width: 100%;
}

.progress-card {
  display: grid;
  gap: 9px;
  padding: 12px;
}

.progress-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--task-gap);
  color: #4f5f74;
  font-size: 15px;
}

.progress-heading strong {
  color: #111827;
  font-size: 17px;
}

.progress-track {
  height: 8px;
  border-radius: 999px;
  background: #e7ecef;
  overflow: hidden;
}

.progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #2f6f73;
}

.stat-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.stat-chips span {
  padding: 3px 7px;
  border-radius: 999px;
  background: #ffffff;
  color: #5b6472;
  font-size: 12px;
  line-height: 1.35;
}

.action-area {
  display: grid;
  gap: 12px;
}

.assign-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--task-action-width);
  gap: var(--task-gap);
}

.action-buttons {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--task-gap);
}

select,
.primary-button,
.secondary-button,
.danger-button {
  min-height: 40px;
  padding: 0 14px;
  border-radius: 6px;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
}

select {
  min-width: 0;
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
  font-weight: 500;
}

.primary-button,
.secondary-button,
.danger-button {
  cursor: pointer;
  white-space: nowrap;
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

.edit-button {
  min-height: 38px;
  width: var(--task-action-width);
  padding: 0;
}

button:disabled,
select:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

select:focus,
button:focus-visible {
  outline: none;
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

@media (max-width: 720px) {
  .work-order-header,
  .detail-grid,
  .assign-row {
    grid-template-columns: 1fr;
  }

  .action-buttons {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .edit-button,
  .open-entry-button {
    justify-self: start;
    width: auto;
  }
}
</style>
