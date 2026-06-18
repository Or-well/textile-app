<script setup lang="ts">
defineProps<{
  name: string;
  description: string;
  totalEntries: number;
  translatedPercent: number;
  reviewedPercent: number;
  memberCount?: number;
  taskCount?: number;
  disabled?: boolean;
  actionLabel?: string;
}>();

const emit = defineEmits<{
  open: [];
}>();
</script>

<template>
  <button
    class="project-card"
    type="button"
    :disabled="disabled"
    @click="emit('open')"
  >
    <span class="card-title">{{ name }}</span>
    <span class="card-description">{{ description }}</span>

    <span class="progress-row">
      <span>已翻译</span>
      <strong>{{ translatedPercent }}%</strong>
    </span>
    <span class="meter" aria-hidden="true">
      <span :style="{ width: `${translatedPercent}%` }" />
    </span>

    <span class="progress-row">
      <span>已审核</span>
      <strong>{{ reviewedPercent }}%</strong>
    </span>
    <span class="meter review-meter" aria-hidden="true">
      <span :style="{ width: `${reviewedPercent}%` }" />
    </span>

    <span class="card-meta">
      <span>{{ totalEntries }} 词条</span>
      <span v-if="memberCount !== undefined">{{ memberCount }} 成员</span>
      <span v-if="taskCount !== undefined">{{ taskCount }} 任务</span>
    </span>

    <span class="card-action">{{ actionLabel || "进入项目" }}</span>
  </button>
</template>

<style scoped>
.project-card {
  display: grid;
  gap: 12px;
  min-height: 250px;
  padding: 18px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
}

.project-card:hover:not(:disabled) {
  border-color: #2f6f73;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
}

.project-card:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.card-title {
  color: #111827;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.25;
}

.card-description {
  min-height: 44px;
  color: #5b6472;
  font-size: 14px;
  line-height: 1.55;
}

.progress-row,
.card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #4b5563;
  font-size: 13px;
}

.progress-row strong {
  color: #111827;
}

.meter {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: #edf0f4;
}

.meter span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #2f6f73;
}

.review-meter span {
  background: #6b7f2a;
}

.card-meta {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.card-meta span {
  padding: 4px 8px;
  border-radius: 999px;
  background: #f3f5f7;
}

.card-action {
  align-self: end;
  color: #2f6f73;
  font-size: 14px;
  font-weight: 700;
}
</style>
