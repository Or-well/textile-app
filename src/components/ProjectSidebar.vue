<script setup lang="ts">
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
  activeSection: ProjectSection;
}>();

const emit = defineEmits<{
  navigate: [section: ProjectSection];
  openHelp: [];
}>();

const navItems: Array<{ section: ProjectSection; label: string }> = [
  { section: "overview", label: "概览" },
  { section: "files", label: "文件" },
  { section: "tasks", label: "任务" },
  { section: "terms", label: "术语" },
  { section: "comments", label: "评论" },
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
</script>

<template>
  <nav class="project-sidebar" aria-label="项目内导航">
    <p class="sidebar-title">项目工作台</p>
    <button
      v-for="item in navItems"
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
      帮助
    </button>
  </nav>
</template>

<style scoped>
.project-sidebar {
  display: grid;
  align-content: start;
  gap: 6px;
  min-width: 180px;
  padding: 16px 12px;
  border-right: 1px solid #dfe4ea;
  background: #ffffff;
}

.sidebar-title {
  margin: 0 0 8px;
  padding: 0 10px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
}

.nav-item {
  min-height: 40px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #374151;
  font: inherit;
  font-size: 14px;
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
  margin-top: 10px;
  border-top: 1px solid #eef1f5;
}

@media (max-width: 840px) {
  .project-sidebar {
    display: flex;
    min-width: 0;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid #dfe4ea;
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
