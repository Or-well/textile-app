<script setup lang="ts">
import { computed } from "vue";
import ProgressBar from "../components/ProgressBar.vue";
import SyncStatusPanel from "../components/SyncStatusPanel.vue";
import type { ProjectConfig } from "../model/types";
import {
  canExportMemberChangePackage,
  canExportProjectUpdatePackage,
  canImportMemberChangePackage,
  canImportProjectUpdatePackage,
  getCurrentUser,
} from "../services/permissions";
import type { BasicProjectStats } from "../services/stats";

defineProps<{
  project: ProjectConfig;
  stats?: BasicProjectStats | null;
  taskCount: number;
}>();

const emit = defineEmits<{
  openFiles: [];
  openImportExport: [];
}>();

const canExportPackage = computed(
  () =>
    canExportMemberChangePackage(getCurrentUser()) ||
    canExportProjectUpdatePackage(getCurrentUser()),
);
const canImportPackage = computed(
  () =>
    canImportMemberChangePackage(getCurrentUser()) ||
    canImportProjectUpdatePackage(getCurrentUser()),
);
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
        <div v-if="stats" class="progress-grid">
          <ProgressBar
            :percent="stats.progressPercent"
            label="综合进度"
            tone="primary"
          />
          <ProgressBar
            :percent="stats.translationProgress"
            label="翻译进度"
            tone="translation"
          />
          <ProgressBar
            :percent="stats.proofreadProgress"
            label="校对进度"
            tone="proofread"
          />
          <ProgressBar
            :percent="stats.reviewRequired ? stats.reviewProgress : 0"
            label="审核进度"
            :value-text="stats.reviewRequired ? undefined : '未启用审核'"
            tone="review"
          />
        </div>
        <p v-else class="muted-text">正在准备项目统计。</p>
      </section>

      <section class="collaboration-overview-panel">
        <SyncStatusPanel
          :can-export-change-package="canExportPackage"
          :can-import-change-package="canImportPackage"
          @export-change-package="emit('openImportExport')"
          @import-change-package="emit('openImportExport')"
          @view-pending-changes="emit('openImportExport')"
        />
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

.progress-panel {
  align-content: start;
}

.progress-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 22px;
}

.stats-panel {
  grid-column: 1 / -1;
}

.collaboration-overview-panel {
  display: grid;
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

  .progress-grid {
    grid-template-columns: 1fr;
  }
}
</style>
