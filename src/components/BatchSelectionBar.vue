<script setup lang="ts">
defineProps<{
  selectedCount: number;
  hiddenSelectedCount?: number;
  filteredCount: number;
  busy?: boolean;
  submitDisabled?: boolean;
  submitLabel: string;
  permissionMessage?: string;
}>();

const emit = defineEmits<{
  selectAll: [];
  clear: [];
  submit: [];
}>();
</script>

<template>
  <section class="batch-selection-bar" aria-label="批量操作">
    <div class="selection-summary">
      <strong>已选 {{ selectedCount }} 项</strong>
      <span v-if="hiddenSelectedCount">
        其中 {{ hiddenSelectedCount }} 项不在当前筛选结果中
      </span>
    </div>

    <div class="selection-actions">
      <button
        type="button"
        class="secondary-button"
        :disabled="filteredCount === 0 || busy"
        @click="emit('selectAll')"
      >
        选择全部筛选结果
      </button>
      <button
        type="button"
        class="secondary-button"
        :disabled="selectedCount === 0 || busy"
        @click="emit('clear')"
      >
        清空选择
      </button>
    </div>

    <div v-if="!permissionMessage" class="batch-controls">
      <slot />
      <button
        type="button"
        class="primary-button"
        :disabled="selectedCount === 0 || submitDisabled || busy"
        @click="emit('submit')"
      >
        {{ busy ? "正在预检..." : submitLabel }}
      </button>
    </div>
    <p v-else class="permission-message">{{ permissionMessage }}</p>
  </section>
</template>

<style scoped>
.batch-selection-bar {
  display: grid;
  grid-template-columns: minmax(160px, auto) auto minmax(260px, 1fr);
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.selection-summary {
  display: grid;
  gap: 3px;
}

.selection-summary span,
.permission-message {
  color: #5b6472;
  font-size: 13px;
}

.selection-actions,
.batch-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.batch-controls {
  justify-content: flex-end;
  min-width: 0;
}

.permission-message {
  margin: 0;
  text-align: right;
}

.primary-button,
.secondary-button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.primary-button {
  border: 0;
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

@media (max-width: 960px) {
  .batch-selection-bar {
    grid-template-columns: 1fr;
  }

  .batch-controls,
  .permission-message {
    justify-content: flex-start;
    text-align: left;
  }
}
</style>
