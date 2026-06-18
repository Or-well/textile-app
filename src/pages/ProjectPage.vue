<script setup lang="ts">
import { onMounted, ref } from "vue";
import ProgressBar from "../components/ProgressBar.vue";
import SyncStatusPanel from "../components/SyncStatusPanel.vue";
import type { ProjectConfig } from "../model/types";
import type { BasicProjectStats } from "../services/stats";
import {
  getSyncStatus,
  submitTaskWithSync,
  syncLatestProject,
  uploadMyChanges,
  type SyncStatus,
} from "../services/sync";

defineProps<{
  project: ProjectConfig;
  stats?: BasicProjectStats | null;
  taskCount: number;
}>();

const emit = defineEmits<{
  openFiles: [];
}>();

const syncStatus = ref<SyncStatus>();
const isSyncBusy = ref(false);
const syncMessage = ref("");
const syncErrorMessage = ref("");

async function refreshSyncStatus() {
  syncStatus.value = await getSyncStatus();
}

async function runSyncAction(action: () => Promise<{ message: string; fallbackMessage?: string }>) {
  isSyncBusy.value = true;
  syncMessage.value = "";
  syncErrorMessage.value = "";

  try {
    const result = await action();

    syncMessage.value = result.fallbackMessage
      ? `${result.message}${result.fallbackMessage}`
      : result.message;
    await refreshSyncStatus();
  } catch (error) {
    syncErrorMessage.value =
      error instanceof Error
        ? error.message
        : "同步操作失败。你可以先导出修改包，交给负责人合并。";
  } finally {
    isSyncBusy.value = false;
  }
}

onMounted(() => {
  void refreshSyncStatus();
});
</script>

<template>
  <section class="project-overview">
    <div class="page-title">
      <div>
        <p class="eyebrow">项目概览</p>
        <h1>{{ project.name }}</h1>
      </div>

      <button class="primary-button" type="button" @click="emit('openFiles')">
        查看文件
      </button>
    </div>

    <div class="overview-grid">
      <section class="overview-panel progress-panel">
        <h2>项目进度</h2>
        <ProgressBar
          v-if="stats"
          :percent="stats.progressPercent"
          label="总体完成"
        />
        <p v-else class="muted-text">正在准备项目统计。</p>
      </section>

      <section class="sync-overview-panel">
        <SyncStatusPanel
          :status="syncStatus"
          :is-busy="isSyncBusy"
          @sync="runSyncAction(syncLatestProject)"
          @upload="runSyncAction(uploadMyChanges)"
          @submit-task="runSyncAction(() => submitTaskWithSync('current_task'))"
        />
        <p v-if="syncMessage" class="sync-message">{{ syncMessage }}</p>
        <p v-if="syncErrorMessage" class="sync-error">{{ syncErrorMessage }}</p>
      </section>

      <section class="overview-panel">
        <h2>基础信息</h2>
        <dl>
          <div>
            <dt>源语言</dt>
            <dd>{{ project.source_language }}</dd>
          </div>
          <div>
            <dt>目标语言</dt>
            <dd>{{ project.target_language }}</dd>
          </div>
          <div>
            <dt>文件数</dt>
            <dd>{{ project.files.length }}</dd>
          </div>
          <div>
            <dt>任务数</dt>
            <dd>{{ taskCount }}</dd>
          </div>
        </dl>
      </section>

      <section v-if="stats" class="overview-panel stats-panel">
        <h2>词条统计</h2>
        <dl>
          <div>
            <dt>总词条</dt>
            <dd>{{ stats.totalEntries }}</dd>
          </div>
          <div>
            <dt>未翻译</dt>
            <dd>{{ stats.untranslatedEntries }}</dd>
          </div>
          <div>
            <dt>已翻译</dt>
            <dd>{{ stats.translatedEntries }}</dd>
          </div>
          <div>
            <dt>已校对</dt>
            <dd>{{ stats.proofreadEntries }}</dd>
          </div>
          <div>
            <dt>已审核</dt>
            <dd>{{ stats.reviewedEntries }}</dd>
          </div>
          <div>
            <dt>有争议</dt>
            <dd>{{ stats.disputedEntries }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </section>
</template>

<style scoped>
.project-overview {
  display: grid;
  gap: 18px;
}

.page-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #5b6472;
  font-size: 14px;
}

h1,
h2,
p,
dl,
dd {
  margin: 0;
}

h1 {
  color: #111827;
  font-size: 28px;
  line-height: 1.2;
}

h2 {
  color: #111827;
  font-size: 18px;
}

.primary-button {
  min-height: 40px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  background: #2f6f73;
  color: #ffffff;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.7fr);
  gap: 16px;
}

.overview-panel {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.stats-panel {
  grid-column: 1 / -1;
}

.sync-overview-panel {
  display: grid;
  gap: 10px;
}

.sync-message,
.sync-error {
  margin: 0;
  line-height: 1.6;
}

.sync-message {
  color: #166534;
}

.sync-error {
  color: #b42318;
}

dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

dl div {
  padding: 12px;
  border-radius: 6px;
  background: #f8fafb;
}

dt {
  color: #5b6472;
  font-size: 13px;
}

dd {
  margin-top: 6px;
  color: #111827;
  font-size: 20px;
  font-weight: 700;
}

.muted-text {
  color: #5b6472;
}

@media (max-width: 820px) {
  .page-title {
    align-items: stretch;
    flex-direction: column;
  }

  .overview-grid {
    grid-template-columns: 1fr;
  }
}
</style>
