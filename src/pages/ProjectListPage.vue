<script setup lang="ts">
import { computed } from "vue";
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
  openProjectFile: [];
  importProject: [];
  openRecentProject: [project: RecentProjectRecord];
  removeRecentProject: [projectId: string];
  enterCurrentProject: [];
}>();

const hasRecentProjects = computed(() => props.recentProjects.length > 0);

function getSourceTypeText(sourceType: RecentProjectRecord["sourceType"]): string {
  return sourceType === "folder" ? "文件夹" : ".hproj";
}

function getLastUserText(record: RecentProjectRecord): string {
  return record.lastUserId ? record.lastUserId : "暂无";
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
          <h2>开始</h2>

          <button
            class="action-button primary-action"
            type="button"
            @click="emit('createProject')"
          >
            <strong>创建项目</strong>
            <span>生成新的本地项目结构和 owner 账号</span>
          </button>

          <button
            class="action-button"
            type="button"
            :disabled="isOpening"
            @click="emit('openLocalProject')"
          >
            <strong>{{ isOpening ? "正在打开..." : "打开项目文件夹" }}</strong>
            <span>选择包含 project.json 的本地项目目录</span>
          </button>

          <button
            class="action-button"
            type="button"
            :disabled="isOpeningFile"
            @click="emit('openProjectFile')"
          >
            <strong>{{ isOpeningFile ? "正在打开..." : "打开 .hproj 项目文件" }}</strong>
            <span>单文件项目入口，当前版本显示支持计划</span>
          </button>

          <button
            class="action-button"
            type="button"
            @click="emit('importProject')"
          >
            <strong>导入项目 / 修改包</strong>
            <span>已有项目内的导入导出页继续处理修改包</span>
          </button>

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
            <article
              v-for="project in recentProjects"
              :key="project.projectId"
              class="recent-row"
            >
              <div class="recent-main">
                <div class="recent-title-row">
                  <h3>{{ project.name }}</h3>
                  <span>{{ getSourceTypeText(project.sourceType) }}</span>
                </div>
                <p>{{ project.displayPath }}</p>
                <dl>
                  <div>
                    <dt>上次打开</dt>
                    <dd>{{ formatDateTime(project.lastOpenedAt) }}</dd>
                  </div>
                  <div>
                    <dt>上次登录用户</dt>
                    <dd>{{ getLastUserText(project) }}</dd>
                  </div>
                </dl>
              </div>

              <div class="recent-actions">
                <button
                  class="small-primary-button"
                  type="button"
                  :disabled="isOpening"
                  @click="emit('openRecentProject', project)"
                >
                  快速打开
                </button>
                <button
                  class="small-secondary-button"
                  type="button"
                  @click="emit('removeRecentProject', project.projectId)"
                >
                  从列表移除
                </button>
              </div>
            </article>
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
  padding: 28px;
  background: #eef2f5;
  color: #1f2937;
}

.start-shell {
  width: min(100%, 1220px);
  margin: 0 auto;
}

.start-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;
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
  margin-top: 5px;
  color: #111827;
  font-size: 32px;
  line-height: 1.2;
}

h2 {
  color: #111827;
  font-size: 22px;
  line-height: 1.25;
}

h3 {
  color: #111827;
  font-size: 17px;
  line-height: 1.3;
}

.summary {
  margin-top: 9px;
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
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid #f0b8aa;
  border-radius: 6px;
  background: #ffffff;
  color: #b42318;
  line-height: 1.6;
}

.start-layout {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
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
  padding: 18px;
}

.recent-panel {
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 18px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #eef1f5;
}

.action-button {
  display: grid;
  gap: 5px;
  width: 100%;
  min-height: 76px;
  padding: 14px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.action-button strong {
  color: #111827;
  font-size: 16px;
}

.action-button span {
  color: #5b6472;
  font-size: 13px;
  line-height: 1.45;
}

.action-button:hover:not(:disabled) {
  border-color: #2f6f73;
  background: #f8fcfb;
}

.primary-action {
  border-color: #2f6f73;
  background: #2f6f73;
}

.primary-action strong,
.primary-action span {
  color: #ffffff;
}

.current-project {
  display: grid;
  gap: 10px;
  margin-top: 8px;
  padding: 14px;
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

.recent-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 14px;
  border: 1px solid #e1e6ee;
  border-radius: 8px;
  background: #ffffff;
}

.recent-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}

.recent-title-row span {
  padding: 3px 7px;
  border-radius: 999px;
  background: #e8f3f1;
  color: #194b4f;
  font-size: 12px;
  font-weight: 700;
}

.recent-main {
  min-width: 0;
}

.recent-main p {
  overflow-wrap: anywhere;
  font-size: 14px;
}

.recent-main dl {
  margin-top: 10px;
}

.recent-actions {
  display: grid;
  gap: 8px;
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

@media (max-width: 900px) {
  .project-start-page {
    padding: 18px;
  }

  .start-header,
  .start-layout,
  .recent-row {
    grid-template-columns: 1fr;
  }

  .start-header {
    display: grid;
  }

  .recent-actions {
    display: flex;
    flex-wrap: wrap;
  }
}
</style>
