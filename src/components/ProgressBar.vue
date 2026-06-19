<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  percent: number;
  label?: string;
}>();

const safePercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(Number(props.percent) || 0))),
);
</script>

<template>
  <div class="progress-bar" aria-label="项目进度">
    <div class="progress-header">
      <span>{{ label || "基础进度" }}</span>
      <strong>{{ safePercent }}%</strong>
    </div>
    <div class="progress-track">
      <div class="progress-fill" :style="{ width: `${safePercent}%` }" />
    </div>
  </div>
</template>

<style scoped>
.progress-bar {
  display: grid;
  gap: 8px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: #4b5563;
  font-size: 14px;
}

.progress-header strong {
  color: #1f2937;
}

.progress-track {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: #e5e7eb;
}

.progress-fill {
  height: 100%;
  border-radius: inherit;
  background: #2563eb;
  transition: width 160ms ease;
}
</style>
