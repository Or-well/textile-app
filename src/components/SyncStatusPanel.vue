<script setup lang="ts">
defineProps<{
  canExportChangePackage?: boolean;
  canImportChangePackage?: boolean;
  isBusy?: boolean;
}>();

const emit = defineEmits<{
  exportChangePackage: [];
  importChangePackage: [];
}>();
</script>

<template>
  <section class="collaboration-panel">
    <h2>协作与备份</h2>

    <dl class="collaboration-summary">
      <div>
        <dt>协作方式</dt>
        <dd>修改包</dd>
      </div>
    </dl>

    <p class="collaboration-note">
      成员导出普通修改包，负责人合并后发布项目更新包。
    </p>

    <div class="collaboration-actions">
      <button
        class="primary-button"
        type="button"
        :disabled="isBusy || !canExportChangePackage"
        @click="emit('exportChangePackage')"
      >
        导出普通修改包
      </button>
      <button
        class="secondary-button"
        type="button"
        :disabled="isBusy || !canImportChangePackage"
        @click="emit('importChangePackage')"
      >
        导入修改包
      </button>
    </div>
  </section>
</template>

<style scoped>
.collaboration-panel {
  display: grid;
  gap: var(--space-4);
  padding: var(--panel-padding);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

h2,
p,
dl,
dd {
  margin: 0;
}

h2 {
  color: var(--color-heading);
  font-size: 16px;
}

.collaboration-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--space-4);
}

.collaboration-summary div {
  padding: var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
}

.collaboration-summary dt {
  color: #5b6472;
  font-size: 13px;
}

.collaboration-summary dd {
  margin-top: var(--space-1);
  color: var(--color-heading);
  font-size: 18px;
  font-weight: 700;
}

.collaboration-note {
  color: var(--color-muted);
  font-size: var(--font-sm);
  line-height: 1.5;
}

.collaboration-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.primary-button,
.secondary-button {
  min-height: var(--control-md);
  padding: 0 var(--space-5);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--font-sm);
  font-weight: 700;
  cursor: pointer;
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

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}
</style>
