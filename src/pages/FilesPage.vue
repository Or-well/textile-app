<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import ProgressBar from "../components/ProgressBar.vue";
import type { Entry, ProjectConfig, ProjectFile } from "../model/types";
import { loadEntries } from "../services/entries";

interface FileSummary {
  file: ProjectFile;
  totalEntries: number;
  untranslatedEntries: number;
  disputedEntries: number;
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
const searchText = ref("");
const sortKey = ref<"name" | "updated" | "translated" | "reviewed">("name");
const statusFilter = ref<"all" | "needs-work" | "reviewed" | "disputed">("all");
const isLoading = ref(false);
const errorMessage = ref("");

const visibleFiles = computed(() => {
  const keyword = searchText.value.trim().toLowerCase();
  const files = fileSummaries.value.filter((summary) => {
    if (summary.file.hidden) {
      return false;
    }

    if (
      keyword &&
      !summary.file.name.toLowerCase().includes(keyword) &&
      !summary.file.id.toLowerCase().includes(keyword)
    ) {
      return false;
    }

    if (statusFilter.value === "needs-work") {
      return summary.translatedPercent < 100;
    }

    if (statusFilter.value === "reviewed") {
      return summary.reviewedPercent === 100;
    }

    if (statusFilter.value === "disputed") {
      return summary.disputedEntries > 0;
    }

    return true;
  });

  return [...files].sort((a, b) => {
    if (sortKey.value === "updated") {
      return b.updatedAt.localeCompare(a.updatedAt);
    }

    if (sortKey.value === "translated") {
      return b.translatedPercent - a.translatedPercent;
    }

    if (sortKey.value === "reviewed") {
      return b.reviewedPercent - a.reviewedPercent;
    }

    return a.file.name.localeCompare(b.file.name);
  });
});

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
        const untranslatedEntries = count(entries, "untranslated");
        const disputedEntries = count(entries, "disputed");
        const translatedEntries =
          count(entries, "translated") +
          count(entries, "proofread") +
          count(entries, "reviewed");
        const reviewedEntries = count(entries, "reviewed");

        return {
          file,
          totalEntries,
          untranslatedEntries,
          disputedEntries,
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

    <section class="file-toolbar">
      <label>
        <span>搜索</span>
        <input v-model="searchText" type="search" placeholder="搜索文件" />
      </label>

      <label>
        <span>排序</span>
        <select v-model="sortKey">
          <option value="name">按文件名</option>
          <option value="updated">按更新时间</option>
          <option value="translated">按翻译进度</option>
          <option value="reviewed">按审核进度</option>
        </select>
      </label>

      <label>
        <span>筛选</span>
        <select v-model="statusFilter">
          <option value="all">全部</option>
          <option value="needs-work">未翻译</option>
          <option value="reviewed">已审核完成</option>
          <option value="disputed">有争议</option>
        </select>
      </label>
    </section>

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
          <small>
            {{ summary.file.type }} · {{ summary.totalEntries }} 词条
            <template v-if="summary.untranslatedEntries > 0">
              · {{ summary.untranslatedEntries }} 未翻译
            </template>
            <template v-if="summary.disputedEntries > 0">
              · {{ summary.disputedEntries }} 争议
            </template>
          </small>
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
  gap: 16px;
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

.file-toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(160px, 220px) minmax(160px, 220px);
  gap: 12px;
  padding: 12px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.file-toolbar label {
  display: grid;
  gap: 6px;
}

.file-toolbar span {
  color: #5b6472;
  font-size: 13px;
}

.file-toolbar input,
.file-toolbar select {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
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
  grid-template-columns: minmax(260px, 1.1fr) minmax(150px, 0.55fr) minmax(150px, 0.55fr) minmax(160px, 0.5fr);
  gap: 16px;
  align-items: center;
  width: 100%;
  min-height: 74px;
  padding: 14px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
}

.file-row:hover {
  border-color: #2f6f73;
  background: #f8fcfb;
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
  .file-toolbar,
  .file-row {
    grid-template-columns: 1fr;
  }
}
</style>
