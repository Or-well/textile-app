<script setup lang="ts">
import { computed } from "vue";
import type { SyncStatus } from "../services/sync";

const props = defineProps<{
  status?: SyncStatus;
  isBusy?: boolean;
}>();

const emit = defineEmits<{
  sync: [];
  upload: [];
  exportChangePackage: [];
  viewConflict: [];
}>();

const lastSyncText = computed(() => {
  if (!props.status?.lastSyncAt) {
    return "暂无记录";
  }

  return new Date(props.status.lastSyncAt).toLocaleString();
});
</script>

<template>
  <section class="sync-panel">
    <h2>同步状态</h2>

    <template v-if="status">
      <p class="sync-title">{{ status.title }}</p>
      <p class="sync-message">{{ status.message }}</p>

      <p v-if="status.state === 'disabled'" class="fallback-message">
        当前环境暂不支持自动同步。你可以导出修改包交给负责人合并。
      </p>
      <p v-else-if="status.fallbackMessage" class="fallback-message">
        {{ status.fallbackMessage }}
      </p>

      <dl class="sync-details">
        <div>
          <dt>最近同步时间</dt>
          <dd>{{ lastSyncText }}</dd>
        </div>
        <div>
          <dt>本地修改</dt>
          <dd>{{ status.hasLocalChanges ? "有本地修改" : "暂无本地修改" }}</dd>
        </div>
        <div>
          <dt>项目新内容</dt>
          <dd>{{ status.hasRemoteChanges ? "有新内容" : "暂无新内容" }}</dd>
        </div>
        <div v-if="status.failureMessage">
          <dt>失败原因</dt>
          <dd>{{ status.failureMessage }}</dd>
        </div>
      </dl>

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
        <button
          type="button"
          :disabled="isBusy || !status.canExportChangePackage"
          @click="emit('exportChangePackage')"
        >
          导出修改包
        </button>
        <button
          type="button"
          :disabled="isBusy || !status.canResolveConflict"
          @click="emit('viewConflict')"
        >
          查看冲突
        </button>
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
p,
dl,
dd {
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

.sync-details {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
}

.sync-details div {
  min-width: 0;
  padding: 10px;
  border-radius: 6px;
  background: #f8fafb;
}

dt {
  color: #5b6472;
  font-size: 13px;
}

dd {
  margin-top: 4px;
  color: #1f2937;
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
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
