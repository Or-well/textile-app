<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import ProgressBar from "../components/ProgressBar.vue";
import type { ProjectConfig } from "../model/types";
import { getProjectStats, type BasicProjectStats } from "../services/stats";

const props = defineProps<{
  project?: ProjectConfig;
}>();

const stats = ref<BasicProjectStats>();
const isLoading = ref(false);
const errorMessage = ref("");

const statusRows = computed(() => {
  if (!stats.value) {
    return [];
  }

  return [
    { label: "未翻译", value: stats.value.untranslatedEntries },
    { label: "已翻译", value: stats.value.translatedEntries },
    { label: "已校对", value: stats.value.proofreadEntries },
    { label: "已审核", value: stats.value.reviewedEntries },
    { label: "有争议", value: stats.value.disputedEntries },
  ];
});

async function loadStats() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    stats.value = await getProjectStats(
      undefined,
      props.project?.settings.progress_weights,
    );
  } catch (error) {
    stats.value = undefined;
    errorMessage.value =
      error instanceof Error ? error.message : "统计数据无法读取。";
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadStats);

watch(
  () => props.project?.settings.progress_weights,
  () => {
    void loadStats();
  },
);
</script>

<template>
  <section class="stats-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">统计</p>
        <h1>统计</h1>
        <p class="summary">查看当前项目的翻译进度和词条状态分布。</p>
      </div>
    </header>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-else-if="isLoading" class="empty-state">正在加载统计...</p>

    <template v-else-if="stats">
      <section class="progress-panel">
        <h2>综合进度</h2>
        <ProgressBar :percent="stats.progressPercent" label="总进度" />
        <p class="weight-note">
          权重：翻译 {{ Math.round(stats.progressWeights.translationWeight * 100) }}% /
          校对 {{ Math.round(stats.progressWeights.proofreadWeight * 100) }}% /
          审核 {{ Math.round(stats.progressWeights.reviewWeight * 100) }}%
        </p>
      </section>

      <section class="progress-panel progress-grid">
        <ProgressBar :percent="stats.translationProgress" label="翻译进度" />
        <ProgressBar :percent="stats.proofreadProgress" label="校对进度" />
        <ProgressBar :percent="stats.reviewProgress" label="审核进度" />
      </section>

      <section class="stats-grid">
        <div>
          <span>总词条数</span>
          <strong>{{ stats.totalEntries }}</strong>
        </div>
        <div>
          <span>未翻译</span>
          <strong>{{ stats.untranslatedEntries }}</strong>
        </div>
        <div>
          <span>已翻译</span>
          <strong>{{ stats.translatedEntries }}</strong>
        </div>
        <div>
          <span>已校对</span>
          <strong>{{ stats.proofreadEntries }}</strong>
        </div>
        <div>
          <span>已审核</span>
          <strong>{{ stats.reviewedEntries }}</strong>
        </div>
        <div>
          <span>有争议</span>
          <strong>{{ stats.disputedEntries }}</strong>
        </div>
      </section>

      <section class="distribution-panel">
        <h2>状态分布</h2>
        <div class="distribution-list">
          <div v-for="row in statusRows" :key="row.label" class="status-row">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
      </section>
    </template>

    <p v-else class="empty-state">暂无统计数据。</p>
  </section>
</template>

<style scoped>
.stats-page {
  display: grid;
  gap: 16px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.eyebrow,
.summary,
.weight-note,
.stats-grid span,
.status-row span {
  color: #5b6472;
}

.eyebrow,
h1,
h2,
.summary,
p {
  margin: 0;
}

.eyebrow {
  margin-bottom: 6px;
  font-size: 14px;
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

.summary {
  margin-top: 8px;
  line-height: 1.7;
}

.error-message {
  color: #b42318;
  line-height: 1.7;
}

.empty-state,
.progress-panel,
.distribution-panel {
  padding: 18px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.empty-state {
  color: #4b5563;
  line-height: 1.7;
}

.progress-panel,
.distribution-panel {
  display: grid;
  gap: 14px;
}

.progress-grid {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.weight-note {
  line-height: 1.6;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.stats-grid div {
  display: grid;
  gap: 6px;
  padding: 14px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.stats-grid span,
.status-row span {
  font-size: 13px;
}

.stats-grid strong {
  color: #111827;
  font-size: 26px;
  line-height: 1.1;
}

.distribution-list {
  display: grid;
  gap: 8px;
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 42px;
  padding: 0 12px;
  border-radius: 6px;
  background: #f8fafb;
}

.status-row strong {
  color: #111827;
}
</style>
