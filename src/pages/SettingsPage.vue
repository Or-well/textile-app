<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MemberManagementPanel from "../components/settings/MemberManagementPanel.vue";
import {
  PERMISSION_ACTIONS,
  ROLE_DEFAULT_PERMISSIONS,
} from "../model/permissions";
import type {
  Member,
  ProjectConfig,
  ProjectWorkflowSettings,
  ProofreadRequired,
  ReleaseExportFormat,
  Role,
} from "../model/types";
import { normalizeWorkflowSettings } from "../model/status";
import {
  normalizeProjectExportSettings,
} from "../services/exporter";
import {
  can,
  canConfigureStats,
  getCurrentUser,
} from "../services/permissions";
import { exportProjectPackage } from "../services/projectPackage";
import { openProject, saveProject } from "../services/project";
import {
  checkForUpdates,
  getAppUpdateState,
  getCurrentVersion,
  getUpdateChannel,
  installUpdate,
  openDownloadPage,
  setUpdateChannel,
  subscribeAppUpdate,
  type AppUpdateState,
  type UpdateChannel,
} from "../services/appUpdate";
import type { ProjectDirectoryHandle } from "../services/projectFs";
import { normalizeProgressWeights } from "../services/stats";
import {
  getSyncStatus,
  syncLatestProject,
  type SyncStatus,
} from "../services/sync";

type SettingsSection =
  | "project"
  | "members"
  | "roles"
  | "workflow"
  | "progress"
  | "export"
  | "sync"
  | "updates"
  | "danger";

type EditableProjectConfig = ProjectConfig & {
  description?: string;
};

const props = defineProps<{
  project?: ProjectConfig;
  members?: Member[];
  projectRoot?: ProjectDirectoryHandle;
  currentUser?: Member | null;
}>();

const emit = defineEmits<{
  projectUpdated: [project: ProjectConfig];
  membersUpdated: [members: Member[]];
  openImportExport: [];
}>();

const sectionItems: Array<{ key: SettingsSection; label: string }> = [
  { key: "project", label: "项目设置" },
  { key: "members", label: "成员管理" },
  { key: "roles", label: "角色与权限" },
  { key: "workflow", label: "工作流" },
  { key: "progress", label: "进度权重" },
  { key: "export", label: "导出设置" },
  { key: "sync", label: "同步与备份" },
  { key: "updates", label: "关于 / 更新" },
  { key: "danger", label: "危险操作" },
];

const roleOrder: Role[] = [
  "owner",
  "admin",
  "translator",
  "proofreader",
  "reviewer",
  "publisher",
  "term_manager",
  "readonly",
];

const roleLabels: Record<Role, string> = {
  owner: "项目负责人",
  admin: "管理员",
  tech_lead: "技术负责人",
  translator: "翻译",
  proofreader: "校对",
  reviewer: "审核",
  publisher: "发布负责人",
  term_manager: "术语负责人",
  readonly: "只读成员",
};

const roleDescriptions: Record<Role, string> = {
  owner: "维护项目、成员、任务、导入修改和危险操作。",
  admin: "协助管理项目设置、任务和导入流程。",
  tech_lead: "维护格式、导出器和底层协作问题。",
  translator: "翻译词条、评论并导出自己的修改。",
  proofreader: "校对译文、退回问题词条并标记争议。",
  reviewer: "审核词条、解决争议并提交最终判断。",
  publisher: "导出成品和发布报告。",
  term_manager: "维护术语表、导入导出术语。",
  readonly: "只查看项目内容，不修改数据。",
};

const activeSection = ref<SettingsSection>("project");
const localProject = ref<EditableProjectConfig | null>(null);
const localMembers = ref<Member[]>([]);
const localRoot = ref<ProjectDirectoryHandle | null>(null);
const projectDraft = ref({
  name: "",
  description: "",
  source_language: "",
  target_language: "",
});
const weightDraft = ref({
  translation: 40,
  proofread: 30,
  review: 30,
});
const workflowDraft = ref<Required<ProjectWorkflowSettings>>({
  enable_tasks: true,
  enable_proofread: true,
  enable_review: true,
  proofread_required: 1,
  review_required: true,
  allow_self_proofread: false,
  allow_self_review: false,
  allow_same_user_multi_proofread: false,
});
const exportDraft = ref({
  default_format: "json" as ReleaseExportFormat,
  only_reviewed: false,
  include_source: true,
  include_key: true,
  include_report: true,
  include_manifest: true,
});
const syncStatus = ref<SyncStatus>();
const updateState = ref<AppUpdateState>(getAppUpdateState());
const selectedUpdateChannel = ref<UpdateChannel>(getUpdateChannel());
const isLoading = ref(false);
const isSavingProject = ref(false);
const isSavingWorkflow = ref(false);
const isSavingWeights = ref(false);
const isSavingExportSettings = ref(false);
const isRefreshingSync = ref(false);
const isSyncing = ref(false);
const isExportingProjectFile = ref(false);
const isCheckingUpdate = ref(false);
const message = ref("");
const errorMessage = ref("");
let unsubscribeUpdate: (() => void) | null = null;

const hasProjectContext = computed(() => Boolean(props.project));
const currentUser = computed(
  () => props.currentUser ?? getCurrentUser(),
);
const currentRoleText = computed(() =>
  currentUser.value?.roles.length ? currentUser.value.roles.join(" / ") : "未登录",
);
const canManageProject = computed(() =>
  can(currentUser.value, PERMISSION_ACTIONS.PROJECT_MANAGE),
);
const canEditProgressWeights = computed(() =>
  canConfigureStats(currentUser.value),
);
const weightTotal = computed(
  () =>
    Number(weightDraft.value.translation) +
    Number(weightDraft.value.proofread) +
    Number(weightDraft.value.review),
);
const weightsAreValid = computed(
  () =>
    [
      weightDraft.value.translation,
      weightDraft.value.proofread,
      weightDraft.value.review,
    ].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0) &&
    weightTotal.value === 100,
);
const roleRows = computed(() =>
  roleOrder.map((role) => ({
    role,
    label: roleLabels[role],
    description: roleDescriptions[role],
    permissions: ROLE_DEFAULT_PERMISSIONS[role] ?? [],
  })),
);
const syncStateText = computed(() => {
  if (!syncStatus.value) {
    return "尚未检查同步状态";
  }

  return `${syncStatus.value.title}：${syncStatus.value.message}`;
});
const canSyncProject = computed(() => syncStatus.value?.canSync === true);
const currentProgramVersion = computed(() => `v${getCurrentVersion()}`);
const latestProgramVersion = computed(() =>
  updateState.value.latest ? `v${updateState.value.latest.latest_version}` : "尚未获取",
);
const updatePlatformText = computed(() => {
  const labels = {
    web: "Web",
    pwa: "PWA",
    desktop: "桌面版占位",
  } satisfies Record<AppUpdateState["platform"], string>;

  return labels[updateState.value.platform];
});
const lastUpdateCheckText = computed(() => {
  if (!updateState.value.checkedAt) {
    return "尚未检查";
  }

  return new Date(updateState.value.checkedAt).toLocaleString();
});
const updateStatusText = computed(() => {
  if (updateState.value.pwaRefreshReady) {
    return "新版本已准备好，刷新后即可使用。";
  }

  return updateState.value.message;
});
const releaseNoteRows = computed(() => updateState.value.latest?.notes ?? []);

function applyProject(project: ProjectConfig): void {
  const editableProject = project as EditableProjectConfig;
  const weights = normalizeProgressWeights(project.settings.progress_weights);
  const translationPercent = Math.round(weights.translationWeight * 100);
  const proofreadPercent = Math.round(weights.proofreadWeight * 100);

  localProject.value = editableProject;
  projectDraft.value = {
    name: editableProject.name,
    description: editableProject.description ?? "",
    source_language: editableProject.source_language,
    target_language: editableProject.target_language,
  };
  weightDraft.value = {
    translation: translationPercent,
    proofread: proofreadPercent,
    review: 100 - translationPercent - proofreadPercent,
  };
  exportDraft.value = normalizeProjectExportSettings(project.settings.export);
  const workflow = normalizeWorkflowSettings(project.settings.workflow);
  workflowDraft.value = {
    enable_tasks: workflow.enable_tasks,
    enable_proofread: workflow.proofread_required > 0,
    enable_review: workflow.review_required,
    proofread_required: workflow.proofread_required,
    review_required: workflow.review_required,
    allow_self_proofread: workflow.allow_self_proofread,
    allow_self_review: workflow.allow_self_review,
    allow_same_user_multi_proofread: workflow.allow_same_user_multi_proofread,
  };
}

function applyMembers(members: Member[]): void {
  localMembers.value = members;
}

function getWritableRoot(): ProjectDirectoryHandle {
  const root = props.projectRoot ?? localRoot.value;

  if (!root) {
    throw new Error("请先打开项目，才能保存项目设置。");
  }

  return root;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function persistProject(
  config: EditableProjectConfig,
  successMessage: string,
) {
  const root = getWritableRoot();

  await saveProject(root, config);
  localProject.value = config;
  emit("projectUpdated", config);
  message.value = successMessage;
}

async function handleOpenProject() {
  isLoading.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const project = await openProject();

    localRoot.value = project.root;
    applyProject(project.config);
    applyMembers(project.members);
    await refreshSyncStatus();
    message.value = `已打开项目：${project.config.name}`;
  } catch (error) {
    localProject.value = null;
    localMembers.value = [];

    if (error instanceof DOMException && error.name === "AbortError") {
      errorMessage.value = "没有打开项目文件夹。你可以重新点击按钮选择项目。";
    } else if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = "项目设置加载失败。请确认选择的是项目根目录。";
    }
  } finally {
    isLoading.value = false;
  }
}

async function handleSaveProjectInfo() {
  if (!localProject.value) {
    return;
  }

  if (!canManageProject.value) {
    errorMessage.value = "当前用户没有管理项目设置的权限。";
    return;
  }

  isSavingProject.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const nextProject: EditableProjectConfig = {
      ...localProject.value,
      name: projectDraft.value.name.trim() || localProject.value.name,
      description: projectDraft.value.description.trim(),
      source_language:
        projectDraft.value.source_language.trim() ||
        localProject.value.source_language,
      target_language:
        projectDraft.value.target_language.trim() ||
        localProject.value.target_language,
    };

    await persistProject(nextProject, "项目设置已保存。");
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "项目设置保存失败。请稍后再试。";
  } finally {
    isSavingProject.value = false;
  }
}

async function handleSaveWorkflowSettings() {
  if (!localProject.value) {
    return;
  }

  if (!canManageProject.value) {
    errorMessage.value = "当前用户没有管理项目工作流的权限。";
    return;
  }

  isSavingWorkflow.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const proofreadRequired = Math.max(
      0,
      Math.min(3, Math.trunc(Number(workflowDraft.value.proofread_required))),
    ) as ProofreadRequired;
    const nextWorkflow: ProjectWorkflowSettings = {
      ...localProject.value.settings.workflow,
      enable_tasks: workflowDraft.value.enable_tasks,
      enable_proofread: proofreadRequired > 0,
      enable_review: workflowDraft.value.review_required,
      proofread_required: proofreadRequired,
      review_required: workflowDraft.value.review_required,
      allow_self_proofread: workflowDraft.value.allow_self_proofread,
      allow_self_review: workflowDraft.value.allow_self_review,
      allow_same_user_multi_proofread:
        workflowDraft.value.allow_same_user_multi_proofread,
    };
    const nextProject: EditableProjectConfig = {
      ...localProject.value,
      settings: {
        ...localProject.value.settings,
        workflow: nextWorkflow,
      },
    };

    await persistProject(nextProject, "工作流设置已保存。");
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "工作流设置保存失败，请稍后再试。";
  } finally {
    isSavingWorkflow.value = false;
  }
}

async function handleSaveProgressWeights() {
  if (!localProject.value) {
    return;
  }

  if (!canEditProgressWeights.value) {
    errorMessage.value = "当前用户没有配置统计权重的权限。";
    return;
  }

  if (!weightsAreValid.value) {
    errorMessage.value = "进度权重总和必须等于 100%。";
    return;
  }

  isSavingWeights.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const nextProject: EditableProjectConfig = {
      ...localProject.value,
      settings: {
        ...localProject.value.settings,
        progress_weights: {
          translation: Number(weightDraft.value.translation) / 100,
          proofread: Number(weightDraft.value.proofread) / 100,
          review: Number(weightDraft.value.review) / 100,
        },
      },
    };

    await persistProject(nextProject, "进度权重已保存。");
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "进度权重保存失败。请稍后再试。";
  } finally {
    isSavingWeights.value = false;
  }
}

async function handleSaveExportSettings() {
  if (!localProject.value) {
    return;
  }

  if (!canManageProject.value) {
    errorMessage.value = "当前用户没有管理导出设置的权限。";
    return;
  }

  isSavingExportSettings.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const nextProject: EditableProjectConfig = {
      ...localProject.value,
      settings: {
        ...localProject.value.settings,
        export: { ...exportDraft.value },
      },
    };

    await persistProject(nextProject, "导出设置已保存。");
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导出设置保存失败。请稍后再试。";
  } finally {
    isSavingExportSettings.value = false;
  }
}

function handleRestoreDefaultWeights() {
  weightDraft.value = {
    translation: 40,
    proofread: 30,
    review: 30,
  };
  message.value = "已恢复默认权重，保存后生效。";
  errorMessage.value = "";
}

async function refreshSyncStatus() {
  isRefreshingSync.value = true;

  try {
    syncStatus.value = await getSyncStatus();
  } catch (error) {
    syncStatus.value = {
      state: "failed",
      title: "同步状态检查失败",
      message:
        error instanceof Error
          ? error.message
          : "当前无法检查同步状态。你可以先导出修改包继续协作。",
      canSync: false,
      canUpload: false,
      fallbackMessage: "你可以先导出修改包，交给负责人合并。",
    };
  } finally {
    isRefreshingSync.value = false;
  }
}

async function handleSyncProject() {
  if (!canSyncProject.value) {
    return;
  }

  isSyncing.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const result = await syncLatestProject();

    message.value = result.ok
      ? result.message
      : result.fallbackMessage ?? result.message;
    await refreshSyncStatus();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "同步项目失败。请导出修改包作为备用。";
  } finally {
    isSyncing.value = false;
  }
}

async function handleExportProjectFile() {
  const root = props.projectRoot ?? localRoot.value;

  if (!root) {
    errorMessage.value = "请先打开项目，再导出为项目文件。";
    return;
  }

  isExportingProjectFile.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const result = await exportProjectPackage(root);

    downloadBlob(result.blob, result.fileName);
    message.value = `已导出为项目文件：${result.fileName}`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导出项目文件失败。请稍后再试。";
  } finally {
    isExportingProjectFile.value = false;
  }
}

function handleUpdateChannelChange(event: Event) {
  const nextChannel = (event.target as HTMLSelectElement).value as UpdateChannel;

  setUpdateChannel(nextChannel);
  selectedUpdateChannel.value = nextChannel;
  message.value = "更新通道已切换，请手动检查更新。";
  errorMessage.value = "";
}

async function handleCheckForUpdates() {
  isCheckingUpdate.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const result = await checkForUpdates();

    if (result.status === "failed") {
      errorMessage.value = result.message;
    } else {
      message.value = result.message;
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "检查更新失败。请稍后再试。";
  } finally {
    isCheckingUpdate.value = false;
  }
}

function handleOpenDownloadPage() {
  openDownloadPage(updateState.value.latest?.download_url);
}

async function handleInstallProgramUpdate() {
  const result = await installUpdate();
  message.value = result.message;
  errorMessage.value = "";
}

function confirmDangerAction(actionName: string): boolean {
  return (
    window.confirm(`确认要执行“${actionName}”吗？`) &&
    window.confirm("再次确认：当前版本不会删除项目数据。继续执行？")
  );
}

function handleDangerAction(actionName: string) {
  if (!canManageProject.value) {
    errorMessage.value = "当前用户没有执行危险操作的权限。";
    return;
  }

  message.value = "";
  errorMessage.value = "";

  if (!confirmDangerAction(actionName)) {
    return;
  }

  if (actionName === "重建统计") {
    message.value = "统计数据按词条实时计算，已刷新当前项目摘要。";
    if (localProject.value) {
      emit("projectUpdated", localProject.value);
    }
  }
}

watch(
  () => [props.project, props.members, props.projectRoot] as const,
  ([project, members, root]) => {
    if (!project) {
      return;
    }

    localRoot.value = root ?? null;
    applyProject(project);
    applyMembers(members ?? []);
    void refreshSyncStatus();
  },
  { immediate: true },
);

onMounted(() => {
  unsubscribeUpdate = subscribeAppUpdate((nextState) => {
    updateState.value = nextState;
    selectedUpdateChannel.value = nextState.channel;
  });

  if (localProject.value) {
    void refreshSyncStatus();
  }
});

onBeforeUnmount(() => {
  unsubscribeUpdate?.();
});
</script>

<template>
  <section class="settings-page">
    <header class="settings-header">
      <div>
        <p class="eyebrow">设置中心</p>
        <h1>项目设置</h1>
        <p class="summary">
          集中管理项目基础信息、成员、权限、进度权重和协作入口。
        </p>
      </div>

      <button
        v-if="!hasProjectContext"
        class="primary-button"
        type="button"
        :disabled="isLoading"
        @click="handleOpenProject"
      >
        {{ isLoading ? "正在加载..." : "打开项目文件夹" }}
      </button>
    </header>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="message" class="message">{{ message }}</p>

    <p v-if="!localProject && !isLoading" class="empty-state">
      请先打开项目文件夹，再查看和保存项目设置。
    </p>

    <div v-else-if="localProject" class="settings-shell">
      <nav class="settings-nav" aria-label="设置分类">
        <p class="nav-title">设置</p>
        <button
          v-for="item in sectionItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: activeSection === item.key }"
          type="button"
          @click="activeSection = item.key"
        >
          {{ item.label }}
        </button>
      </nav>

      <section class="settings-content">
        <section v-if="activeSection === 'project'" class="settings-card">
          <header class="card-header">
            <h2>项目设置</h2>
            <p>修改项目在列表、工作台和导出报告中显示的基础信息。</p>
          </header>

          <div class="form-stack">
            <div class="form-row">
              <div class="row-label">
                <label for="project-name">项目名称</label>
                <p>显示在项目列表和工作台顶部。</p>
              </div>
              <div class="row-control">
                <input
                  id="project-name"
                  v-model="projectDraft.name"
                  :disabled="!canManageProject"
                />
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <label for="project-description">项目简介</label>
                <p>写给项目成员看的简短说明。</p>
              </div>
              <div class="row-control">
                <textarea
                  id="project-description"
                  v-model="projectDraft.description"
                  rows="4"
                  :disabled="!canManageProject"
                  placeholder="例如：短篇视觉小说汉化协作项目"
                />
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <label for="source-language">源语言</label>
                <p>原始文本使用的语言。</p>
              </div>
              <div class="row-control compact-control">
                <input
                  id="source-language"
                  v-model="projectDraft.source_language"
                  :disabled="!canManageProject"
                />
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <label for="target-language">目标语言</label>
                <p>译文输出使用的语言。</p>
              </div>
              <div class="row-control compact-control">
                <input
                  id="target-language"
                  v-model="projectDraft.target_language"
                  :disabled="!canManageProject"
                />
              </div>
            </div>
          </div>

          <p v-if="!canManageProject" class="notice-text">
            当前用户只能查看项目设置，不能修改。
          </p>

          <footer class="form-actions">
            <button
              class="primary-button"
              type="button"
              :disabled="isSavingProject || !canManageProject"
              @click="handleSaveProjectInfo"
            >
              {{ isSavingProject ? "正在保存..." : "保存项目设置" }}
            </button>
          </footer>
        </section>

        <section v-else-if="activeSection === 'members'" class="settings-card">
          <header class="card-header">
            <h2>成员管理</h2>
            <p>管理项目成员、用户组和登录密码。</p>
          </header>

          <MemberManagementPanel
            :members="localMembers"
            :current-user="currentUser"
            :project-root="props.projectRoot ?? localRoot ?? undefined"
            @members-updated="emit('membersUpdated', $event)"
          />
        </section>

        <section v-else-if="activeSection === 'roles'" class="settings-card">
          <header class="card-header">
            <h2>角色与权限</h2>
            <p>当前角色：{{ currentRoleText }}。权限编辑暂不可编辑。</p>
          </header>

          <p class="notice-text">
            owner / admin 等基础规则是项目流程约束。权限是本地软权限，用于减少误操作，不作为安全边界。
          </p>

          <div class="role-list">
            <article v-for="row in roleRows" :key="row.role" class="role-card">
              <div>
                <h3>{{ row.label }}</h3>
                <p>{{ row.role }} · {{ row.description }}</p>
              </div>
              <div class="permission-chips">
                <code v-for="permission in row.permissions" :key="permission">
                  {{ permission }}
                </code>
              </div>
              <span class="readonly-badge">暂不可编辑</span>
            </article>
          </div>
        </section>

        <section v-else-if="activeSection === 'workflow'" class="settings-card">
          <header class="card-header">
            <h2>工作流</h2>
            <p>设置校对次数，以及同一成员是否可以参与自己的译文校对或审核。</p>
          </header>

          <div class="form-stack">
            <div class="form-row">
              <div class="row-label">
                <label for="proofread-required">校对次数</label>
                <p>校对次数会影响词条状态、按钮、统计、文件进度和任务进度。</p>
              </div>
              <div class="row-control compact-control">
                <select
                  id="proofread-required"
                  v-model.number="workflowDraft.proofread_required"
                  :disabled="!canManageProject"
                >
                  <option :value="0">不需要校对</option>
                  <option :value="1">一次校对</option>
                  <option :value="2">二次校对</option>
                  <option :value="3">三次校对</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <span>审核阶段</span>
                <p>关闭后，校对完成即可视为主要流程完成。</p>
              </div>
              <div class="row-control checkbox-control">
                <input
                  id="review-required"
                  v-model="workflowDraft.review_required"
                  type="checkbox"
                  :disabled="!canManageProject"
                />
                <label for="review-required">需要审核</label>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <span>人员限制</span>
                <p>默认避免译者自校、自审，以及同一成员重复完成多轮校对。</p>
              </div>
              <div class="row-control workflow-options">
                <label class="checkbox-control">
                  <input
                    v-model="workflowDraft.allow_self_proofread"
                    type="checkbox"
                    :disabled="!canManageProject"
                  />
                  <span>允许译者校对自己的译文</span>
                </label>
                <label class="checkbox-control">
                  <input
                    v-model="workflowDraft.allow_self_review"
                    type="checkbox"
                    :disabled="!canManageProject"
                  />
                  <span>允许译者审核自己的译文</span>
                </label>
                <label class="checkbox-control">
                  <input
                    v-model="workflowDraft.allow_same_user_multi_proofread"
                    type="checkbox"
                    :disabled="!canManageProject"
                  />
                  <span>允许同一成员完成多轮校对</span>
                </label>
              </div>
            </div>
          </div>

          <p
            v-if="workflowDraft.proofread_required === 0 && weightDraft.proofread > 0"
            class="notice-text"
          >
            当前项目不需要校对，建议在进度权重中把校对权重设为 0。
          </p>

          <footer class="form-actions">
            <button
              class="primary-button"
              type="button"
              :disabled="isSavingWorkflow || !canManageProject"
              @click="handleSaveWorkflowSettings"
            >
              {{ isSavingWorkflow ? "正在保存..." : "保存工作流设置" }}
            </button>
          </footer>
        </section>

        <section v-else-if="activeSection === 'progress'" class="settings-card">
          <header class="card-header">
            <h2>进度权重</h2>
            <p>用于统计页和项目摘要的综合进度计算。</p>
          </header>

          <div class="form-stack">
            <div class="form-row">
              <div class="row-label">
                <label for="translation-weight">翻译权重</label>
                <p>默认 40%，代表完成译文的基础贡献。</p>
              </div>
              <div class="row-control number-control">
                <input
                  id="translation-weight"
                  v-model.number="weightDraft.translation"
                  type="number"
                  min="0"
                  max="100"
                  :disabled="!canEditProgressWeights"
                />
                <span>%</span>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <label for="proofread-weight">校对权重</label>
                <p>默认 30%，代表完成校对后的进度提升。</p>
              </div>
              <div class="row-control number-control">
                <input
                  id="proofread-weight"
                  v-model.number="weightDraft.proofread"
                  type="number"
                  min="0"
                  max="100"
                  :disabled="!canEditProgressWeights"
                />
                <span>%</span>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <label for="review-weight">审核权重</label>
                <p>默认 30%，代表最终审核通过。</p>
              </div>
              <div class="row-control number-control">
                <input
                  id="review-weight"
                  v-model.number="weightDraft.review"
                  type="number"
                  min="0"
                  max="100"
                  :disabled="!canEditProgressWeights"
                />
                <span>%</span>
              </div>
            </div>
          </div>

          <p :class="weightsAreValid ? 'success-text' : 'error-inline'">
            当前总和：{{ weightTotal }}%
            <span v-if="!weightsAreValid">，必须等于 100%。</span>
          </p>

          <footer class="form-actions">
            <button
              class="primary-button"
              type="button"
              :disabled="isSavingWeights || !weightsAreValid || !canEditProgressWeights"
              @click="handleSaveProgressWeights"
            >
              {{ isSavingWeights ? "正在保存..." : "保存进度权重" }}
            </button>
            <button
              class="secondary-button"
              type="button"
              :disabled="!canEditProgressWeights"
              @click="handleRestoreDefaultWeights"
            >
              恢复默认
            </button>
          </footer>
        </section>

        <section v-else-if="activeSection === 'export'" class="settings-card">
          <header class="card-header">
            <h2>导出设置</h2>
            <p>设置成品导出的默认格式、过滤和报告生成方式。</p>
          </header>

          <div class="form-stack">
            <div class="form-row">
              <div class="row-label">
                <label for="export-format">默认导出格式</label>
                <p>导入 / 导出页会默认使用这里的格式。</p>
              </div>
              <div class="row-control compact-control">
                <select
                  id="export-format"
                  v-model="exportDraft.default_format"
                  :disabled="!canManageProject"
                >
                  <option value="json">JSON</option>
                  <option value="txt">TXT 对照</option>
                  <option value="csv">CSV</option>
                  <option value="ks">KS</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <span>只导出已审核</span>
                <p>后续用于发布前过滤未审核内容。</p>
              </div>
              <div class="row-control checkbox-control">
                <input
                  id="reviewed-only"
                  v-model="exportDraft.only_reviewed"
                  type="checkbox"
                  :disabled="!canManageProject"
                />
                <label for="reviewed-only">只把已审核词条放入成品数据</label>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <span>包含原文</span>
                <p>用于生成对照检查报告。</p>
              </div>
              <div class="row-control checkbox-control">
                <input
                  id="include-source"
                  v-model="exportDraft.include_source"
                  type="checkbox"
                  :disabled="!canManageProject"
                />
                <label for="include-source">在成品数据中包含原文</label>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <span>包含键值</span>
                <p>用于定位源文件中的词条。</p>
              </div>
              <div class="row-control checkbox-control">
                <input
                  id="include-key"
                  v-model="exportDraft.include_key"
                  type="checkbox"
                  :disabled="!canManageProject"
                />
                <label for="include-key">在成品数据中包含键值</label>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <span>生成报告</span>
                <p>未翻译、争议和术语检查报告。</p>
              </div>
              <div class="row-control checkbox-control">
                <input
                  id="generate-report"
                  v-model="exportDraft.include_report"
                  type="checkbox"
                  :disabled="!canManageProject"
                />
                <label for="generate-report">导出检查报告</label>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <span>生成清单</span>
                <p>记录项目、导出时间、格式和本次设置。</p>
              </div>
              <div class="row-control checkbox-control">
                <input
                  id="generate-manifest"
                  v-model="exportDraft.include_manifest"
                  type="checkbox"
                  :disabled="!canManageProject"
                />
                <label for="generate-manifest">导出项目清单</label>
              </div>
            </div>
          </div>

          <footer class="form-actions">
            <button
              class="primary-button"
              type="button"
              :disabled="isSavingExportSettings || !canManageProject"
              @click="handleSaveExportSettings"
            >
              {{ isSavingExportSettings ? "正在保存..." : "保存导出设置" }}
            </button>
          </footer>
        </section>

        <section v-else-if="activeSection === 'sync'" class="settings-card">
          <header class="card-header">
            <h2>同步与备份</h2>
            <p>这里仅显示面向成员的协作入口，不暴露底层技术细节。</p>
          </header>

          <div class="sync-status">
            <strong>{{ syncStateText }}</strong>
            <p v-if="syncStatus?.fallbackMessage">{{ syncStatus.fallbackMessage }}</p>
          </div>

          <div class="form-stack">
            <div class="form-row">
              <div class="row-label">
                <span>同步项目</span>
                <p>获取负责人合并后的最新内容。</p>
              </div>
              <div class="row-control button-control">
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="!canSyncProject || isSyncing"
                  @click="handleSyncProject"
                >
                  {{ isSyncing ? "正在同步..." : "同步项目" }}
                </button>
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="isRefreshingSync"
                  @click="refreshSyncStatus"
                >
                  {{ isRefreshingSync ? "正在检查..." : "刷新状态" }}
                </button>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <span>导出修改包</span>
                <p>同步不可用时，把本地修改交给负责人合并。</p>
              </div>
              <div class="row-control button-control">
                <button
                  class="primary-button"
                  type="button"
                  @click="emit('openImportExport')"
                >
                  导出修改包
                </button>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <span>备份项目</span>
                <p>导出为 .hproj 项目文件，方便备份或交给其他成员打开。</p>
              </div>
              <div class="row-control button-control">
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="isExportingProjectFile"
                  @click="handleExportProjectFile"
                >
                  {{ isExportingProjectFile ? "正在导出..." : "导出为项目文件" }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section v-else-if="activeSection === 'updates'" class="settings-card">
          <header class="card-header">
            <h2>关于 / 更新</h2>
            <p>检查程序本体版本。项目数据迁移和格式变更不在这里处理。</p>
          </header>

          <div class="sync-status">
            <strong>{{ updateStatusText }}</strong>
            <p>更新来源：{{ updateState.sourceUrl }}</p>
          </div>

          <div class="form-stack">
            <div class="form-row">
              <div class="row-label">
                <span>当前版本</span>
                <p>来自应用包版本，不读取项目数据。</p>
              </div>
              <div class="row-control readonly-control">
                <strong>{{ currentProgramVersion }}</strong>
                <span>{{ updatePlatformText }}</span>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <label for="update-channel">更新通道</label>
                <p>stable 为默认通道，beta 用于提前查看测试版提示。</p>
              </div>
              <div class="row-control compact-control">
                <select
                  id="update-channel"
                  :value="selectedUpdateChannel"
                  @change="handleUpdateChannelChange"
                >
                  <option value="stable">stable</option>
                  <option value="beta">beta</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <span>手动检查</span>
                <p>读取固定的版本清单，发现新版本时显示下载入口。</p>
              </div>
              <div class="row-control button-control">
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="isCheckingUpdate"
                  @click="handleCheckForUpdates"
                >
                  {{ isCheckingUpdate ? "正在检查..." : "检查更新" }}
                </button>
                <button
                  class="primary-button"
                  type="button"
                  @click="handleOpenDownloadPage"
                >
                  打开下载页
                </button>
                <button
                  class="secondary-button"
                  type="button"
                  @click="handleInstallProgramUpdate"
                >
                  {{ updateState.pwaRefreshReady ? "立即刷新" : "安装占位" }}
                </button>
              </div>
            </div>

            <div class="form-row">
              <div class="row-label">
                <span>最近一次结果</span>
                <p>用于确认是否已经检查过当前通道。</p>
              </div>
              <div class="row-control update-result">
                <strong>{{ updateState.message }}</strong>
                <span>检查时间：{{ lastUpdateCheckText }}</span>
                <span>最新版本：{{ latestProgramVersion }}</span>
                <span v-if="updateState.latest">
                  发布日期：{{ updateState.latest.release_date }} ·
                  通道：{{ updateState.latest.channel }}
                </span>
                <span v-if="updateState.latest?.critical">这是重要更新。</span>
              </div>
            </div>
          </div>

          <div v-if="releaseNoteRows.length" class="update-notes">
            <strong>更新内容</strong>
            <ul>
              <li v-for="note in releaseNoteRows" :key="note">{{ note }}</li>
            </ul>
          </div>

          <p class="notice-text">
            Web / PWA 版本只提示刷新或打开下载页；桌面自动安装尚未实现。将来接入桌面 updater 时，需要做安装包签名校验。
          </p>
        </section>

        <section v-else class="settings-card danger-card">
          <header class="card-header">
            <h2>危险操作</h2>
            <p>这些操作可能影响项目数据。已实现的操作需要二次确认。</p>
          </header>

          <div class="danger-list">
            <div class="danger-row">
              <div>
                <strong>重建统计</strong>
                <p>重新刷新项目摘要。当前统计按词条实时计算，不会删除数据。</p>
              </div>
              <button
                class="secondary-button"
                type="button"
                :disabled="!canManageProject"
                @click="handleDangerAction('重建统计')"
              >
                重建统计
              </button>
            </div>

            <div class="danger-row disabled-row">
              <div>
                <strong>清理缓存</strong>
                <p>导出缓存清理尚未接入。当前版本不会删除任何文件。</p>
              </div>
              <button class="secondary-button" type="button" disabled>
                尚未实现
              </button>
            </div>

            <div class="danger-row disabled-row">
              <div>
                <strong>删除项目</strong>
                <p>项目删除需要更完整的备份和确认流程，当前仅显示占位。</p>
              </div>
              <button class="danger-button" type="button" disabled>
                尚未实现
              </button>
            </div>
          </div>
        </section>
      </section>
    </div>
  </section>
</template>

<style scoped>
.settings-page {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 2px 8px 28px;
  display: grid;
  gap: 16px;
  color: #1f2937;
}

.settings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  min-height: 0;
}

.eyebrow,
.summary,
.card-header p,
.row-label p,
.placeholder-note,
.notice-text,
.member-row span,
.role-card p,
.sync-status p,
.update-result span,
.update-notes,
.danger-row p {
  color: #5b6472;
}

.eyebrow,
h1,
h2,
h3,
p {
  margin: 0;
}

.eyebrow {
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 700;
}

h1 {
  color: #111827;
  font-size: 26px;
  line-height: 1.2;
}

h2 {
  color: #111827;
  font-size: 20px;
  line-height: 1.25;
}

h3 {
  color: #111827;
  font-size: 15px;
}

.summary,
.card-header p,
.row-label p,
.placeholder-note,
.notice-text,
.error-message,
.message,
.empty-state,
.success-text,
.error-inline,
.sync-status p,
.update-result,
.update-notes,
.danger-row p {
  line-height: 1.6;
}

.error-message,
.error-inline {
  color: #b42318;
}

.message,
.success-text {
  color: #166534;
}

.error-message,
.message {
  padding: 10px 12px;
  border-radius: 6px;
  background: #ffffff;
}

.error-message {
  border: 1px solid #f0b8aa;
}

.message {
  border: 1px solid #b7dfc2;
}

.empty-state {
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #4b5563;
}

.settings-shell {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  align-items: start;
  gap: 22px;
}

.settings-nav,
.settings-card {
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.settings-nav {
  position: sticky;
  top: 76px;
  display: grid;
  align-content: start;
  gap: 3px;
  padding: 12px;
}

.nav-title {
  padding: 4px 10px 8px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 700;
}

.nav-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 42px;
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
  background: #e8f3f1;
  color: #194b4f;
}

.nav-item.active {
  font-weight: 700;
  box-shadow: inset 4px 0 0 #2f6f73;
}

.settings-content {
  min-width: 0;
}

.settings-card {
  display: grid;
  gap: 18px;
  padding: 24px;
}

.card-header {
  display: grid;
  gap: 5px;
  padding-bottom: 14px;
  border-bottom: 1px solid #eef1f5;
}

.form-stack {
  display: grid;
}

.form-row {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
  padding: 16px 0;
  border-bottom: 1px solid #eef1f5;
}

.form-row:last-child {
  border-bottom: 0;
}

.row-label {
  display: grid;
  gap: 5px;
}

.row-label label,
.row-label span,
.danger-row strong {
  color: #111827;
  font-weight: 700;
}

.row-label p,
.placeholder-note,
.notice-text,
.danger-row p {
  font-size: 13px;
}

.row-control {
  min-width: 0;
  max-width: 560px;
}

.compact-control {
  max-width: 260px;
}

input,
select,
textarea {
  appearance: none;
  width: 100%;
  min-height: 40px;
  padding: 0 11px;
  border: 1px solid #c3ccd8;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  font-size: 14px;
  box-shadow: inset 0 1px 1px rgba(15, 23, 42, 0.03);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

textarea {
  min-height: 116px;
  padding: 10px 11px;
  resize: vertical;
  line-height: 1.55;
}

select {
  background-image:
    linear-gradient(45deg, transparent 50%, #6b7280 50%),
    linear-gradient(135deg, #6b7280 50%, transparent 50%);
  background-position:
    calc(100% - 16px) 17px,
    calc(100% - 11px) 17px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  padding-right: 30px;
}

input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

input:disabled,
select:disabled,
textarea:disabled {
  background: #f3f4f6;
  color: #6b7280;
  box-shadow: none;
}

.number-control {
  display: grid;
  grid-template-columns: 120px auto;
  align-items: center;
  gap: 8px;
  max-width: 190px;
}

.checkbox-control {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 38px;
  color: #374151;
}

.checkbox-control input {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  min-height: 16px;
  padding: 0;
  border-radius: 4px;
  background-position: center;
  background-repeat: no-repeat;
  background-size: 12px 12px;
}

.checkbox-control input:checked {
  border-color: #2f6f73;
  background-color: #2f6f73;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 16 16' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3.5 8.5 6.7 11.5 12.8 4.7' fill='none' stroke='%23fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
}

.checkbox-control input:disabled:checked {
  border-color: #94a3b8;
  background-color: #94a3b8;
}

.checkbox-control label {
  color: #374151;
  font-size: 14px;
}

.workflow-options {
  display: grid;
  gap: 8px;
}

.workflow-options .checkbox-control {
  justify-content: flex-start;
  min-height: 32px;
}

.button-control,
.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}

.form-actions {
  padding-top: 2px;
}

.primary-button,
.secondary-button,
.danger-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #ffffff;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.primary-button {
  border-color: #2f6f73;
  background: #2f6f73;
}

.primary-button:hover:not(:disabled) {
  background: #255f62;
}

.secondary-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

.secondary-button:hover:not(:disabled) {
  border-color: #9aa8b8;
  background: #f8fafb;
}

.danger-button {
  border-color: #b42318;
  background: #b42318;
}

.danger-button:hover:not(:disabled) {
  background: #982016;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.notice-text,
.placeholder-note,
.sync-status {
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f8fafb;
}

.member-table {
  display: grid;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.member-row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(180px, 1.25fr) 80px 96px;
  gap: 12px;
  align-items: center;
  min-height: 44px;
  padding: 9px 12px;
  border-top: 1px solid #eef1f5;
  background: #ffffff;
}

.member-row:first-child {
  border-top: 0;
}

.table-head {
  min-height: 36px;
  background: #f8fafb;
  color: #5b6472;
  font-size: 13px;
  font-weight: 700;
}

.table-action {
  color: #6b7280;
  font-size: 13px;
}

.role-list {
  display: grid;
  gap: 10px;
}

.role-card {
  position: relative;
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
}

.permission-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

code {
  padding: 3px 6px;
  border-radius: 5px;
  background: #eef2f7;
  color: #374151;
  font-size: 12px;
}

.readonly-badge {
  justify-self: start;
  padding: 3px 8px;
  border-radius: 999px;
  background: #f3f4f6;
  color: #5b6472;
  font-size: 12px;
}

.sync-status {
  display: grid;
  gap: 5px;
}

.sync-status strong {
  color: #111827;
}

.readonly-control,
.update-result {
  display: grid;
  gap: 4px;
}

.readonly-control strong,
.update-result strong,
.update-notes strong {
  color: #111827;
}

.readonly-control span,
.update-result span {
  font-size: 13px;
}

.update-notes {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f8fafb;
}

.update-notes ul {
  margin: 0;
  padding-left: 18px;
}

.danger-card {
  border-color: #f0c6bd;
}

.danger-list {
  display: grid;
  gap: 10px;
}

.danger-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 14px;
  border: 1px solid #ead7d2;
  border-radius: 8px;
  background: #fffafa;
}

.danger-row div {
  display: grid;
  gap: 5px;
}

.disabled-row {
  background: #fafafa;
  border-color: #e5e7eb;
}

@media (max-width: 900px) {
  .settings-shell {
    grid-template-columns: 1fr;
  }

  .settings-nav {
    position: static;
    display: flex;
    overflow-x: auto;
    white-space: nowrap;
  }

  .nav-title {
    display: none;
  }

  .nav-item {
    width: auto;
    flex: 0 0 auto;
  }
}

@media (max-width: 680px) {
  .settings-header,
  .form-row,
  .member-row,
  .danger-row {
    grid-template-columns: 1fr;
  }

  .settings-header {
    display: grid;
  }

  .settings-card {
    padding: 16px;
  }

  .row-control,
  .compact-control {
    max-width: none;
  }
}
</style>
