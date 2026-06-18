<script setup lang="ts">
import type { Task } from "../model/types";
import type { TaskProgress } from "../services/tasks";
import ProgressBar from "./ProgressBar.vue";

defineProps<{
  task?: Task;
  progress?: TaskProgress;
  isSubmitting?: boolean;
}>();

const emit = defineEmits<{
  submitTask: [taskId: string];
}>();
</script>

<template>
  <aside class="task-panel">
    <h3>当前任务</h3>

    <p v-if="!task" class="empty-text">未选择任务</p>

    <template v-else>
      <p class="task-title">{{ task.title }}</p>
      <p class="task-meta">状态：{{ task.status }}</p>
      <p class="task-meta">
        范围：{{ task.file_id }} 第 {{ task.range_start }}-{{ task.range_end }} 条
      </p>

      <ProgressBar
        v-if="progress"
        :percent="progress.progressPercent"
        label="任务进度"
      />

      <div v-if="progress" class="progress-counts">
        <span>总词条：{{ progress.totalEntries }}</span>
        <span>未翻译：{{ progress.untranslatedEntries }}</span>
        <span>已翻译：{{ progress.translatedEntries }}</span>
        <span>已校对：{{ progress.proofreadEntries }}</span>
        <span>已审核：{{ progress.reviewedEntries }}</span>
        <span>有争议：{{ progress.disputedEntries }}</span>
      </div>

      <button
        class="submit-button"
        type="button"
        :disabled="isSubmitting || task.status === 'submitted'"
        @click="emit('submitTask', task.id)"
      >
        {{ isSubmitting ? "提交中..." : "提交任务" }}
      </button>
    </template>
  </aside>
</template>

<style scoped>
.task-panel {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

h3,
.task-title,
.task-meta,
.empty-text {
  margin: 0;
}

h3 {
  font-size: 16px;
}

.task-title {
  font-weight: 700;
  line-height: 1.5;
}

.task-meta,
.empty-text,
.progress-counts {
  color: #4b5563;
  font-size: 14px;
  line-height: 1.6;
}

.progress-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
}

.submit-button {
  min-height: 40px;
  padding: 0 15px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: #ffffff;
  font-size: 15px;
  cursor: pointer;
}

.submit-button:disabled {
  cursor: wait;
  opacity: 0.68;
}
</style>
