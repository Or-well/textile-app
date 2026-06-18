<script setup lang="ts">
import { ref } from "vue";
import ProgressBar from "../components/ProgressBar.vue";
import { setEntriesProjectRoot } from "../services/entries";
import { openProject } from "../services/project";
import { getProjectStats, type BasicProjectStats } from "../services/stats";

const projectName = ref("");
const stats = ref<BasicProjectStats>();
const isLoading = ref(false);
const errorMessage = ref("");

async function handleOpenProject() {
  isLoading.value = true;
  errorMessage.value = "";
  stats.value = undefined;

  try {
    const project = await openProject();

    projectName.value = project.config.name;
    setEntriesProjectRoot(project.root);
    stats.value = await getProjectStats();
  } catch (error) {
    projectName.value = "";

    if (error instanceof DOMException && error.name === "AbortError") {
      errorMessage.value = "没有打开项目文件夹。你可以重新点击按钮选择项目。";
    } else if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = "项目统计加载失败。请确认选择的是项目根目录。";
    }
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <main class="project-page">
    <section class="project-panel">
      <div class="project-header">
        <div>
          <p class="eyebrow">项目首页</p>
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
      </div>

      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

      <div v-if="stats" class="stats-panel">
        <ProgressBar :percent="stats.progressPercent" label="项目进度" />

        <dl class="stats-grid">
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
      </div>

      <p v-else-if="!isLoading && !errorMessage" class="empty-state">
        请选择项目文件夹，查看基础统计。
      </p>
    </section>
  </main>
</template>

<style scoped>
.project-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px;
  background: #f6f7f9;
  color: #1f2937;
}

.project-panel {
  width: min(100%, 760px);
  padding: 28px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.project-header {
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

h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.2;
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
  margin: 22px 0 0;
  line-height: 1.7;
}

.error-message {
  color: #b42318;
}

.empty-state {
  color: #4b5563;
}

.stats-panel {
  display: grid;
  gap: 22px;
  margin-top: 24px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.stats-grid div {
  padding: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

dt {
  color: #5b6472;
  font-size: 13px;
}

dd {
  margin: 6px 0 0;
  font-size: 24px;
  font-weight: 700;
}

@media (max-width: 680px) {
  .project-header {
    align-items: stretch;
    flex-direction: column;
  }

  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
