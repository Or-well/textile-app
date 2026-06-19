<script setup lang="ts">
defineProps<{
  canExportChangePackage?: boolean;
  canImportChangePackage?: boolean;
  isBusy?: boolean;
}>();

const emit = defineEmits<{
  exportChangePackage: [];
  importChangePackage: [];
  viewPendingChanges: [];
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

    <p class="collaboration-note">成员导出修改包后交给负责人合并。</p>

    <div class="collaboration-actions">
      <button
        class="primary-button"
        type="button"
        :disabled="isBusy || !canExportChangePackage"
        @click="emit('exportChangePackage')"
      >
        导出修改包
      </button>
      <button
        class="secondary-button"
        type="button"
        :disabled="isBusy || !canImportChangePackage"
        @click="emit('importChangePackage')"
      >
        导入修改包
      </button>
      <button
        class="secondary-button"
        type="button"
        :disabled="isBusy"
        @click="emit('viewPendingChanges')"
      >
        查看待合并修改
      </button>
    </div>
  </section>
</template>

<style scoped>
.collaboration-panel {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

h2,
p,
dl,
dd {
  margin: 0;
}

h2 {
  color: #111827;
  font-size: 18px;
}

.collaboration-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.collaboration-summary div {
  padding: 12px;
  border-radius: 6px;
  background: #f8fafb;
}

.collaboration-summary dt {
  color: #5b6472;
  font-size: 13px;
}

.collaboration-summary dd {
  margin-top: 6px;
  color: #111827;
  font-size: 20px;
  font-weight: 700;
}

.collaboration-note {
  color: #5b6472;
  font-size: 14px;
  line-height: 1.6;
}

.collaboration-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.primary-button,
.secondary-button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 6px;
  font: inherit;
  font-size: 14px;
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
