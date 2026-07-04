<script setup lang="ts">
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
  activeSection: ProjectSection;
  tasksEnabled?: boolean;
}>();

const emit = defineEmits<{
  navigate: [section: ProjectSection];
  openHelp: [];
}>();

const navItems: Array<{ section: ProjectSection; label: string }> = [
  { section: "overview", label: "概览" },
  { section: "files", label: "文件" },
  { section: "entries", label: "词条" },
  { section: "tasks", label: "任务" },
  { section: "terms", label: "术语" },
  { section: "comments", label: "批注" },
  { section: "stats", label: "统计" },
  { section: "import-export", label: "导入导出" },
  { section: "settings", label: "设置" },
];

function isActive(section: ProjectSection): boolean {
  if (props.activeSection === "file-entry") {
    return section === "files";
  }

  return props.activeSection === section;
}

function isVisible(item: (typeof navItems)[number]): boolean {
  return item.section !== "tasks" || props.tasksEnabled !== false;
}
</script>

<template>
  <nav class="project-sidebar" aria-label="项目内导航">
    <p class="sidebar-title">项目工作台</p>
    <button
      v-for="item in navItems.filter(isVisible)"
      :key="item.section"
      class="nav-item"
      :class="{ active: isActive(item.section) }"
      type="button"
      @click="emit('navigate', item.section)"
    >
      {{ item.label }}
    </button>

    <button
      class="nav-item help-item"
      type="button"
      @click="emit('openHelp')"
    >
      使用手册
    </button>
  </nav>
</template>

<style scoped>
.project-sidebar {
  position: sticky;
  top: 68px;
  align-self: start;
  display: grid;
  align-content: start;
  gap: var(--space-2);
  min-width: 180px;
  max-height: calc(100vh - 84px);
  padding: var(--space-7) var(--space-5);
  overflow-y: auto;
  border-right: 1px solid #dfe4ea;
  background: var(--color-surface);
  scrollbar-gutter: stable;
}

.sidebar-title {
  margin: 0 0 var(--space-3);
  padding: 0 var(--space-4);
  color: #6b7280;
  font-size: var(--font-xs);
  font-weight: 700;
  letter-spacing: 0;
}

.nav-item {
  min-height: 42px;
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: #374151;
  font: inherit;
  font-size: var(--font-md);
  text-align: left;
  cursor: pointer;
}

.nav-item:hover,
.nav-item.active {
  background: #eef6f4;
  color: #194b4f;
}

.nav-item.active {
  font-weight: 700;
  box-shadow: inset 3px 0 0 #2f6f73;
}

.help-item {
  margin-top: var(--space-5);
  border-top: 1px solid #eef1f5;
}

@media (max-width: 840px) {
  .project-sidebar {
    position: static;
    display: flex;
    min-width: 0;
    max-height: none;
    overflow-y: visible;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid #dfe4ea;
    scrollbar-gutter: auto;
  }

  .sidebar-title {
    display: none;
  }

  .nav-item {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  .help-item {
    margin-top: 0;
    border-top: 0;
  }
}
</style>
