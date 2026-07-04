<script setup lang="ts">
defineProps<{
  selectedCount: number;
  hiddenSelectedCount?: number;
  filteredCount: number;
  itemUnit?: string;
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
      <strong>已选 {{ selectedCount }} {{ itemUnit ?? "项" }}</strong>
      <span v-if="hiddenSelectedCount">
        其中 {{ hiddenSelectedCount }} {{ itemUnit ?? "项" }}不在当前筛选结果中
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
  gap: var(--space-4);
  align-items: center;
  padding: var(--panel-padding-compact);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.selection-summary {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.selection-summary span,
.permission-message {
  color: var(--color-muted);
  font-size: var(--font-sm);
}

.selection-summary strong,
.selection-summary span,
.permission-message {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selection-actions,
.batch-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
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
  min-height: var(--control-md);
  padding: 0 var(--space-5);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--font-sm);
  cursor: pointer;
}

.primary-button {
  border: 0;
  background: var(--color-brand);
  color: var(--color-surface);
}

.secondary-button {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
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
