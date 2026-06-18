<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Comment, Entry, ProjectConfig } from "../model/types";
import {
  loadDisputedEntries,
  loadRecentComments,
  resolveDispute,
  setCommentsProjectRoot,
} from "../services/comments";
import { setHistoryProjectRoot } from "../services/history";
import { canResolveDispute, getCurrentUser } from "../services/permissions";
import { openProject } from "../services/project";

const props = defineProps<{
  project?: ProjectConfig;
}>();

const projectName = ref("");
const disputedEntries = ref<Entry[]>([]);
const recentComments = ref<Comment[]>([]);
const selectedEntry = ref<Entry>();
const resolution = ref("");
const isLoading = ref(false);
const isResolving = ref(false);
const errorMessage = ref("");
const message = ref("");

const currentUser = computed(() => getCurrentUser());
const canResolveSelectedDispute = computed(() =>
  canResolveDispute(currentUser.value, selectedEntry.value),
);
const hasProjectContext = computed(() => Boolean(props.project));
const emptyStateText = computed(() =>
  projectName.value ? "当前项目暂无评论或争议。" : "请打开项目文件夹，查看评论与争议。",
);

async function refreshCommentsView() {
  disputedEntries.value = await loadDisputedEntries();
  recentComments.value = await loadRecentComments();

  if (
    selectedEntry.value &&
    !disputedEntries.value.some((entry) => entry.id === selectedEntry.value?.id)
  ) {
    selectedEntry.value = disputedEntries.value[0];
  }
}

async function initializeFromProjectContext() {
  if (!props.project) {
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";
  message.value = "";
  resolution.value = "";
  projectName.value = props.project.name;

  try {
    await refreshCommentsView();
    selectedEntry.value = disputedEntries.value[0];
  } catch (error) {
    disputedEntries.value = [];
    recentComments.value = [];
    selectedEntry.value = undefined;
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "评论与争议加载失败。请确认项目数据可以读取。";
  } finally {
    isLoading.value = false;
  }
}

async function handleOpenProject() {
  isLoading.value = true;
  errorMessage.value = "";
  message.value = "";
  resolution.value = "";

  try {
    const project = await openProject();

    projectName.value = project.config.name;
    setCommentsProjectRoot(project.root);
    setHistoryProjectRoot(project.root);
    await refreshCommentsView();
    selectedEntry.value = disputedEntries.value[0];
  } catch (error) {
    disputedEntries.value = [];
    recentComments.value = [];
    selectedEntry.value = undefined;

    if (error instanceof DOMException && error.name === "AbortError") {
      errorMessage.value = "没有打开项目文件夹。你可以重新点击按钮选择项目。";
    } else if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = "争议列表加载失败。请确认选择的是项目根目录。";
    }
  } finally {
    isLoading.value = false;
  }
}

function handleSelectEntry(entry: Entry) {
  selectedEntry.value = entry;
  resolution.value = "";
  message.value = "";
}

async function handleResolveDispute() {
  if (!selectedEntry.value) {
    return;
  }

  isResolving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    await resolveDispute(selectedEntry.value, resolution.value);
    resolution.value = "";
    await refreshCommentsView();
    message.value = "争议已解决。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "解决争议失败。请稍后再试。";
  } finally {
    isResolving.value = false;
  }
}

watch(
  () => props.project?.project_id,
  () => {
    void initializeFromProjectContext();
  },
  { immediate: true },
);
</script>

<template>
  <main class="comments-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">评论与争议</p>
        <h1>{{ projectName || "打开项目" }}</h1>
      </div>

      <button
        v-if="!hasProjectContext"
        class="open-button"
        type="button"
        :disabled="isLoading"
        @click="handleOpenProject"
      >
        {{ isLoading ? "正在加载..." : "打开项目文件夹" }}
      </button>
    </header>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="message" class="message">{{ message }}</p>

    <section v-if="projectName" class="comments-layout">
      <section class="dispute-list">
        <h2>争议词条</h2>
        <button
          v-for="entry in disputedEntries"
          :key="entry.id"
          class="entry-row"
          :class="{ selected: entry.id === selectedEntry?.id }"
          type="button"
          @click="handleSelectEntry(entry)"
        >
          <span>#{{ entry.index }} {{ entry.speaker || "旁白" }}</span>
          <small>{{ entry.source }}</small>
        </button>

        <p v-if="disputedEntries.length === 0" class="empty-text">
          暂无争议词条
        </p>
      </section>

      <section class="resolve-panel">
        <h2>处理争议</h2>
        <template v-if="selectedEntry">
          <p class="source-text">{{ selectedEntry.source }}</p>
          <p class="target-text">{{ selectedEntry.target || "未填写译文" }}</p>
          <label>
            <span>处理结论</span>
            <textarea
              v-model="resolution"
              rows="5"
              placeholder="写下处理结论"
              :disabled="isResolving"
            />
          </label>
          <button
            v-if="canResolveSelectedDispute"
            class="resolve-button"
            type="button"
            :disabled="isResolving"
            @click="handleResolveDispute"
          >
            {{ isResolving ? "处理中..." : "解决争议" }}
          </button>
          <p v-else class="empty-text">当前用户没有解决争议的权限。</p>
        </template>
        <p v-else class="empty-text">请选择一个争议词条。</p>
      </section>

      <section class="recent-comments">
        <h2>最近评论</h2>
        <ul v-if="recentComments.length > 0">
          <li v-for="comment in recentComments" :key="comment.id">
            <p>{{ comment.body }}</p>
            <small>{{ comment.user_id }} · {{ comment.created_at }}</small>
          </li>
        </ul>
        <p v-else class="empty-text">暂无评论</p>
      </section>
    </section>

    <p v-else-if="!isLoading && !errorMessage" class="empty-state">
      {{ emptyStateText }}
    </p>
  </main>
</template>

<style scoped>
.comments-page {
  min-height: 100vh;
  padding: 28px;
  background: #f6f7f9;
  color: #1f2937;
}

.page-header,
.comments-layout,
.error-message,
.message,
.empty-state {
  max-width: 1120px;
  margin-left: auto;
  margin-right: auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #5b6472;
  font-size: 14px;
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  font-size: 30px;
  line-height: 1.2;
}

h2 {
  margin-bottom: 12px;
  font-size: 18px;
}

.open-button,
.resolve-button {
  min-height: 42px;
  padding: 0 16px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: #ffffff;
  font-size: 15px;
  cursor: pointer;
}

button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.error-message,
.message,
.empty-state {
  line-height: 1.7;
}

.error-message {
  color: #b42318;
}

.message {
  color: #166534;
}

.empty-state,
.empty-text,
small {
  color: #4b5563;
}

.comments-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.8fr);
  gap: 20px;
}

.dispute-list,
.resolve-panel,
.recent-comments {
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.recent-comments {
  grid-column: 1 / -1;
}

.entry-row {
  display: grid;
  gap: 5px;
  width: 100%;
  min-height: 52px;
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid #d7dde5;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
}

.entry-row:hover,
.entry-row.selected {
  border-color: #2563eb;
  background: #eff6ff;
}

.source-text,
.target-text {
  line-height: 1.7;
}

.target-text {
  margin-top: 10px;
  color: #4b5563;
}

label {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

label span {
  color: #5b6472;
  font-size: 14px;
}

textarea {
  width: 100%;
  resize: vertical;
  padding: 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  font: inherit;
  line-height: 1.6;
}

.resolve-button {
  margin-top: 12px;
}

ul {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid #eef1f5;
  border-radius: 6px;
  background: #f9fafb;
}

@media (max-width: 860px) {
  .page-header,
  .comments-layout {
    grid-template-columns: 1fr;
  }

  .page-header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
