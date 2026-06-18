<script setup lang="ts">
import { computed, ref } from "vue";
import EntryList from "../components/EntryList.vue";
import type { Entry } from "../model/types";
import { openProject } from "../services/project";
import {
  getEntryById,
  loadEntries,
  setEntriesProjectRoot,
} from "../services/entries";

const entries = ref<Entry[]>([]);
const selectedEntry = ref<Entry>();
const projectName = ref("");
const isLoading = ref(false);
const errorMessage = ref("");

const hasEntries = computed(() => entries.value.length > 0);

async function handleOpenProject() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const project = await openProject();
    projectName.value = project.config.name;
    setEntriesProjectRoot(project.root);

    entries.value = await loadEntries("script_001");
    selectedEntry.value = entries.value[0];
  } catch (error) {
    entries.value = [];
    selectedEntry.value = undefined;

    if (error instanceof DOMException && error.name === "AbortError") {
      errorMessage.value = "没有打开项目文件夹。你可以重新点击按钮选择项目。";
    } else if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = "词条列表加载失败。请确认选择的是项目根目录。";
    }
  } finally {
    isLoading.value = false;
  }
}

async function handleSelectEntry(entry: Entry) {
  selectedEntry.value = await getEntryById(entry.id);
}
</script>

<template>
  <main class="entry-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">词条浏览</p>
        <h1>{{ projectName || "打开项目" }}</h1>
      </div>

      <button
        class="open-button"
        type="button"
        :disabled="isLoading"
        @click="handleOpenProject"
      >
        {{ isLoading ? "正在加载..." : "打开项目文件夹" }}
      </button>
    </header>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

    <section v-if="hasEntries" class="entry-workspace">
      <EntryList
        class="list-pane"
        :entries="entries"
        :selected-entry-id="selectedEntry?.id"
        @select="handleSelectEntry"
      />

      <article v-if="selectedEntry" class="detail-pane">
        <p class="detail-index">#{{ selectedEntry.index }}</p>
        <h2>{{ selectedEntry.speaker || "旁白" }}</h2>

        <dl>
          <div>
            <dt>原文</dt>
            <dd>{{ selectedEntry.source }}</dd>
          </div>
          <div>
            <dt>译文</dt>
            <dd>{{ selectedEntry.target || "未填写译文" }}</dd>
          </div>
          <div>
            <dt>上下文</dt>
            <dd>{{ selectedEntry.context || "无" }}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{{ selectedEntry.status }}</dd>
          </div>
          <div>
            <dt>键名</dt>
            <dd>{{ selectedEntry.key }}</dd>
          </div>
        </dl>
      </article>
    </section>

    <p v-else-if="!isLoading" class="empty-state">
      请选择样例项目文件夹，加载 script_001 的词条。
    </p>
  </main>
</template>

<style scoped>
.entry-page {
  min-height: 100vh;
  padding: 28px;
  background: #f6f7f9;
  color: #1f2937;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  max-width: 1180px;
  margin: 0 auto 20px;
}

.eyebrow,
.detail-index {
  margin: 0 0 6px;
  color: #5b6472;
  font-size: 14px;
}

h1,
h2 {
  margin: 0;
  line-height: 1.2;
}

h1 {
  font-size: 30px;
}

h2 {
  font-size: 22px;
}

.open-button {
  min-height: 42px;
  padding: 0 16px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: #ffffff;
  font-size: 15px;
  cursor: pointer;
}

.open-button:disabled {
  cursor: wait;
  opacity: 0.72;
}

.error-message,
.empty-state {
  max-width: 1180px;
  margin: 0 auto;
  line-height: 1.7;
}

.error-message {
  color: #b42318;
}

.empty-state {
  padding: 28px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #4b5563;
}

.entry-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
  gap: 20px;
  max-width: 1180px;
  margin: 0 auto;
}

.list-pane,
.detail-pane {
  min-width: 0;
}

.detail-pane {
  align-self: start;
  padding: 22px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

dl {
  display: grid;
  gap: 18px;
  margin: 24px 0 0;
}

dt {
  margin-bottom: 6px;
  color: #5b6472;
  font-size: 13px;
}

dd {
  margin: 0;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

@media (max-width: 900px) {
  .entry-page {
    padding: 18px;
  }

  .page-header,
  .entry-workspace {
    grid-template-columns: 1fr;
  }

  .page-header {
    align-items: stretch;
  }
}
</style>
