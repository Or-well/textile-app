<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  PERMISSION_ACTIONS,
  ROLE_DEFAULT_PERMISSIONS,
} from "../model/permissions";
import type { Member, ProjectConfig, Role } from "../model/types";
import {
  can,
  canConfigureStats,
  getCurrentUser,
  setCurrentUser,
} from "../services/permissions";
import { openProject, saveProject } from "../services/project";
import type { ProjectDirectoryHandle } from "../services/projectFs";
import { normalizeProgressWeights } from "../services/stats";
import { getSyncStatus, type SyncStatus } from "../services/sync";

type SettingsSection =
  | "project"
  | "members"
  | "roles"
  | "progress"
  | "export"
  | "sync"
  | "danger";

type EditableProjectConfig = ProjectConfig & {
  description?: string;
};

const props = defineProps<{
  project?: ProjectConfig;
  members?: Member[];
  projectRoot?: ProjectDirectoryHandle;
}>();

const emit = defineEmits<{
  projectUpdated: [project: ProjectConfig];
  openImportExport: [];
}>();

const sectionItems: Array<{ key: SettingsSection; label: string }> = [
  { key: "project", label: "项目设置" },
  { key: "members", label: "成员管理" },
  { key: "roles", label: "角色与权限" },
  { key: "progress", label: "进度权重" },
  { key: "export", label: "导出设置" },
  { key: "sync", label: "同步与备份" },
  { key: "danger", label: "危险操作" },
];

const roleOrder: Role[] = [
  "owner",
  "admin",
  "tech_lead",
  "translator",
  "proofreader",
  "reviewer",
  "publisher",
  "term_manager",
  "readonly",
];

const activeSection = ref<SettingsSection>("project");
const localProject = ref<EditableProjectConfig | null>(null);
const localMembers = ref<Member[]>([]);
const localRoot = ref<ProjectDirectoryHandle | null>(null);
const selectedUserId = ref(getCurrentUser()?.id ?? "");
const currentUser = ref<Member | null>(getCurrentUser());
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
const syncStatus = ref<SyncStatus>();
const isLoading = ref(false);
const isSavingProject = ref(false);
const isSavingWeights = ref(false);
const isRefreshingSync = ref(false);
const message = ref("");
const errorMessage = ref("");

const hasProjectContext = computed(() => Boolean(props.project));
const activeMembers = computed(() =>
  localMembers.value.filter((member) => member.active),
);
const selectedUser = computed(
  () => localMembers.value.find((member) => member.id === selectedUserId.value) ?? null,
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
    permissions: ROLE_DEFAULT_PERMISSIONS[role] ?? [],
  })),
);
const syncStateText = computed(() => {
  if (!syncStatus.value) {
    return "尚未检查同步状态";
  }

  return `${syncStatus.value.title}：${syncStatus.value.message}`;
});

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
}

function applyMembers(members: Member[]): void {
  const storedUser = getCurrentUser();

  localMembers.value = members;
  selectedUserId.value =
    members.find((member) => member.active && member.id === storedUser?.id)?.id ??
    members.find((member) => member.active)?.id ??
    "";

  if (selectedUser.value) {
    setCurrentUser(selectedUser.value);
    currentUser.value = selectedUser.value;
  } else {
    setCurrentUser(null);
    currentUser.value = null;
  }
}

function getWritableRoot(): ProjectDirectoryHandle {
  const root = props.projectRoot ?? localRoot.value;

  if (!root) {
    throw new Error("请先打开项目文件夹，才能保存项目设置。");
  }

  return root;
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

function handleSelectUser() {
  setCurrentUser(selectedUser.value);
  currentUser.value = selectedUser.value;
  message.value = selectedUser.value
    ? `当前用户：${selectedUser.value.name}`
    : "当前没有选中用户。";
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
    return;
  }

  if (actionName === "清理导出缓存") {
    message.value = "清理导出缓存仍是占位功能，当前没有删除任何文件。";
    return;
  }

  message.value = "删除项目仍是占位功能，当前没有删除任何项目数据。";
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
  if (localProject.value) {
    void refreshSyncStatus();
  }
});
</script>

<template>
  <section class="settings-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">项目设置</p>
        <h1>{{ localProject?.name || "设置中心" }}</h1>
        <p class="summary">
          集中管理项目基础信息、当前用户、权限说明、进度权重和协作入口。
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

    <div v-else-if="localProject" class="settings-layout">
      <nav class="settings-nav" aria-label="设置分类">
        <button
          v-for="item in sectionItems"
          :key="item.key"
          class="section-button"
          :class="{ active: activeSection === item.key }"
          type="button"
          @click="activeSection = item.key"
        >
          {{ item.label }}
        </button>
      </nav>

      <section class="settings-content">
        <section v-if="activeSection === 'project'" class="content-panel">
          <div class="panel-heading">
            <h2>项目设置</h2>
            <p>这些信息保存到项目的 project.json。</p>
          </div>

          <div class="form-grid">
            <label>
              <span>项目名称</span>
              <input v-model="projectDraft.name" :disabled="!canManageProject" />
            </label>

            <label>
              <span>项目简介</span>
              <textarea
                v-model="projectDraft.description"
                rows="4"
                :disabled="!canManageProject"
                placeholder="写给项目成员看的简短说明"
              />
            </label>

            <label>
              <span>源语言</span>
              <input
                v-model="projectDraft.source_language"
                :disabled="!canManageProject"
              />
            </label>

            <label>
              <span>目标语言</span>
              <input
                v-model="projectDraft.target_language"
                :disabled="!canManageProject"
              />
            </label>
          </div>

          <button
            class="primary-button"
            type="button"
            :disabled="isSavingProject || !canManageProject"
            @click="handleSaveProjectInfo"
          >
            {{ isSavingProject ? "正在保存..." : "保存项目设置" }}
          </button>
          <p v-if="!canManageProject" class="muted-text">
            当前用户只能查看项目设置，不能修改。
          </p>
        </section>

        <section v-else-if="activeSection === 'members'" class="content-panel">
          <div class="panel-heading">
            <h2>成员管理</h2>
            <p>当前版本支持选择当前用户，成员增删改留到后续包处理。</p>
          </div>

          <label class="user-select">
            <span>当前用户</span>
            <select v-model="selectedUserId" @change="handleSelectUser">
              <option value="">未选择</option>
              <option
                v-for="member in activeMembers"
                :key="member.id"
                :value="member.id"
              >
                {{ member.name }}
              </option>
            </select>
          </label>

          <div class="table-list">
            <div v-for="member in localMembers" :key="member.id" class="table-row">
              <strong>{{ member.name }}</strong>
              <span>{{ member.id }}</span>
              <span>{{ member.roles.join(" / ") }}</span>
              <span>{{ member.active ? "启用" : "停用" }}</span>
            </div>
          </div>
        </section>

        <section v-else-if="activeSection === 'roles'" class="content-panel">
          <div class="panel-heading">
            <h2>角色与权限</h2>
            <p>
              权限由角色默认权限、成员额外允许和成员额外拒绝合并计算。owner / admin
              等基础规则当前只读展示。
            </p>
          </div>

          <div class="role-list">
            <article v-for="row in roleRows" :key="row.role" class="role-row">
              <h3>{{ row.role }}</h3>
              <div class="permission-list">
                <code
                  v-for="permission in row.permissions"
                  :key="permission"
                >
                  {{ permission }}
                </code>
              </div>
            </article>
          </div>
        </section>

        <section v-else-if="activeSection === 'progress'" class="content-panel">
          <div class="panel-heading">
            <h2>进度权重</h2>
            <p>用于统计页、文件页和任务页的综合进度计算。</p>
          </div>

          <div class="weight-grid">
            <label>
              <span>翻译权重</span>
              <input
                v-model.number="weightDraft.translation"
                type="number"
                min="0"
                max="100"
                :disabled="!canEditProgressWeights"
              />
            </label>
            <label>
              <span>校对权重</span>
              <input
                v-model.number="weightDraft.proofread"
                type="number"
                min="0"
                max="100"
                :disabled="!canEditProgressWeights"
              />
            </label>
            <label>
              <span>审核权重</span>
              <input
                v-model.number="weightDraft.review"
                type="number"
                min="0"
                max="100"
                :disabled="!canEditProgressWeights"
              />
            </label>
          </div>

          <p :class="weightsAreValid ? 'message-inline' : 'warning-text'">
            当前总和：{{ weightTotal }}%
          </p>

          <button
            class="primary-button"
            type="button"
            :disabled="isSavingWeights || !weightsAreValid || !canEditProgressWeights"
            @click="handleSaveProgressWeights"
          >
            {{ isSavingWeights ? "正在保存..." : "保存进度权重" }}
          </button>
        </section>

        <section v-else-if="activeSection === 'export'" class="content-panel">
          <div class="panel-heading">
            <h2>导出设置</h2>
            <p>当前仅展示项目导出能力，复杂导出规则后续补充。</p>
          </div>

          <dl class="info-list">
            <div>
              <dt>允许修改包</dt>
              <dd>{{ localProject.settings.allow_change_package ? "允许" : "不允许" }}</dd>
            </div>
            <div>
              <dt>成品导出</dt>
              <dd>使用导入 / 导出页的现有导出流程</dd>
            </div>
            <div>
              <dt>导出规则</dt>
              <dd>后续支持自定义文件命名和检查项</dd>
            </div>
          </dl>
        </section>

        <section v-else-if="activeSection === 'sync'" class="content-panel">
          <div class="panel-heading">
            <h2>同步与备份</h2>
            <p>同步底层由 sync.ts 包装，当前页面只展示状态和协作入口。</p>
          </div>

          <div class="sync-box">
            <strong>{{ syncStateText }}</strong>
            <p v-if="syncStatus?.fallbackMessage">{{ syncStatus.fallbackMessage }}</p>
          </div>

          <div class="button-row">
            <button
              class="secondary-button"
              type="button"
              :disabled="isRefreshingSync"
              @click="refreshSyncStatus"
            >
              {{ isRefreshingSync ? "正在检查..." : "刷新同步状态" }}
            </button>
            <button
              class="primary-button"
              type="button"
              @click="emit('openImportExport')"
            >
              导出修改包
            </button>
          </div>

          <p class="muted-text">
            .hproj 项目包与自动备份仍是后续支持项，当前版本不会生成或导入 .hproj。
          </p>
        </section>

        <section v-else class="content-panel danger-panel">
          <div class="panel-heading">
            <h2>危险操作</h2>
            <p>所有危险操作都会二次确认。当前版本只提供入口和安全占位。</p>
          </div>

          <button
            class="secondary-button"
            type="button"
            :disabled="!canManageProject"
            @click="handleDangerAction('重建统计')"
          >
            重建统计
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="!canManageProject"
            @click="handleDangerAction('清理导出缓存')"
          >
            清理导出缓存
          </button>
          <button
            class="danger-button"
            type="button"
            :disabled="!canManageProject"
            @click="handleDangerAction('删除项目')"
          >
            删除项目占位
          </button>
        </section>
      </section>
    </div>
  </section>
</template>

<style scoped>
.settings-page {
  display: grid;
  gap: 16px;
  color: #1f2937;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.eyebrow,
.summary,
.panel-heading p,
.muted-text,
.info-list dt,
.table-row span {
  color: #5b6472;
}

.eyebrow,
h1,
h2,
h3,
p,
dl,
dd {
  margin: 0;
}

.eyebrow {
  margin-bottom: 6px;
  font-size: 14px;
}

h1 {
  color: #111827;
  font-size: 28px;
  line-height: 1.2;
}

h2 {
  color: #111827;
  font-size: 20px;
}

h3 {
  color: #111827;
  font-size: 16px;
}

.summary,
.panel-heading p,
.muted-text,
.error-message,
.message,
.empty-state,
.warning-text,
.message-inline {
  line-height: 1.7;
}

.error-message {
  color: #b42318;
}

.message,
.message-inline {
  color: #166534;
}

.warning-text {
  color: #b45309;
}

.empty-state {
  padding: 18px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #4b5563;
}

.settings-layout {
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr);
  gap: 16px;
}

.settings-nav,
.content-panel {
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.settings-nav {
  display: grid;
  align-content: start;
  gap: 4px;
  padding: 10px;
}

.section-button {
  min-height: 38px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #374151;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.section-button:hover,
.section-button.active {
  background: #eef6f4;
  color: #194b4f;
}

.section-button.active {
  font-weight: 700;
}

.settings-content,
.content-panel,
.role-list {
  display: grid;
  gap: 14px;
}

.content-panel {
  padding: 18px;
}

.panel-heading {
  display: grid;
  gap: 6px;
}

.form-grid,
.weight-grid {
  display: grid;
  gap: 12px;
}

.weight-grid {
  grid-template-columns: repeat(3, minmax(120px, 1fr));
}

label {
  display: grid;
  gap: 7px;
}

label span {
  color: #5b6472;
  font-size: 13px;
}

input,
select,
textarea {
  width: 100%;
  min-height: 40px;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
}

textarea {
  min-height: 104px;
  padding: 10px;
  resize: vertical;
  line-height: 1.6;
}

input:disabled,
select:disabled,
textarea:disabled {
  background: #f3f4f6;
  color: #6b7280;
}

.primary-button,
.secondary-button,
.danger-button {
  justify-self: start;
  min-height: 40px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  color: #ffffff;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.primary-button {
  background: #2f6f73;
}

.secondary-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

.danger-button {
  background: #b42318;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.user-select {
  max-width: 360px;
}

.table-list {
  display: grid;
  gap: 8px;
}

.table-row {
  display: grid;
  grid-template-columns: minmax(120px, 0.9fr) minmax(120px, 0.9fr) minmax(180px, 1fr) 72px;
  gap: 12px;
  align-items: center;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f8fafb;
}

.role-row {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f8fafb;
}

.permission-list {
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

.info-list {
  display: grid;
  gap: 10px;
}

.info-list div {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  border-radius: 6px;
  background: #f8fafb;
}

.info-list dt {
  font-size: 13px;
}

.info-list dd {
  color: #111827;
}

.sync-box {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f8fafb;
}

.button-row,
.danger-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.danger-panel {
  align-items: flex-start;
}

.danger-panel .panel-heading {
  flex: 1 0 100%;
}

@media (max-width: 860px) {
  .page-header,
  .settings-layout,
  .weight-grid,
  .table-row,
  .info-list div {
    grid-template-columns: 1fr;
  }

  .page-header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
