<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ProjectLayout from "./components/ProjectLayout.vue";
import UpdateNotice from "./components/UpdateNotice.vue";
import CommentsPage from "./pages/CommentsPage.vue";
import CreateProjectPage from "./pages/CreateProjectPage.vue";
import EntryPage from "./pages/EntryPage.vue";
import FilesPage from "./pages/FilesPage.vue";
import HomePage from "./pages/HomePage.vue";
import ImportExportPage from "./pages/ImportExportPage.vue";
import LoginPage from "./pages/LoginPage.vue";
import ProjectListPage from "./pages/ProjectListPage.vue";
import ProjectPage from "./pages/ProjectPage.vue";
import SettingsPage from "./pages/SettingsPage.vue";
import StatsPage from "./pages/StatsPage.vue";
import TasksPage from "./pages/TasksPage.vue";
import TermsPage from "./pages/TermsPage.vue";
import type { Comment, Member, ProjectConfig } from "./model/types";
import { setChangesProjectStorage } from "./services/changes";
import { setCommentsProjectStorage } from "./services/comments";
import { setEntriesProjectStorage } from "./services/entries";
import { setExporterProjectStorage } from "./services/exporter";
import { setHistoryProjectStorage } from "./services/history";
import { loginMember } from "./services/auth";
import { getCurrentUser, setCurrentUser } from "./services/permissions";
import {
  checkForUpdates,
  disposeAppUpdate,
  reevaluatePendingAppUpdate,
  setupAppUpdate,
} from "./services/appUpdate";
import {
  importProjectFile,
  inspectProjectFile,
  openProject,
  openProjectRoot,
  type OpenedProject,
} from "./services/project";
import type { ProjectPackagePreview } from "./services/projectPackage";
import { deleteCurrentProjectSource } from "./services/projectDeletion";
import {
  getRecentProjectHandle,
  getRecentProjectAccessState,
  listRecentProjects,
  rememberRecentProject,
  removeRecentProject,
  requestRecentProjectAccess,
  updateRecentProjectUser,
  type RecentProjectRecord,
} from "./services/recentProjects";
import {
  clearProjectSession,
  restoreProjectSession,
  saveProjectSession,
} from "./services/session";
import { getProjectStats, type BasicProjectStats } from "./services/stats";
import { loadTasks, setTasksProjectStorage } from "./services/tasks";
import { setTermsProjectStorage } from "./services/terms";
import { setAppUpdateSafety } from "./services/updateSafety";

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

type AssistTab = "terms" | "comments" | "context" | "history";
type ImportExportPanel = "export" | "import";

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

const routePath = ref(`${window.location.pathname}${window.location.search}`);
const currentProject = ref<OpenedProject | null>(null);
const currentUser = ref<Member | null>(null);
const currentStats = ref<BasicProjectStats | null>(null);
const currentRecentRecordId = ref("");
const taskCount = ref(0);
const recentProjects = ref<RecentProjectRecord[]>(listRecentProjects());
const isOpeningProject = ref(false);
const isOpeningProjectFile = ref(false);
const isPreviewingProjectFile = ref(false);
const isLoggingIn = ref(false);
const isRestoringProject = ref(false);
const appErrorMessage = ref("");
const appNoticeMessage = ref("");
const loginErrorMessage = ref("");
const packedProjectNotice = ref("");
const projectFilePreview = ref<ProjectPackagePreview | null>(null);
const previewedProjectFile = ref<File | null>(null);

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
  const [pathname, queryString = ""] = path.split("?");
  const query = new URLSearchParams(queryString);
  const parts = pathname.split("/").filter(Boolean);

  if (parts.length === 0) {
    return { page: "projects" as const };
  }

  if (parts[0] === "home") {
    return { page: "home" as const };
  }

  if (parts[0] !== "projects") {
    return { page: "not-found" as const };
  }

  if (parts[1] === "create") {
    return { page: "create-project" as const };
  }

  if (parts.length === 1) {
    return { page: "projects" as const };
  }

  const projectId = decodeURIComponent(parts[1]);
  const section = (parts[2] ?? "overview") as ProjectSection;
  const fileId = parts[2] === "files" && parts[3] ? decodeURIComponent(parts[3]) : "";
  const entryIndex = Number(query.get("index") ?? "0") || 0;
  const tab = query.get("tab") ?? "";
  const assistTab = ["terms", "comments", "context", "history"].includes(tab)
    ? (tab as AssistTab)
    : undefined;
  const panel = query.get("panel") ?? "";
  const importExportPanel = ["export", "import"].includes(panel)
    ? (panel as ImportExportPanel)
    : undefined;

  return {
    page: "project" as const,
    projectId,
    section: fileId ? ("file-entry" as ProjectSection) : section,
    fileId,
    entryId: query.get("entry") ?? "",
    entryIndex,
    assistTab,
    importExportPanel,
    commentId: query.get("comment") ?? "",
  };
}

function navigate(path: string) {
  if (path === routePath.value) {
    return;
  }

  window.history.pushState({}, "", path);
  routePath.value = path;
  appErrorMessage.value = "";
  appNoticeMessage.value = "";
}

function replace(path: string) {
  window.history.replaceState({}, "", path);
  routePath.value = path;
}

function handlePopState() {
  routePath.value = `${window.location.pathname}${window.location.search}`;
}

function syncAppUpdateSafety() {
  const currentRoute = route.value;
  const section =
    currentRoute.page === "project" ? currentRoute.section : undefined;

  setAppUpdateSafety({
    page: currentRoute.page,
    section,
    hasProject: Boolean(currentProject.value),
    hasUser: Boolean(currentUser.value),
    isBusy:
      isOpeningProject.value ||
      isOpeningProjectFile.value ||
      isPreviewingProjectFile.value ||
      isLoggingIn.value ||
      isRestoringProject.value,
  });
  reevaluatePendingAppUpdate();
}

function updatePackedProjectNotice(project: OpenedProject | null) {
  if (!project || project.storageKind !== "packed") {
    packedProjectNotice.value = "";
    return;
  }

  packedProjectNotice.value =
    "当前打开的是 Textile 项目文件（.hproj）。修改会先保存在本次工作内存中，完成后请导出为 Textile 项目文件。";
}

function configureProjectServices(project: OpenedProject) {
  setEntriesProjectStorage(project.storage);
  setTermsProjectStorage(project.storage);
  setTasksProjectStorage(project.storage);
  setCommentsProjectStorage(project.storage);
  setHistoryProjectStorage(project.storage);
  setChangesProjectStorage(project.storage);
  setExporterProjectStorage(project.storage);
  setCurrentUser(null);
  currentUser.value = null;
  loginErrorMessage.value = "";
  updatePackedProjectNotice(project);
}

function getProjectDisplayPath(project: OpenedProject): string {
  if (project.storageKind === "packed") {
    return project.sourceFileName ?? project.root.sourceFileName ?? "Textile 项目文件";
  }

  return project.root.name || "本地项目文件夹";
}

async function rememberOpenedProject(
  project: OpenedProject,
  lastUserId?: string,
): Promise<void> {
  const sourceType = project.storageKind === "packed" ? "hproj" : "folder";
  const displayPath = getProjectDisplayPath(project);

  recentProjects.value = await rememberRecentProject(
    {
      projectId: project.config.project_id,
      name: project.config.name,
      sourceType,
      displayPath,
      lastUserId,
    },
    project.root,
  );
  currentRecentRecordId.value =
    recentProjects.value.find(
      (record) =>
        record.projectId === project.config.project_id &&
        record.sourceType === sourceType &&
        record.displayPath === displayPath,
    )?.recordId ?? "";
}

function restoreUserFromSession(project: OpenedProject): Member | null {
  const member = restoreProjectSession(project.config.project_id, project.members);

  if (!member) {
    setCurrentUser(null);
    currentUser.value = null;
    return null;
  }

  setCurrentUser(member);
  currentUser.value = getCurrentUser();
  return currentUser.value;
}

async function enterOpenedProject(
  project: OpenedProject,
  options: {
    preferredSection?: ProjectSection;
    loginAs?: Member;
  } = {},
) {
  currentProject.value = project;
  configureProjectServices(project);
  await refreshProjectSummary();

  const loginMember = options.loginAs ?? restoreUserFromSession(project);

  if (options.loginAs) {
    setCurrentUser(options.loginAs);
    currentUser.value = getCurrentUser();
    saveProjectSession(project.config.project_id, options.loginAs.id);
  }

  await rememberOpenedProject(project, loginMember?.id);

  if (loginMember) {
    navigate(
      `/projects/${encodeURIComponent(project.config.project_id)}/${options.preferredSection ?? "files"}`,
    );
  } else {
    navigate(`/projects/${encodeURIComponent(project.config.project_id)}`);
  }
}

function buildProjectSummary(
  config: ProjectConfig,
  members: Member[],
  stats: BasicProjectStats,
  totalTasks: number,
): ProjectSummary {
  const projectDescription = (config as ProjectConfig & { description?: string })
    .description;

  return {
    id: config.project_id,
    name: config.name,
    description:
      projectDescription?.trim() ||
      `${config.source_language} -> ${config.target_language} 本地汉化项目`,
    totalEntries: stats.totalEntries,
    translatedPercent: stats.translationProgress,
    proofreadPercent: stats.proofreadProgress,
    reviewedPercent: stats.reviewProgress,
    memberCount: members.filter((member) => member.active).length,
    taskCount: totalTasks,
  };
}

async function refreshProjectSummary() {
  currentStats.value = await getProjectStats(
    undefined,
    currentProject.value?.config.settings.progress_weights,
    currentProject.value?.config.settings.workflow,
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

    await enterOpenedProject(project);
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

async function handleImportProjectFile(file: File) {
  isOpeningProjectFile.value = true;
  appErrorMessage.value = "";
  appNoticeMessage.value = "";

  try {
    const project = await importProjectFile(file);

    projectFilePreview.value = null;
    previewedProjectFile.value = null;
    await enterOpenedProject(project);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      appErrorMessage.value = "没有选择导入位置。你可以重新点击按钮选择目标文件夹。";
    } else if (error instanceof Error) {
      appErrorMessage.value = error.message;
    } else {
      appErrorMessage.value =
        "导入 Textile 项目文件失败。请确认选择的是 .hproj 项目文件。";
    }
  } finally {
    isOpeningProjectFile.value = false;
  }
}

async function handlePreviewProjectFile(file: File) {
  isPreviewingProjectFile.value = true;
  appErrorMessage.value = "";
  appNoticeMessage.value = "";

  try {
    projectFilePreview.value = await inspectProjectFile(file);
    previewedProjectFile.value = file;
  } catch (error) {
    projectFilePreview.value = null;
    previewedProjectFile.value = null;
    appErrorMessage.value =
      error instanceof Error
        ? error.message
        : "预览 Textile 项目文件失败。请确认选择的是 .hproj 项目文件。";
  } finally {
    isPreviewingProjectFile.value = false;
  }
}

async function handleImportPreviewedProjectFile() {
  if (!previewedProjectFile.value) {
    appErrorMessage.value = "请先选择要预览的 Textile 项目文件。";
    return;
  }

  await handleImportProjectFile(previewedProjectFile.value);
}

function handleClearProjectFilePreview() {
  projectFilePreview.value = null;
  previewedProjectFile.value = null;
}

async function handleOpenRecentProject(record: RecentProjectRecord) {
  isOpeningProject.value = true;
  appErrorMessage.value = "";

  try {
    if (record.sourceType === "hproj") {
      appErrorMessage.value = "请重新选择这个 Textile 项目文件（.hproj）。";
      return;
    }

    const storedRoot = await getRecentProjectHandle(record.recordId);

    if (!storedRoot) {
      appErrorMessage.value =
        "最近项目的本地授权记录已丢失，请重新选择该项目所在文件夹。";
      return;
    }

    if (!(await requestRecentProjectAccess(storedRoot))) {
      appErrorMessage.value =
        "浏览器未授予此项目文件夹读写权限，请重新选择该项目所在文件夹。";
      return;
    }

    const project = await openProjectRoot(storedRoot);

    if (project.config.project_id !== record.projectId) {
      appErrorMessage.value =
        "你选择的项目和最近项目记录不一致，请重新选择正确的项目文件夹。";
      return;
    }

    await enterOpenedProject(project);
  } catch (error) {
    if (error instanceof Error) {
      appErrorMessage.value = error.message;
    } else {
      appErrorMessage.value =
        "浏览器需要重新授权此项目文件夹，请重新选择该项目所在文件夹。";
    }
  } finally {
    isOpeningProject.value = false;
  }
}

async function handleRemoveRecentProject(recordId: string) {
  recentProjects.value = await removeRecentProject(recordId);
}

async function handleProjectCreated(project: OpenedProject, owner: Member) {
  appErrorMessage.value = "";
  await enterOpenedProject(project, {
    preferredSection: "files",
    loginAs: owner,
  });
}

function handleEnterCurrentProject() {
  if (!currentProject.value) {
    return;
  }

  navigate(`/projects/${encodeURIComponent(currentProject.value.config.project_id)}/files`);
}

async function handleLogin(memberName: string, password: string) {
  if (!currentProject.value) {
    loginErrorMessage.value = "请先打开项目文件夹。";
    return;
  }

  isLoggingIn.value = true;
  loginErrorMessage.value = "";

  try {
    const member = await loginMember(
      currentProject.value.members,
      memberName,
      password,
    );

    if (!member) {
      loginErrorMessage.value = "成员名或密码不正确。";
      return;
    }

    setCurrentUser(member);
    currentUser.value = getCurrentUser();
    saveProjectSession(currentProject.value.config.project_id, member.id);
    recentProjects.value = updateRecentProjectUser(
      currentProject.value.config.project_id,
      member.id,
    );
    navigate(`/projects/${encodeURIComponent(currentProject.value.config.project_id)}/files`);
  } catch {
    loginErrorMessage.value = "登录失败。请稍后再试。";
  } finally {
    isLoggingIn.value = false;
  }
}

function handleLogout() {
  if (currentProject.value) {
    clearProjectSession(currentProject.value.config.project_id);
  }

  setCurrentUser(null);
  currentUser.value = null;
  loginErrorMessage.value = "";
}

function handleCurrentSessionCleared() {
  if (currentProject.value) {
    clearProjectSession(currentProject.value.config.project_id);
  }

  setCurrentUser(null);
  currentUser.value = null;
  loginErrorMessage.value = "";
}

function handleCacheStateChanged() {
  recentProjects.value = listRecentProjects();
}

function handleMembersUpdated(members: Member[]) {
  if (!currentProject.value) {
    return;
  }

  currentProject.value = {
    ...currentProject.value,
    members,
  };

  const refreshedUser = members.find((member) => member.id === currentUser.value?.id);

  if (refreshedUser?.active) {
    setCurrentUser(refreshedUser);
    currentUser.value = getCurrentUser();
  } else {
    handleLogout();
  }

  void refreshProjectSummary();
}

function handleOpenProjectSection(section: ProjectSection) {
  if (!currentProject.value) {
    navigate("/projects");
    return;
  }

  navigate(`/projects/${encodeURIComponent(currentProject.value.config.project_id)}/${section}`);
}

function handleOpenImportExport(panel?: ImportExportPanel) {
  if (!currentProject.value) {
    navigate("/projects");
    return;
  }

  const query = panel ? `?panel=${panel}` : "";

  navigate(
    `/projects/${encodeURIComponent(currentProject.value.config.project_id)}/import-export${query}`,
  );
}

function handleProjectUpdated(config: ProjectConfig) {
  if (!currentProject.value) {
    return;
  }

  currentProject.value = {
    ...currentProject.value,
    config,
  };
  void refreshProjectSummary();
}

async function handleDeleteProjectRequested() {
  if (!currentProject.value) {
    return;
  }

  const project = currentProject.value;

  try {
    const result = await deleteCurrentProjectSource(
      project.root,
      project.config,
      currentUser.value,
    );

    recentProjects.value = await removeRecentProject(
      currentRecentRecordId.value || project.config.project_id,
    );
    clearProjectSession(project.config.project_id);
    setCurrentUser(null);
    currentUser.value = null;
    currentProject.value = null;
    currentRecentRecordId.value = "";
    currentStats.value = null;
    taskCount.value = 0;
    loginErrorMessage.value = "";
    packedProjectNotice.value = "";
    appErrorMessage.value = "";
    appNoticeMessage.value = result.message;
    replace("/projects");
  } catch (error) {
    appErrorMessage.value =
      error instanceof Error ? error.message : "移除项目记录失败。请稍后再试。";
  }
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

function handleOpenTaskTarget(fileId: string, entryId: string, entryIndex: number) {
  if (!currentProject.value || !fileId) {
    return;
  }

  const query = entryId
    ? `?entry=${encodeURIComponent(entryId)}`
    : entryIndex > 0
      ? `?index=${encodeURIComponent(String(entryIndex))}`
      : "";

  navigate(
    `/projects/${encodeURIComponent(currentProject.value.config.project_id)}/files/${encodeURIComponent(fileId)}${query}`,
  );
}

function handleOpenCommentTarget(comment: Comment) {
  if (!currentProject.value) {
    navigate("/projects");
    return;
  }

  const fileId = comment.file_id || comment.entry_id.split(":")[0] || "";

  if (!fileId || !comment.entry_id) {
    appErrorMessage.value = "这条评论缺少词条位置，无法跳转。";
    return;
  }

  const query = new URLSearchParams({
    entry: comment.entry_id,
    tab: "comments",
    comment: comment.id,
  });

  navigate(
    `/projects/${encodeURIComponent(currentProject.value.config.project_id)}/files/${encodeURIComponent(fileId)}?${query.toString()}`,
  );
}

function handlePackedProjectDirty() {
  if (currentProject.value?.storageKind !== "packed") {
    return;
  }

  packedProjectNotice.value =
    "这个 Textile 项目文件（.hproj）已有未重新导出的修改。离开页面前请导出为 Textile 项目文件。";
}

function handlePackedProjectExported() {
  if (currentProject.value?.storageKind !== "packed") {
    return;
  }

  packedProjectNotice.value =
    "已导出新的 Textile 项目文件（.hproj）。之后的修改仍需要再次导出为 Textile 项目文件。";
}

async function restoreProjectFromRoute() {
  const currentRoute = route.value;

  if (currentRoute.page !== "project" || currentProject.value) {
    return;
  }

  isRestoringProject.value = true;

  try {
    const recentRecord = recentProjects.value.find(
      (record) => record.projectId === currentRoute.projectId,
    );
    const root = await getRecentProjectHandle(
      recentRecord?.recordId ?? currentRoute.projectId,
    );

    if (!root) {
      appErrorMessage.value =
        "最近项目的本地授权记录已丢失，请从项目启动页重新选择该项目文件夹。";
      replace("/projects");
      return;
    }

    if ((await getRecentProjectAccessState(root)) !== "granted") {
      appErrorMessage.value =
        "浏览器需要确认项目文件夹权限，请在最近项目中点击该项目继续。";
      replace("/projects");
      return;
    }

    const project = await openProjectRoot(root);

    if (project.config.project_id !== currentRoute.projectId) {
      appErrorMessage.value =
        "最近项目记录和当前地址不一致，请从项目启动页重新打开。";
      replace("/projects");
      return;
    }

    await enterOpenedProject(project, {
      preferredSection: currentRoute.section === "file-entry" ? "files" : currentRoute.section,
    });
  } catch (error) {
    appErrorMessage.value =
      error instanceof Error
        ? error.message
        : "项目恢复失败，请从项目启动页重新打开。";
    replace("/projects");
  } finally {
    isRestoringProject.value = false;
  }
}

watch(
  [
    route,
    currentProject,
    currentUser,
    isOpeningProject,
    isOpeningProjectFile,
    isPreviewingProjectFile,
    isLoggingIn,
    isRestoringProject,
  ],
  syncAppUpdateSafety,
  { immediate: true },
);

onMounted(() => {
  window.addEventListener("popstate", handlePopState);
  window.addEventListener("hproj-project-dirty", handlePackedProjectDirty);
  window.addEventListener("hproj-project-exported", handlePackedProjectExported);
  setupAppUpdate();
  void checkForUpdates();

  if (window.location.pathname === "/") {
    replace("/projects");
  }

  void restoreProjectFromRoute();
});

onBeforeUnmount(() => {
  disposeAppUpdate();
  window.removeEventListener("popstate", handlePopState);
  window.removeEventListener("hproj-project-dirty", handlePackedProjectDirty);
  window.removeEventListener("hproj-project-exported", handlePackedProjectExported);
});
</script>

<template>
  <HomePage v-if="route.page === 'home'" />

  <CreateProjectPage
    v-else-if="route.page === 'create-project'"
    @created="handleProjectCreated"
    @cancel="navigate('/projects')"
  />

  <section v-else-if="route.page === 'projects'" class="project-list-shell">
    <ProjectListPage
      :current-project="currentProjectSummary"
      :is-opening="isOpeningProject"
      :is-opening-file="isOpeningProjectFile"
      :is-previewing-file="isPreviewingProjectFile"
      :is-restoring="isRestoringProject"
      :error-message="appErrorMessage"
      :project-file-preview="projectFilePreview"
      :recent-projects="recentProjects"
      @create-project="navigate('/projects/create')"
      @open-local-project="handleOpenLocalProject"
      @import-project-file="handleImportProjectFile"
      @preview-project-file="handlePreviewProjectFile"
      @import-previewed-project-file="handleImportPreviewedProjectFile"
      @clear-project-file-preview="handleClearProjectFilePreview"
      @open-recent-project="handleOpenRecentProject"
      @remove-recent-project="handleRemoveRecentProject"
      @enter-current-project="handleEnterCurrentProject"
    />
  </section>

  <LoginPage
    v-else-if="route.page === 'project' && currentProject && !currentUser"
    :project-name="currentProject.config.name"
    :error-message="loginErrorMessage"
    :is-submitting="isLoggingIn"
    @login="handleLogin"
    @back-to-projects="navigate('/projects')"
  />

  <ProjectLayout
    v-else-if="route.page === 'project'"
    :project="currentProject?.config"
    :active-section="route.section"
    :file-id="route.fileId"
    :current-user="currentUser"
    @navigate-project-list="navigate('/projects')"
    @navigate-section="handleOpenProjectSection"
    @logout="handleLogout"
  >
    <template v-if="currentProject">
      <ProjectPage
        v-if="route.section === 'overview'"
        :project="currentProject.config"
        :stats="currentStats"
        :task-count="taskCount"
        @open-files="handleOpenProjectSection('files')"
        @open-import-export="handleOpenImportExport"
      />

      <FilesPage
        v-else-if="route.section === 'files'"
        :project="currentProject.config"
        :project-root="currentProject.root"
        :project-storage="currentProject.storage"
        :current-user="currentUser"
        @open-file="handleOpenFile"
        @project-updated="handleProjectUpdated"
      />

      <EntryPage
        v-else-if="route.section === 'file-entry'"
        :project="currentProject.config"
        :file-id="route.fileId"
        :target-entry-id="route.entryId"
        :target-entry-index="route.entryIndex"
        :target-assist-tab="route.assistTab"
        :target-comment-id="route.commentId"
        @open-comment-target="handleOpenCommentTarget"
      />

      <TasksPage
        v-else-if="route.section === 'tasks'"
        :project="currentProject.config"
        :members="currentProject.members"
        :current-user="currentUser"
        @open-task-target="handleOpenTaskTarget"
        @tasks-changed="refreshProjectSummary"
      />

      <TermsPage v-else-if="route.section === 'terms'" />

      <CommentsPage
        v-else-if="route.section === 'comments'"
        :project="currentProject.config"
        :members="currentProject.members"
        @open-comment-target="handleOpenCommentTarget"
      />

      <StatsPage
        v-else-if="route.section === 'stats'"
        :project="currentProject.config"
      />

      <ImportExportPage
        v-else-if="route.section === 'import-export'"
        :project="currentProject.config"
        :members="currentProject.members"
        :project-root="currentProject.root"
        :project-storage="currentProject.storage"
        :current-user="currentUser"
        :target-panel="route.importExportPanel"
        @project-updated="handleProjectUpdated"
        @members-updated="handleMembersUpdated"
      />

      <SettingsPage
        v-else-if="route.section === 'settings'"
        :project="currentProject.config"
        :members="currentProject.members"
        :project-root="currentProject.root"
        :project-storage="currentProject.storage"
        :current-user="currentUser"
        @project-updated="handleProjectUpdated"
        @members-updated="handleMembersUpdated"
        @open-import-export="handleOpenProjectSection('import-export')"
        @cache-state-changed="handleCacheStateChanged"
        @current-session-cleared="handleCurrentSessionCleared"
        @delete-project-requested="handleDeleteProjectRequested"
      />

      <section v-else class="placeholder-page">
        <p class="eyebrow">项目内页面</p>
        <h1>{{ sectionLabels[route.section] }}</h1>
        <p>这个栏目已经接入项目工作台导航，当前版本还没有对应页面文件。</p>
      </section>
    </template>

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

  <UpdateNotice />
  <aside v-if="appNoticeMessage" class="app-notice">
    {{ appNoticeMessage }}
  </aside>
  <aside v-if="packedProjectNotice" class="packed-project-notice">
    {{ packedProjectNotice }}
  </aside>
</template>

<style scoped>
.project-list-shell {
  position: relative;
}

.app-notice,
.packed-project-notice {
  position: fixed;
  left: 18px;
  right: 18px;
  bottom: 18px;
  z-index: 20;
  max-width: 860px;
  margin: 0 auto;
  padding: 12px 14px;
  border: 1px solid #c7d2fe;
  border-radius: 8px;
  background: #eef2ff;
  color: #1e3a8a;
  font-size: 14px;
  line-height: 1.6;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.16);
}

.app-notice {
  border-color: #b7dfc2;
  background: #f0fdf4;
  color: #166534;
}
</style>
