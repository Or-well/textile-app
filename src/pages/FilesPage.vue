<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import ProgressBar from "../components/ProgressBar.vue";
import type { Entry, ProjectConfig, ProjectFile } from "../model/types";
import { loadEntries } from "../services/entries";

interface FileSummary {
  file: ProjectFile;
  totalEntries: number;
  translatedPercent: number;
  reviewedPercent: number;
  updatedAt: string;
}

const props = defineProps<{
  project: ProjectConfig;
}>();

const emit = defineEmits<{
  openFile: [fileId: string];
}>();

const fileSummaries = ref<FileSummary[]>([]);
const isLoading = ref(false);
const errorMessage = ref("");

const visibleFiles = computed(() =>
  fileSummaries.value.filter((summary) => !summary.file.hidden),
);

function count(entries: Entry[], status: Entry["status"]): number {
  return entries.filter((entry) => entry.status === status).length;
}

function latestUpdatedAt(entries: Entry[]): string {
  const latest = entries
    .map((entry) => entry.updated_at)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0];

  return latest || "暂无记录";
}

async function loadFileSummaries() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const summaries = await Promise.all(
      props.project.files.map(async (file) => {
        const entries = await loadEntries(file.id);
        const totalEntries = entries.length;
        const translatedEntries =
          count(entries, "translated") +
          count(entries, "proofread") +
          count(entries, "reviewed");
        const reviewedEntries = count(entries, "reviewed");

        return {
          file,
          totalEntries,
          translatedPercent:
            totalEntries === 0
              ? 0
              : Math.round((translatedEntries / totalEntries) * 100),
          reviewedPercent:
            totalEntries === 0
              ? 0
              : Math.round((reviewedEntries / totalEntries) * 100),
          updatedAt: latestUpdatedAt(entries),
        };
      }),
    );

    fileSummaries.value = summaries;
  } catch (error) {
    fileSummaries.value = [];
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "文件列表加载失败。请确认项目数据可以读取。";
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadFileSummaries);

watch(
  () => props.project.project_id,
  () => {
    void loadFileSummaries();
  },
);
</script>

<template>
  <section class="files-page">
    <div class="page-title">
      <div>
        <p class="eyebrow">项目文件</p>
        <h1>文件</h1>
      </div>
      <span class="file-count">{{ visibleFiles.length }} 个文件</span>
    </div>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-else-if="isLoading" class="empty-state">正在加载文件列表...</p>

    <div v-else-if="visibleFiles.length > 0" class="file-list">
      <button
        v-for="summary in visibleFiles"
        :key="summary.file.id"
        class="file-row"
        type="button"
        @click="emit('openFile', summary.file.id)"
      >
        <span class="file-main">
          <strong>{{ summary.file.name }}</strong>
          <small>{{ summary.file.type }} · {{ summary.totalEntries }} 词条</small>
        </span>

        <span class="file-progress">
          <ProgressBar :percent="summary.translatedPercent" label="已翻译" />
        </span>

        <span class="file-progress">
          <ProgressBar :percent="summary.reviewedPercent" label="已审核" />
        </span>

        <span class="file-updated">{{ summary.updatedAt }}</span>
      </button>
    </div>

    <p v-else class="empty-state">这个项目还没有可显示的文件。</p>
  </section>
</template>

<style scoped>
.files-page {
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
p {
  margin: 0;
}

h1 {
  color: #111827;
  font-size: 28px;
  line-height: 1.2;
}

.file-count {
  padding: 5px 10px;
  border-radius: 999px;
  background: #e6f0ef;
  color: #174346;
  font-size: 13px;
  font-weight: 700;
}

.error-message {
  color: #b42318;
  line-height: 1.7;
}

.empty-state {
  padding: 18px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #4b5563;
}

.file-list {
  display: grid;
  gap: 10px;
}

.file-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(160px, 0.7fr) minmax(160px, 0.7fr) minmax(160px, 0.6fr);
  gap: 16px;
  align-items: center;
  width: 100%;
  min-height: 74px;
  padding: 14px 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
}

.file-row:hover {
  border-color: #2f6f73;
  background: #fbfdfc;
}

.file-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.file-main strong {
  overflow: hidden;
  color: #111827;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-main small,
.file-updated {
  color: #5b6472;
  font-size: 13px;
}

.file-progress {
  min-width: 0;
}

@media (max-width: 980px) {
  .file-row {
    grid-template-columns: 1fr;
  }
}
</style>
