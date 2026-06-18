<script setup lang="ts">
import { computed, ref } from "vue";
import ProjectCard from "../components/ProjectCard.vue";

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
  isOpening?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  openLocalProject: [];
  enterCurrentProject: [];
}>();

const searchText = ref("");
const selectedCategory = ref<"mine" | "all">("mine");

const visibleCurrentProject = computed(() => {
  if (!props.currentProject) {
    return null;
  }

  const keyword = searchText.value.trim().toLowerCase();

  if (!keyword) {
    return props.currentProject;
  }

  return props.currentProject.name.toLowerCase().includes(keyword) ||
    props.currentProject.description.toLowerCase().includes(keyword)
    ? props.currentProject
    : null;
});
</script>

<template>
  <main class="project-list-page">
    <header class="list-header">
      <div>
        <p class="eyebrow">项目</p>
        <h1>我的项目</h1>
      </div>

      <button
        class="primary-button"
        type="button"
        :disabled="isOpening"
        @click="emit('openLocalProject')"
      >
        {{ isOpening ? "正在打开..." : "打开本地项目" }}
      </button>
    </header>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

    <div class="project-list-layout">
      <aside class="project-filter">
        <label>
          <span>搜索项目</span>
          <input v-model="searchText" type="search" placeholder="输入项目名" />
        </label>

        <button
          class="filter-button"
          :class="{ active: selectedCategory === 'mine' }"
          type="button"
          @click="selectedCategory = 'mine'"
        >
          我的项目
        </button>
        <button
          class="filter-button"
          :class="{ active: selectedCategory === 'all' }"
          type="button"
          @click="selectedCategory = 'all'"
        >
          所有项目
        </button>
      </aside>

      <section class="project-grid" aria-label="项目列表">
        <ProjectCard
          v-if="visibleCurrentProject"
          :name="visibleCurrentProject.name"
          :description="visibleCurrentProject.description"
          :total-entries="visibleCurrentProject.totalEntries"
          :translated-percent="visibleCurrentProject.translatedPercent"
          :reviewed-percent="visibleCurrentProject.reviewedPercent"
          :member-count="visibleCurrentProject.memberCount"
          :task-count="visibleCurrentProject.taskCount"
          action-label="进入文件页"
          @open="emit('enterCurrentProject')"
        />

        <ProjectCard
          v-if="!currentProject && selectedCategory === 'all'"
          name="样例汉化项目"
          description="选择 examples/simple-project 文件夹后，可以作为本地样例项目打开。"
          :total-entries="0"
          :translated-percent="0"
          :reviewed-percent="0"
          :member-count="0"
          :task-count="0"
          disabled
          action-label="请用打开本地项目选择样例目录"
        />

        <section v-if="!visibleCurrentProject" class="empty-projects">
          <h2>还没有打开的本地项目</h2>
          <p>
            点击“打开本地项目”，选择项目根目录后，它会出现在这里，并进入项目工作台。
          </p>
        </section>
      </section>
    </div>
  </main>
</template>

<style scoped>
.project-list-page {
  min-height: 100vh;
  padding: 28px;
  background: #eef2f5;
  color: #1f2937;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  max-width: 1180px;
  margin: 0 auto 20px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #5b6472;
  font-size: 14px;
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  color: #111827;
  font-size: 30px;
  line-height: 1.2;
}

h2 {
  color: #111827;
  font-size: 20px;
}

.primary-button {
  min-height: 42px;
  padding: 0 16px;
  border: 0;
  border-radius: 6px;
  background: #2f6f73;
  color: #ffffff;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}

.primary-button:disabled {
  cursor: wait;
  opacity: 0.72;
}

.error-message {
  max-width: 1180px;
  margin: 0 auto 18px;
  color: #b42318;
  line-height: 1.7;
}

.project-list-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 22px;
  max-width: 1180px;
  margin: 0 auto;
}

.project-filter {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

label {
  display: grid;
  gap: 8px;
}

label span {
  color: #5b6472;
  font-size: 14px;
}

input {
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
}

.filter-button {
  min-height: 38px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #374151;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.filter-button:hover,
.filter-button.active {
  background: #e6f0ef;
  color: #174346;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.empty-projects {
  display: grid;
  gap: 10px;
  padding: 22px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #4b5563;
  line-height: 1.7;
}

@media (max-width: 820px) {
  .project-list-page {
    padding: 18px;
  }

  .list-header {
    align-items: stretch;
    flex-direction: column;
  }

  .project-list-layout {
    grid-template-columns: 1fr;
  }
}
</style>
