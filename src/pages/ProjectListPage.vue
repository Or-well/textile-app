<script setup lang="ts">
import { computed, ref } from "vue";
import LauncherActionCard from "../components/LauncherActionCard.vue";
import RecentProjectCard from "../components/RecentProjectCard.vue";
import type { RecentProjectRecord } from "../services/recentProjects";
import { formatDateTime } from "../utils/time";

interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  totalEntries: number;
  translatedPercent: number;
  reviewedPercent: number;
  memberCount: number;
  taskCount: number;
}

const props = defineProps<{
  currentProject?: ProjectSummary | null;
  recentProjects: RecentProjectRecord[];
  isOpening?: boolean;
  isOpeningFile?: boolean;
  isRestoring?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  createProject: [];
  openLocalProject: [];
  openProjectFile: [file: File];
  openRecentProject: [project: RecentProjectRecord];
  removeRecentProject: [projectId: string];
  enterCurrentProject: [];
}>();

const hasRecentProjects = computed(() => props.recentProjects.length > 0);
const projectFileInput = ref<HTMLInputElement | null>(null);

function getSourceTypeText(sourceType: RecentProjectRecord["sourceType"]): string {
  return sourceType === "folder" ? "文件夹" : ".hproj";
}

function handleSelectProjectFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (file) {
    emit("openProjectFile", file);
  }

  input.value = "";
}

</script>

<template>
  <main class="project-start-page">
    <section class="start-shell">
      <header class="start-header">
        <div>
          <p class="eyebrow">Textile</p>
          <h1>项目启动中心</h1>
          <p class="summary">
            创建新项目，打开本地项目文件夹，或从最近项目继续工作。
          </p>
        </div>

        <p v-if="isRestoring" class="restore-badge">正在恢复项目...</p>
      </header>

      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

      <div class="start-layout">
        <section class="action-panel">
          <header class="panel-heading">
            <p class="eyebrow">开始操作</p>
            <h2>选择工作入口</h2>
          </header>

          <LauncherActionCard
            :title="isOpening ? '正在打开...' : '打开项目文件夹'"
            description="选择包含项目配置的本地项目目录"
            :busy="isOpening"
            @activate="emit('openLocalProject')"
          />

          <LauncherActionCard
            :title="isOpeningFile ? '正在导入...' : '导入 .hproj 项目'"
            description="选择本地 .hproj 项目包并进入项目"
            :busy="isOpeningFile"
            @activate="projectFileInput?.click()"
          />
          <input
            ref="projectFileInput"
            class="hidden-file-input"
            type="file"
            accept=".hproj,application/zip"
            @change="handleSelectProjectFile"
          />

          <LauncherActionCard
            title="创建项目"
            description="新建一个空的本地汉化项目"
            @activate="emit('createProject')"
          />

          <section v-if="currentProject" class="current-project">
            <p class="eyebrow">当前已打开</p>
            <h3>{{ currentProject.name }}</h3>
            <p>{{ currentProject.description }}</p>
            <dl>
              <div>
                <dt>词条</dt>
                <dd>{{ currentProject.totalEntries }}</dd>
              </div>
              <div>
                <dt>翻译</dt>
                <dd>{{ currentProject.translatedPercent }}%</dd>
              </div>
              <div>
                <dt>审核</dt>
                <dd>{{ currentProject.reviewedPercent }}%</dd>
              </div>
            </dl>
            <button
              class="small-primary-button"
              type="button"
              @click="emit('enterCurrentProject')"
            >
              进入工作台
            </button>
          </section>
        </section>

        <section class="recent-panel">
          <header class="panel-header">
            <div>
              <p class="eyebrow">最近项目</p>
              <h2>继续工作</h2>
            </div>
          </header>

          <div v-if="hasRecentProjects" class="recent-list">
            <RecentProjectCard
              v-for="project in recentProjects"
              :key="project.projectId"
              :project="project"
              :source-label="getSourceTypeText(project.sourceType)"
              :last-opened-text="formatDateTime(project.lastOpenedAt)"
              :is-opening="isOpening"
              @open="emit('openRecentProject', $event)"
              @remove="emit('removeRecentProject', $event)"
            />
          </div>

          <section v-else class="empty-recent">
            <h3>暂无最近项目。</h3>
            <p>你可以创建新项目或打开已有项目。</p>
          </section>
        </section>
      </div>
    </section>
  </main>
</template>

<style scoped>
.project-start-page {
  min-height: 100vh;
  padding: 26px;
  background: #f1f4f6;
  color: #1f2937;
}

.start-shell {
  width: min(100%, 1180px);
  margin: 0 auto;
  display: grid;
  gap: 16px;
}

.start-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  min-height: 0;
}

.eyebrow,
h1,
h2,
h3,
p,
dl,
dd {
  margin: 0;
}

.eyebrow {
  color: #5b6472;
  font-size: 13px;
  font-weight: 700;
}

h1 {
  color: #111827;
  font-size: 28px;
  line-height: 1.2;
}

h2 {
  color: #111827;
  font-size: 20px;
  line-height: 1.25;
}

h3 {
  color: #111827;
  font-size: 17px;
  line-height: 1.3;
}

.summary {
  margin-top: 7px;
  max-width: 680px;
  color: #5b6472;
  line-height: 1.6;
}

.restore-badge {
  padding: 8px 10px;
  border: 1px solid #c7d2fe;
  border-radius: 999px;
  background: #eef2ff;
  color: #1e3a8a;
  font-size: 13px;
  font-weight: 700;
}

.error-message {
  padding: 12px 14px;
  border: 1px solid #f0b8aa;
  border-radius: 6px;
  background: #ffffff;
  color: #b42318;
  line-height: 1.6;
}

.start-layout {
  display: grid;
  grid-template-columns: 326px minmax(0, 1fr);
  align-items: start;
  gap: 18px;
}

.action-panel,
.recent-panel {
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.action-panel {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 16px;
}

.panel-heading {
  display: grid;
  gap: 5px;
  padding: 2px 0 6px;
  border-bottom: 1px solid #eef1f5;
}

.recent-panel {
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 500px;
  padding: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #eef1f5;
}

.current-project {
  display: grid;
  gap: 10px;
  margin-top: 4px;
  padding: 12px;
  border: 1px solid #cfe0dc;
  border-radius: 8px;
  background: #f8fcfb;
}

.current-project p,
.recent-main p,
.empty-recent p {
  color: #5b6472;
  line-height: 1.55;
}

dl {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

dt {
  color: #6b7280;
  font-size: 12px;
}

dd {
  margin-top: 2px;
  color: #111827;
  font-size: 13px;
  font-weight: 700;
}

dl div {
  min-width: 86px;
  padding: 7px 9px;
  border-radius: 6px;
  background: #f3f5f7;
}

.recent-list {
  display: grid;
  gap: 10px;
}

.small-primary-button,
.small-secondary-button {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.small-primary-button {
  border-color: #2f6f73;
  background: #2f6f73;
  color: #ffffff;
}

.small-secondary-button {
  border-color: #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

.empty-recent {
  display: grid;
  gap: 8px;
  min-height: 220px;
  align-content: center;
  padding: 24px;
  border: 1px dashed #c8d0dc;
  border-radius: 8px;
  background: #f8fafb;
  text-align: center;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.hidden-file-input {
  display: none;
}

@media (max-width: 900px) {
  .project-start-page {
    padding: 18px;
  }

  .start-header,
  .start-layout {
    grid-template-columns: 1fr;
  }

  .start-header {
    display: grid;
  }

  .recent-panel {
    min-height: 0;
  }
}
</style>
