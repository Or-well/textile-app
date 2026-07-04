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
  background: var(--color-shell);
  color: var(--color-text);
}

.workspace-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-7);
  min-height: 52px;
  padding: 0 20px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  color: var(--color-muted);
  font-size: var(--font-sm);
}

.breadcrumb button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-brand);
  font: inherit;
  cursor: pointer;
}

.breadcrumb button:disabled {
  color: var(--color-muted);
  cursor: default;
}

.breadcrumb strong {
  color: var(--color-heading);
}

.user-area {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: #4b5563;
  font-size: var(--font-sm);
  white-space: nowrap;
}

.user-area span {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-area button {
  min-height: var(--control-md);
  padding: 0 var(--space-5);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}

.workspace-body {
  display: grid;
  grid-template-columns: 204px minmax(0, 1fr);
  min-height: calc(100vh - 53px);
}

.workspace-content {
  min-width: 0;
  padding: 16px 18px 22px;
}

@media (max-width: 840px) {
  .workspace-header {
    padding: 0 var(--space-7);
  }

  .workspace-body {
    grid-template-columns: 1fr;
  }

  .workspace-content {
    padding: var(--space-7);
  }
}
</style>
