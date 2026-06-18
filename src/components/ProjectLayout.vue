<script setup lang="ts">
import ProjectSidebar from "./ProjectSidebar.vue";
import type { ProjectConfig } from "../model/types";

type ProjectSection =
  | "overview"
  | "files"
  | "tasks"
  | "terms"
  | "comments"
  | "stats"
  | "import-export"
  | "settings"
  | "file-entry";

const props = defineProps<{
  project?: ProjectConfig;
  activeSection: ProjectSection;
  fileId?: string;
}>();

const emit = defineEmits<{
  navigateProjectList: [];
  navigateSection: [section: ProjectSection];
}>();

const sectionLabels: Record<ProjectSection, string> = {
  overview: "概览",
  files: "文件",
  tasks: "任务",
  terms: "术语",
  comments: "评论",
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
          项目列表
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
        <strong>{{ fileId || sectionLabels[activeSection] }}</strong>
      </nav>
    </header>

    <div class="workspace-body">
      <ProjectSidebar
        :active-section="activeSection"
        @navigate="emit('navigateSection', $event)"
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
  background: #eef2f5;
  color: #1f2937;
}

.workspace-header {
  display: flex;
  align-items: center;
  min-height: 58px;
  padding: 0 24px;
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

.workspace-body {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  min-height: calc(100vh - 59px);
}

.workspace-content {
  min-width: 0;
  padding: 24px;
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
