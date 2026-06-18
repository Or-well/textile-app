<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import ProjectLayout from "./components/ProjectLayout.vue";
import CommentsPage from "./pages/CommentsPage.vue";
import EntryPage from "./pages/EntryPage.vue";
import FilesPage from "./pages/FilesPage.vue";
import HomePage from "./pages/HomePage.vue";
import ImportExportPage from "./pages/ImportExportPage.vue";
import ProjectListPage from "./pages/ProjectListPage.vue";
import ProjectPage from "./pages/ProjectPage.vue";
import SettingsPage from "./pages/SettingsPage.vue";
import StatsPage from "./pages/StatsPage.vue";
import TasksPage from "./pages/TasksPage.vue";
import TermsPage from "./pages/TermsPage.vue";
import type { Member, ProjectConfig } from "./model/types";
import { setChangesProjectRoot } from "./services/changes";
import { setCommentsProjectRoot } from "./services/comments";
import { setEntriesProjectRoot } from "./services/entries";
import { setExporterProjectRoot } from "./services/exporter";
import { setHistoryProjectRoot } from "./services/history";
import { setCurrentUser } from "./services/permissions";
import { openProject, type OpenedProject } from "./services/project";
import { getProjectStats, type BasicProjectStats } from "./services/stats";
import { loadTasks, setTasksProjectRoot } from "./services/tasks";
import { setTermsProjectRoot } from "./services/terms";

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

const sectionLabels: Record<ProjectSection, string> = {
  overview: "概览",
  files: "文件",
  tasks: "任务",
  terms: "术语",
  comments: "评论",
  stats: "统计",
  "import-export": "导入导出",
  settings: "设置",
  "file-entry": "词条",
};

const routePath = ref(window.location.pathname);
const currentProject = ref<OpenedProject | null>(null);
const currentStats = ref<BasicProjectStats | null>(null);
const taskCount = ref(0);
const isOpeningProject = ref(false);
const appErrorMessage = ref("");

const route = computed(() => parseRoute(routePath.value));
const currentProjectSummary = computed<ProjectSummary | null>(() => {
  if (!currentProject.value || !currentStats.value) {
    return null;
  }

  return buildProjectSummary(
    currentProject.value.config,
    currentProject.value.members,
    currentStats.value,
    taskCount.value,
  );
});

function parseRoute(path: string) {
  const parts = path.split("/").filter(Boolean);

  if (parts.length === 0) {
    return { page: "projects" as const };
  }

  if (parts[0] === "home") {
    return { page: "home" as const };
  }

  if (parts[0] !== "projects") {
    return { page: "not-found" as const };
  }

  if (parts.length === 1) {
    return { page: "projects" as const };
  }

  const projectId = decodeURIComponent(parts[1]);
  const section = (parts[2] ?? "overview") as ProjectSection;
  const fileId = parts[2] === "files" && parts[3] ? decodeURIComponent(parts[3]) : "";

  return {
    page: "project" as const,
    projectId,
    section: fileId ? ("file-entry" as ProjectSection) : section,
    fileId,
  };
}

function navigate(path: string) {
  if (path === routePath.value) {
    return;
  }

  window.history.pushState({}, "", path);
  routePath.value = path;
  appErrorMessage.value = "";
}

function replace(path: string) {
  window.history.replaceState({}, "", path);
  routePath.value = path;
}

function handlePopState() {
  routePath.value = window.location.pathname;
}

function configureProjectServices(project: OpenedProject) {
  setEntriesProjectRoot(project.root);
  setTermsProjectRoot(project.root);
  setTasksProjectRoot(project.root);
  setCommentsProjectRoot(project.root);
  setHistoryProjectRoot(project.root);
  setChangesProjectRoot(project.root);
  setExporterProjectRoot(project.root);
  setCurrentUser(project.members.find((member) => member.active) ?? null);
}

function buildProjectSummary(
  config: ProjectConfig,
  members: Member[],
  stats: BasicProjectStats,
  totalTasks: number,
): ProjectSummary {
  return {
    id: config.project_id,
    name: config.name,
    description: `${config.source_language} -> ${config.target_language} 本地汉化项目`,
    totalEntries: stats.totalEntries,
    translatedPercent: stats.translationProgress,
    reviewedPercent: stats.reviewProgress,
    memberCount: members.filter((member) => member.active).length,
    taskCount: totalTasks,
  };
}

async function refreshProjectSummary() {
  currentStats.value = await getProjectStats(
    undefined,
    currentProject.value?.config.settings.progress_weights,
  );

  try {
    taskCount.value = (await loadTasks()).length;
  } catch {
    taskCount.value = 0;
  }
}

async function handleOpenLocalProject() {
  isOpeningProject.value = true;
  appErrorMessage.value = "";

  try {
    const project = await openProject();

    currentProject.value = project;
    configureProjectServices(project);
    await refreshProjectSummary();
    navigate(`/projects/${encodeURIComponent(project.config.project_id)}/files`);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      appErrorMessage.value = "没有打开项目文件夹。你可以重新点击按钮选择项目。";
    } else if (error instanceof Error) {
      appErrorMessage.value = error.message;
    } else {
      appErrorMessage.value = "打开项目失败。请确认选择的是项目根目录。";
    }
  } finally {
    isOpeningProject.value = false;
  }
}

function handleEnterCurrentProject() {
  if (!currentProject.value) {
    return;
  }

  navigate(`/projects/${encodeURIComponent(currentProject.value.config.project_id)}/files`);
}

function handleOpenProjectSection(section: ProjectSection) {
  if (!currentProject.value) {
    navigate("/projects");
    return;
  }

  navigate(`/projects/${encodeURIComponent(currentProject.value.config.project_id)}/${section}`);
}

function handleOpenFile(fileId: string) {
  if (!currentProject.value) {
    navigate("/projects");
    return;
  }

  navigate(
    `/projects/${encodeURIComponent(currentProject.value.config.project_id)}/files/${encodeURIComponent(fileId)}`,
  );
}

onMounted(() => {
  window.addEventListener("popstate", handlePopState);

  if (window.location.pathname === "/") {
    replace("/projects");
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("popstate", handlePopState);
});
</script>

<template>
  <HomePage v-if="route.page === 'home'" />

  <section v-else-if="route.page === 'projects'" class="project-list-shell">
    <button class="home-link-button" type="button" @click="navigate('/home')">
      打开项目入口
    </button>
    <ProjectListPage
      :current-project="currentProjectSummary"
      :is-opening="isOpeningProject"
      :error-message="appErrorMessage"
      @open-local-project="handleOpenLocalProject"
      @enter-current-project="handleEnterCurrentProject"
    />
  </section>

  <ProjectLayout
    v-else-if="route.page === 'project'"
    :project="currentProject?.config"
    :active-section="route.section"
    :file-id="route.fileId"
    @navigate-project-list="navigate('/projects')"
    @navigate-section="handleOpenProjectSection"
  >
    <template v-if="currentProject">
      <ProjectPage
        v-if="route.section === 'overview'"
        :project="currentProject.config"
        :stats="currentStats"
        :task-count="taskCount"
        @open-files="handleOpenProjectSection('files')"
      />

      <FilesPage
        v-else-if="route.section === 'files'"
        :project="currentProject.config"
        @open-file="handleOpenFile"
      />

      <EntryPage
        v-else-if="route.section === 'file-entry'"
        :project="currentProject.config"
        :file-id="route.fileId"
      />

      <TasksPage v-else-if="route.section === 'tasks'" />

      <TermsPage v-else-if="route.section === 'terms'" />

      <CommentsPage v-else-if="route.section === 'comments'" />

      <StatsPage
        v-else-if="route.section === 'stats'"
        :project="currentProject.config"
      />

      <ImportExportPage v-else-if="route.section === 'import-export'" />

      <SettingsPage v-else-if="route.section === 'settings'" />

      <section v-else class="placeholder-page">
        <p class="eyebrow">项目内页面</p>
        <h1>{{ sectionLabels[route.section] }}</h1>
        <p>这个栏目已经接入项目工作台导航，当前版本还没有对应页面文件。</p>
      </section>
    </template>

    <TermsPage v-else-if="route.section === 'terms'" />

    <StatsPage v-else-if="route.section === 'stats'" />

    <section v-else class="placeholder-page">
      <p class="eyebrow">未打开项目</p>
      <h1>请先打开项目文件夹</h1>
      <p>项目工作台需要先从项目列表页选择一个本地项目文件夹。</p>
      <button class="primary-button" type="button" @click="navigate('/projects')">
        返回项目列表
      </button>
    </section>
  </ProjectLayout>

  <main v-else class="not-found-page">
    <section class="placeholder-page">
      <p class="eyebrow">页面不存在</p>
      <h1>没有找到这个页面</h1>
      <button class="primary-button" type="button" @click="navigate('/projects')">
        返回项目列表
      </button>
    </section>
  </main>
</template>

<style scoped>
.project-list-shell {
  position: relative;
}

.home-link-button {
  position: absolute;
  top: 82px;
  right: max(28px, calc((100vw - 1220px) / 2));
  z-index: 2;
  min-height: 38px;
  padding: 0 13px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  cursor: pointer;
}

@media (max-width: 820px) {
  .home-link-button {
    position: static;
    margin: 18px 18px 0;
  }
}
</style>
