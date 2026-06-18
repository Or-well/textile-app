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
  </nav>
</template>

<style scoped>
.project-sidebar {
  display: grid;
  align-content: start;
  gap: 6px;
  min-width: 180px;
  padding: 14px;
  border-right: 1px solid #dfe4ea;
  background: #f8fafb;
}

.nav-item {
  min-height: 38px;
  padding: 0 12px;
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
  background: #e6f0ef;
  color: #174346;
}

.nav-item.active {
  font-weight: 700;
}

@media (max-width: 840px) {
  .project-sidebar {
    display: flex;
    min-width: 0;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid #dfe4ea;
  }

  .nav-item {
    flex: 0 0 auto;
    white-space: nowrap;
  }
}
</style>
