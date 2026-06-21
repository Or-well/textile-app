<script setup lang="ts">
import ProjectSidebar from "./ProjectSidebar.vue";
import type { Member, ProjectConfig } from "../model/types";

type ProjectSection =
  | "overview"
  | "files"
  | "entries"
  | "tasks"
  | "terms"
  | "comments"
  | "stats"
  | "import-export"
  | "settings"
  | "file-entry";

const props = defineProps<{
  project?: ProjectConfig;
  currentUser?: Member | null;
  activeSection: ProjectSection;
  fileId?: string;
}>();

const emit = defineEmits<{
  navigateProjectList: [];
  navigateSection: [section: ProjectSection];
  openHelp: [];
  logout: [];
}>();

const sectionLabels: Record<ProjectSection, string> = {
  overview: "概览",
  files: "文件",
  entries: "词条",
  tasks: "任务",
  terms: "术语",
  comments: "批注",
  stats: "统计",
  "import-export": "导入导出",
  settings: "设置",
  "file-entry": "词条编辑",
};
</script>

<template>
  <main class="project-layout">
    <header class="workspace-header">
      <nav class="breadcrumb" aria-label="面包屑">
        <button type="button" @click="emit('navigateProjectList')">
          项目
        </button>
        <span>/</span>
        <button
          type="button"
          :disabled="!project"
          @click="emit('navigateSection', 'overview')"
        >
          {{ project?.name || "未打开项目" }}
        </button>
        <span>/</span>
        <button
          v-if="activeSection === 'file-entry'"
          type="button"
          @click="emit('navigateSection', 'files')"
        >
          文件
        </button>
        <template v-if="activeSection === 'file-entry'">
          <span>/</span>
          <strong>{{ fileId || "词条编辑" }}</strong>
        </template>
        <strong v-else>{{ sectionLabels[activeSection] }}</strong>
      </nav>

      <div v-if="props.currentUser" class="user-area">
        <span>{{ props.currentUser.name }}</span>
        <button type="button" @click="emit('logout')">
          退出登录
        </button>
      </div>
    </header>

    <div class="workspace-body">
      <ProjectSidebar
        :active-section="activeSection"
        :tasks-enabled="project?.settings.workflow?.enable_tasks !== false"
        @navigate="emit('navigateSection', $event)"
        @open-help="emit('openHelp')"
      />

      <section class="workspace-content">
        <slot />
      </section>
    </div>
  </main>
</template>

<style scoped>
.project-layout {
  min-height: 100vh;
  background: #f1f4f6;
  color: #1f2937;
}

.workspace-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 56px;
  padding: 0 26px;
  border-bottom: 1px solid #d7dde5;
  background: #ffffff;
}

.breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: #5b6472;
  font-size: 14px;
}

.breadcrumb button {
  padding: 0;
  border: 0;
  background: transparent;
  color: #2f6f73;
  font: inherit;
  cursor: pointer;
}

.breadcrumb button:disabled {
  color: #5b6472;
  cursor: default;
}

.breadcrumb strong {
  color: #111827;
}

.user-area {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #4b5563;
  font-size: 14px;
  white-space: nowrap;
}

.user-area span {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-area button {
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  cursor: pointer;
}

.workspace-body {
  display: grid;
  grid-template-columns: 216px minmax(0, 1fr);
  min-height: calc(100vh - 57px);
}

.workspace-content {
  min-width: 0;
  padding: 22px 24px 28px;
}

@media (max-width: 840px) {
  .workspace-header {
    padding: 0 16px;
  }

  .workspace-body {
    grid-template-columns: 1fr;
  }

  .workspace-content {
    padding: 16px;
  }
}
</style>
