<script setup lang="ts">
const props = defineProps<{
  title: string;
  description: string;
  eyebrow?: string;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  activate: [];
}>();

function handleClick() {
  if (props.disabled || props.busy) {
    return;
  }

  emit("activate");
}
</script>

<template>
  <button
    class="launcher-action-card"
    :class="{ primary, disabled }"
    type="button"
    :disabled="disabled || busy"
    @click="handleClick"
  >
    <span v-if="eyebrow" class="action-eyebrow">{{ eyebrow }}</span>
    <strong>{{ busy ? "正在处理..." : title }}</strong>
    <span>{{ description }}</span>
  </button>
</template>

<style scoped>
.launcher-action-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 12px;
  align-items: center;
  width: 100%;
  min-height: 64px;
  padding: 12px 14px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

.launcher-action-card:hover:not(:disabled) {
  border-color: #2f6f73;
  background: #f8fcfb;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

.launcher-action-card strong {
  grid-column: 1 / -1;
  color: #111827;
  font-size: 15px;
  line-height: 1.25;
}

.launcher-action-card span {
  grid-column: 1 / -1;
  color: #5b6472;
  font-size: 13px;
  line-height: 1.45;
}

.action-eyebrow {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  justify-self: end;
  padding: 3px 7px;
  border-radius: 999px;
  background: #eef2f7;
  color: #44515f !important;
  font-size: 12px !important;
  font-weight: 700;
}

.action-eyebrow + strong,
.action-eyebrow + strong + span {
  grid-column: 1;
}

.launcher-action-card.primary {
  border-color: #2f6f73;
  background: #f8fcfb;
  box-shadow: inset 4px 0 0 #2f6f73;
}

.launcher-action-card.primary strong {
  color: #174346;
}

.launcher-action-card.primary span {
  color: #4b5563;
}

.launcher-action-card.primary .action-eyebrow {
  background: #2f6f73;
  color: #ffffff !important;
}

.launcher-action-card.disabled {
  border-style: dashed;
  background: #f8fafb;
  box-shadow: none;
}

.launcher-action-card:disabled {
  cursor: not-allowed;
  opacity: 0.72;
  transform: none;
  box-shadow: none;
}
</style>
