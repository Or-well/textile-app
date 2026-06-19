<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  percent: number;
  label?: string;
  valueText?: string;
  tone?: "primary" | "translation" | "proofread" | "review";
}>();

const safePercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(Number(props.percent) || 0))),
);

const displayValue = computed(() => props.valueText || `${safePercent.value}%`);
</script>

<template>
  <div
    :class="['progress-bar', `progress-bar--${tone || 'primary'}`]"
    role="progressbar"
    :aria-label="label || '基础进度'"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="safePercent"
    :aria-valuetext="displayValue"
  >
    <div class="progress-header">
      <span>{{ label || "基础进度" }}</span>
      <strong>{{ displayValue }}</strong>
    </div>
    <div class="progress-track">
      <div class="progress-fill" :style="{ width: `${safePercent}%` }" />
    </div>
  </div>
</template>

<style scoped>
.progress-bar {
  --progress-color: #2563eb;

  display: grid;
  gap: 8px;
}

.progress-bar--translation {
  --progress-color: #0f766e;
}

.progress-bar--proofread {
  --progress-color: #b45309;
}

.progress-bar--review {
  --progress-color: #be185d;
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
  background: var(--progress-color);
  transition: width 160ms ease;
}
</style>
