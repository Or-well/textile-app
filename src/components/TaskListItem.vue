<script setup lang="ts">
import { getMemberDisplayName } from "../model/memberOptions";
import { getTaskTypeLabel } from "../model/taskPresentation";
import type { Member, ProjectFile, Task } from "../model/types";
import type { TaskProgress } from "../services/tasks";

const props = defineProps<{
  task: Task;
  selected?: boolean;
  members: Member[];
  files: ProjectFile[];
  progress?: TaskProgress;
}>();

const emit = defineEmits<{
  select: [task: Task];
}>();

const statusLabels: Record<Task["status"], string> = {
  unassigned: "未分配",
  assigned: "已分配",
  in_progress: "进行中",
  submitted: "已提交",
  completed: "已完成",
};

function getMemberName(memberId: string): string {
  return getMemberDisplayName(props.members, memberId);
}

function getFileName(fileId: string): string {
  return props.files.find((file) => file.id === fileId)?.name || fileId || "未关联文件";
}

function getTaskFileText(task: Task): string {
  if (task.file_ids?.length) {
    return task.file_ids
      .map((fileId) => getFileName(fileId))
      .join("、");
  }

  return getFileName(task.file_id);
}
</script>

<template>
  <button
    class="task-item"
    :class="{ selected }"
    type="button"
    @click="emit('select', task)"
  >
    <span class="task-title">{{ task.title }}</span>
    <span class="task-meta">
      <span>{{ getTaskTypeLabel(task.type) }}</span>
      <span>{{ statusLabels[task.status] }}</span>
      <span>{{ getMemberName(task.assignee) }}</span>
    </span>
    <span class="task-target">
      {{ getTaskFileText(task) }}
      <template v-if="task.entry_ids.length > 0"> · 指定 {{ task.entry_ids.length }} 条</template>
      <template v-else-if="task.file_ids?.length"> · 全部词条</template>
      <template v-else-if="task.file_id"> · {{ task.range_start }}-{{ task.range_end }}</template>
    </span>
    <span
      v-if="progress?.progressAvailable"
      class="progress-track"
      aria-label="任务进度"
    >
      <span :style="{ width: `${progress.progressPercent}%` }"></span>
    </span>
  </button>
</template>

<style scoped>
.task-item {
  display: grid;
  gap: 8px;
  width: 100%;
  min-height: 96px;
  padding: 12px;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #ffffff;
  color: #172033;
  text-align: left;
  cursor: pointer;
}

.task-item:hover,
.task-item.selected {
  border-color: #2f6f73;
  background: #f1f8f7;
}

.task-title {
  overflow: hidden;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.task-meta span {
  padding: 2px 7px;
  border-radius: 999px;
  background: #eef2f5;
  color: #526071;
  font-size: 12px;
}

.task-target {
  color: #526071;
  font-size: 13px;
  line-height: 1.4;
}

.progress-track {
  display: block;
  height: 6px;
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
</style>
