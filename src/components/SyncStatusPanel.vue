<script setup lang="ts">
import type { SyncStatus } from "../services/sync";

defineProps<{
  status?: SyncStatus;
  isBusy?: boolean;
}>();

const emit = defineEmits<{
  sync: [];
  upload: [];
  submitTask: [];
}>();
</script>

<template>
  <section class="sync-panel">
    <h2>同步状态</h2>

    <template v-if="status">
      <p class="sync-title">{{ status.title }}</p>
      <p class="sync-message">{{ status.message }}</p>
      <p v-if="status.fallbackMessage" class="fallback-message">
        {{ status.fallbackMessage }}
      </p>

      <div class="sync-actions">
        <button
          type="button"
          :disabled="isBusy || !status.canSync"
          @click="emit('sync')"
        >
          同步项目
        </button>
        <button
          type="button"
          :disabled="isBusy || !status.canUpload"
          @click="emit('upload')"
        >
          上传修改
        </button>
        <button type="button" :disabled="isBusy" @click="emit('submitTask')">
          提交任务
        </button>
        <button type="button" disabled>导出修改包</button>
      </div>
    </template>

    <p v-else class="sync-message">打开项目后显示同步状态。</p>
  </section>
</template>

<style scoped>
.sync-panel {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

h2,
p {
  margin: 0;
}

h2 {
  font-size: 18px;
}

.sync-title {
  font-weight: 700;
}

.sync-message {
  color: #4b5563;
  line-height: 1.6;
}

.fallback-message {
  color: #b45309;
  line-height: 1.6;
}

.sync-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

button {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font-size: 14px;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.64;
}
</style>
