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
  isOpeningFile?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  openLocalProject: [];
  openProjectFile: [file: File];
  enterCurrentProject: [];
}>();

const searchText = ref("");
const selectedCategory = ref<"mine" | "all">("mine");
const projectFileInput = ref<HTMLInputElement | null>(null);

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
  <main class="project-list-page">
    <header class="list-header">
      <div>
        <p class="eyebrow">项目</p>
        <h1>我的项目</h1>
      </div>

      <div class="header-actions">
        <button
          class="secondary-button"
          type="button"
          :disabled="isOpeningFile"
          @click="projectFileInput?.click()"
        >
          {{ isOpeningFile ? "正在打开..." : "打开项目文件" }}
        </button>
        <button
          class="primary-button"
          type="button"
          :disabled="isOpening"
          @click="emit('openLocalProject')"
        >
          {{ isOpening ? "正在打开..." : "打开项目文件夹" }}
        </button>
        <input
          ref="projectFileInput"
          class="hidden-file-input"
          type="file"
          accept=".hproj,application/zip"
          @change="handleSelectProjectFile"
        />
      </div>
    </header>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

    <div class="project-list-layout">
      <aside class="project-filter">
        <p class="filter-title">项目</p>
        <label>
          <span>搜索</span>
          <input v-model="searchText" type="search" placeholder="搜索项目" />
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
          action-label="请用打开项目文件夹选择样例目录"
        />

        <section v-if="!visibleCurrentProject" class="empty-projects">
          <h2>还没有打开的本地项目</h2>
          <p>
            点击“打开项目文件夹”或“打开项目文件”后，它会出现在这里，并进入项目工作台。
          </p>
        </section>
      </section>
    </div>
  </main>
</template>

<style scoped>
.project-list-page {
  min-height: 100vh;
  padding: 26px;
  background: #f1f4f6;
  color: #1f2937;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  max-width: 1220px;
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

.header-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.primary-button,
.secondary-button {
  min-height: 42px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}

.primary-button {
  border-color: #2f6f73;
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button {
  border-color: #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

.primary-button:disabled,
.secondary-button:disabled {
  cursor: wait;
  opacity: 0.72;
}

.hidden-file-input {
  display: none;
}

.error-message {
  max-width: 1220px;
  margin: 0 auto 18px;
  color: #b42318;
  line-height: 1.7;
}

.project-list-layout {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  gap: 18px;
  max-width: 1220px;
  margin: 0 auto;
}

.project-filter {
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.filter-title {
  color: #111827;
  font-size: 15px;
  font-weight: 700;
}

label {
  display: grid;
  gap: 8px;
}

label span {
  color: #5b6472;
  font-size: 13px;
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
  min-height: 40px;
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
  background: #eef6f4;
  color: #194b4f;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
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

  .header-actions {
    justify-content: flex-start;
  }

  .project-list-layout {
    grid-template-columns: 1fr;
  }
}
</style>
