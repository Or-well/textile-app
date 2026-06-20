<script setup lang="ts">
import { computed, ref, watch } from "vue";
import LauncherActionCard from "../components/LauncherActionCard.vue";
import RecentProjectCard from "../components/RecentProjectCard.vue";
import type { ProjectPackagePreview } from "../services/projectPackage";
import type { RecentProjectRecord } from "../services/recentProjects";
import { formatDateTime } from "../utils/time";

interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  totalEntries: number;
  translatedPercent: number;
  proofreadPercent: number;
  reviewedPercent: number;
  memberCount: number;
  taskCount: number;
}

const props = defineProps<{
  currentProject?: ProjectSummary | null;
  recentProjects: RecentProjectRecord[];
  isOpening?: boolean;
  isOpeningFile?: boolean;
  isPreviewingFile?: boolean;
  isRestoring?: boolean;
  errorMessage?: string;
  projectFilePreview?: ProjectPackagePreview | null;
}>();

const emit = defineEmits<{
  createProject: [];
  openLocalProject: [];
  importProjectFile: [file: File];
  previewProjectFile: [file: File];
  importPreviewedProjectFile: [];
  clearProjectFilePreview: [];
  openRecentProject: [project: RecentProjectRecord];
  removeRecentProject: [recordId: string];
  enterCurrentProject: [];
}>();

const hasRecentProjects = computed(() => props.recentProjects.length > 0);
const importProjectFileInput = ref<HTMLInputElement | null>(null);
const previewProjectFileInput = ref<HTMLInputElement | null>(null);
const isProjectDescriptionExpanded = ref(false);
const previewBadgeText = computed(() => {
  if (!props.projectFilePreview) {
    return "";
  }

  if (props.projectFilePreview.importStatus === "ready") {
    return "可导入";
  }

  if (props.projectFilePreview.importStatus === "warning") {
    return "需注意";
  }

  return "不可导入";
});
const previewBadgeClass = computed(() =>
  props.projectFilePreview
    ? `status-${props.projectFilePreview.importStatus}`
    : "",
);
const previewRevisionText = computed(
  () => props.projectFilePreview?.revision || "未记录",
);
const previewUpdatedAtText = computed(() => {
  const updatedAt = props.projectFilePreview?.updatedAt;

  if (!updatedAt) {
    return "未记录";
  }

  return formatDateTime(updatedAt) || "未记录";
});
const previewContentText = computed(() => {
  const preview = props.projectFilePreview;

  if (!preview) {
    return "";
  }

  return `${preview.projectFileCount} 文件 / ${preview.entryCount} 词条`;
});
const previewMemberText = computed(() => {
  const preview = props.projectFilePreview;

  if (!preview) {
    return "";
  }

  return preview.missingPaths.includes("members.json")
    ? "缺少成员数据"
    : String(preview.memberCount);
});
const previewLanguageText = computed(() => {
  const preview = props.projectFilePreview;

  if (!preview) {
    return "";
  }

  const sourceLanguage = preview.sourceLanguage || "-";
  const targetLanguage = preview.targetLanguage || "-";

  return `${sourceLanguage} -> ${targetLanguage}`;
});
const hasLongProjectDescription = computed(
  () => (props.projectFilePreview?.projectDescription.length ?? 0) > 72,
);

function getSourceTypeText(sourceType: RecentProjectRecord["sourceType"]): string {
  return sourceType === "folder" ? "Textile 项目文件夹" : "Textile 项目文件";
}

function handleSelectImportProjectFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (file) {
    emit("importProjectFile", file);
  }

  input.value = "";
}

function handleSelectPreviewProjectFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (file) {
    emit("previewProjectFile", file);
  }

  input.value = "";
}

function toggleProjectDescription() {
  isProjectDescriptionExpanded.value = !isProjectDescriptionExpanded.value;
}

watch(
  () => props.projectFilePreview?.fileName,
  () => {
    isProjectDescriptionExpanded.value = false;
  },
);

</script>

<template>
  <main class="project-start-page">
    <section class="start-shell">
      <header class="start-header">
        <div>
          <p class="eyebrow">Textile</p>
          <h1>Textile 项目启动中心</h1>
          <p class="summary">
            在 Textile 中创建新项目，打开本地项目文件夹，或从最近项目继续工作。
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
            :title="isOpening ? '正在打开...' : '打开 Textile 项目文件夹'"
            description="选择包含 Textile 项目配置的本地项目目录"
            :busy="isOpening"
            @activate="emit('openLocalProject')"
          />

          <LauncherActionCard
            :title="isOpeningFile ? '正在导入...' : '导入 Textile 项目文件'"
            description="选择 .hproj，再选择导入位置，生成本地项目文件夹"
            :busy="isOpeningFile"
            @activate="importProjectFileInput?.click()"
          />
          <input
            ref="importProjectFileInput"
            class="hidden-file-input"
            type="file"
            accept=".hproj,application/zip"
            @change="handleSelectImportProjectFile"
          />

          <LauncherActionCard
            :title="isPreviewingFile ? '正在预览...' : '预览 Textile 项目文件'"
            description="只读取 .hproj 摘要，不写入本地项目"
            :busy="isPreviewingFile"
            @activate="previewProjectFileInput?.click()"
          />
          <input
            ref="previewProjectFileInput"
            class="hidden-file-input"
            type="file"
            accept=".hproj,application/zip"
            @change="handleSelectPreviewProjectFile"
          />

          <section v-if="projectFilePreview" class="project-file-preview">
            <div class="preview-heading">
              <div>
                <p class="eyebrow">项目文件预览</p>
                <h3>{{ projectFilePreview.projectName || projectFilePreview.fileName }}</h3>
              </div>
              <div class="preview-heading-actions">
                <span :class="['preview-status-badge', previewBadgeClass]">
                  {{ previewBadgeText }}
                </span>
                <button
                  class="small-secondary-button"
                  type="button"
                  @click="emit('clearProjectFilePreview')"
                >
                  清除
                </button>
              </div>
            </div>

            <section
              v-if="projectFilePreview.projectDescription"
              class="preview-description"
            >
              <p class="preview-label">项目简介</p>
              <p
                :class="[
                  'preview-description-text',
                  { expanded: isProjectDescriptionExpanded },
                ]"
              >
                {{ projectFilePreview.projectDescription }}
              </p>
              <button
                v-if="hasLongProjectDescription"
                class="text-button"
                type="button"
                @click="toggleProjectDescription"
              >
                {{ isProjectDescriptionExpanded ? "收起" : "展开" }}
              </button>
            </section>

            <dl class="preview-grid">
              <div>
                <dt>项目修订</dt>
                <dd>{{ previewRevisionText }}</dd>
              </div>
              <div>
                <dt>更新时间</dt>
                <dd>{{ previewUpdatedAtText }}</dd>
              </div>
              <div>
                <dt>内容规模</dt>
                <dd>{{ previewContentText }}</dd>
              </div>
              <div>
                <dt>成员数</dt>
                <dd>{{ previewMemberText }}</dd>
              </div>
              <div>
                <dt>语言方向</dt>
                <dd>{{ previewLanguageText }}</dd>
              </div>
              <div>
                <dt>导入状态</dt>
                <dd>{{ projectFilePreview.importStatusText }}</dd>
              </div>
            </dl>

            <p class="preview-folder-name">
              导入后会创建文件夹：{{ projectFilePreview.suggestedFolderName }}
            </p>

            <p
              v-if="projectFilePreview.missingPaths.length > 0"
              class="preview-warning"
            >
              缺少：{{ projectFilePreview.missingPaths.join("、") }}
            </p>

            <ul v-if="projectFilePreview.warnings.length > 0" class="preview-list">
              <li v-for="warning in projectFilePreview.warnings" :key="warning">
                {{ warning }}
              </li>
            </ul>

            <button
              class="small-primary-button"
              type="button"
              :disabled="!projectFilePreview.valid || isOpeningFile"
              @click="emit('importPreviewedProjectFile')"
            >
              {{ isOpeningFile ? "正在导入..." : "导入为本地项目" }}
            </button>
          </section>

          <LauncherActionCard
            title="创建项目"
            description="新建一个空的 Textile 本地汉化项目"
            @activate="emit('createProject')"
          />

          <section v-if="currentProject" class="current-project">
            <p class="eyebrow">当前 Textile 项目</p>
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
                <dt>校对</dt>
                <dd>{{ currentProject.proofreadPercent }}%</dd>
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
              进入 Textile 工作台
            </button>
          </section>
        </section>

        <section class="recent-panel">
          <header class="panel-header">
            <div>
              <p class="eyebrow">最近 Textile 项目</p>
              <h2>继续工作</h2>
            </div>
          </header>

          <div v-if="hasRecentProjects" class="recent-list">
            <RecentProjectCard
              v-for="project in recentProjects"
              :key="project.recordId"
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

.project-file-preview {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #f8fafb;
}

.preview-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.preview-heading h3 {
  overflow-wrap: anywhere;
}

.preview-heading-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.preview-status-badge {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #374151;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.preview-status-badge.status-ready {
  border-color: #a8d3bd;
  background: #f0fdf4;
  color: #166534;
}

.preview-status-badge.status-warning {
  border-color: #f3d08a;
  background: #fffbeb;
  color: #92400e;
}

.preview-status-badge.status-blocked {
  border-color: #f0b8aa;
  background: #fff5f3;
  color: #b42318;
}

.preview-description {
  display: grid;
  gap: 6px;
}

.preview-label {
  color: #5b6472;
  font-size: 12px;
  font-weight: 700;
}

.preview-description-text {
  color: #4b5563;
  font-size: 13px;
  line-height: 1.55;
  overflow: hidden;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.preview-description-text.expanded {
  display: block;
  max-height: 140px;
  overflow: auto;
}

.text-button {
  justify-self: start;
  min-height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #2f6f73;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.preview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.preview-grid div {
  min-width: 0;
}

.preview-grid dd {
  overflow-wrap: anywhere;
}

.preview-folder-name,
.preview-warning,
.preview-list {
  color: #5b6472;
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.preview-warning {
  color: #b42318;
}

.preview-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
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
