<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { createProjectBackupPublisherKey } from "../composables/useProjectBackupPublisherKey";
import ChangePreview from "../components/ChangePreview.vue";
import ConflictResolver from "../components/ConflictResolver.vue";
import ProjectBackupKeyReminderDialog from "../components/ProjectBackupKeyReminderDialog.vue";
import ProjectPageHeader from "../components/ProjectPageHeader.vue";
import SigningKeySetupDialog from "../components/SigningKeySetupDialog.vue";
import type {
  Member,
  ProjectConfig,
  ReleaseExportFormat,
  Task,
} from "../model/types";
import {
  completeProjectPackageExport,
  exportProjectPackage,
  getProjectPackageSuggestedFileName,
  shouldWarnProjectBackupMissingPublisherKey,
} from "../services/projectPackage";
import {
  applyChangePackage,
  completeChangePackageExport,
  detectConflicts,
  exportChangePackage,
  getChangePackageSuggestedFileName,
  previewChangePackage,
  readChangePackage,
  setChangesProjectStorage,
  validateChangePackage,
  type ChangeConflict,
  type ChangePackagePreview,
  type ConflictResolution,
  type ExportChangePackageMode,
  type ReadChangePackage,
} from "../services/changes";
import {
  exportProject,
  getReleaseExportSuggestedFileName,
  getReleaseExportSummary,
  normalizeReleaseExportOptions,
  setExporterProjectStorage,
  type ReleaseExportSummary,
} from "../services/exporter";
import {
  canDangerousImportChangePackage,
  canExportMemberChangePackage,
  canExportMaintenanceChangePackage,
  canExportProjectUpdatePackage,
  canExportRelease,
  canGenerateKey,
  canImportPrivateKey,
  canImportMemberChangePackage,
  canImportMaintenanceChangePackage,
  canImportProjectUpdatePackage,
  canManageTask,
  canProjectBackup,
  canReviewChangePackage,
  canSignChangePackage,
  canVerifyChangePackage,
  getCurrentUser,
} from "../services/permissions";
import { projectRequiresSignedChangePackages } from "../services/collaboration";
import {
  commitPreparedOwnSigningKeyGeneration,
  exportPreparedPublicKeyRegistrationFile,
  getMemberSigningReadiness,
  importOwnKeyFile,
  memberKeyFileToBlob,
  prepareOwnSigningKeyGeneration,
  type SigningKeyReadiness,
} from "../services/keyManager";
import {
  loadMembersFromStorage,
  loadProjectFromStorage,
  openProject,
} from "../services/project";
import type { ProjectDirectoryHandle } from "../services/projectFs";
import type { ProjectStorage } from "../services/projectStorage";
import { withAppOperation } from "../services/appOperation";
import { loadTasks, setTasksProjectStorage } from "../services/tasks";
import {
  saveGeneratedFile,
  saveGeneratedFileFromFactory,
  saveGeneratedFilesFromFactories,
} from "../utils/saveBlob";
import { nowIso } from "../utils/time";

const props = defineProps<{
  project?: ProjectConfig;
  members?: Member[];
  projectRoot?: ProjectDirectoryHandle;
  projectStorage?: ProjectStorage;
  currentUser?: Member | null;
  targetPanel?: "export" | "import";
}>();

const emit = defineEmits<{
  projectUpdated: [project: ProjectConfig];
  membersUpdated: [members: Member[]];
}>();

const projectName = ref("");
const localRoot = ref<ProjectDirectoryHandle | null>(null);
const localProjectStorage = ref<ProjectStorage | null>(null);
const localProject = ref<ProjectConfig | null>(null);
const localMembers = ref<Member[]>([]);
const tasks = ref<Task[]>([]);
const selectedTaskIds = ref<string[]>([]);
const exportMode = ref<ExportChangePackageMode>("member_changes");
const signChangePackage = ref(true);
const includeOwnCredentials = ref(false);
const releaseFormat = ref<ReleaseExportFormat>("json");
const releaseOnlyReviewed = ref(false);
const releaseIncludeSource = ref(true);
const releaseIncludeKey = ref(true);
const releaseIncludeReport = ref(true);
const releaseIncludeManifest = ref(true);
const releaseSummary = ref<ReleaseExportSummary>();
const isLoading = ref(false);
const isExporting = ref(false);
const isExportingRelease = ref(false);
const isExportingProjectFile = ref(false);
const isLoadingReleaseSummary = ref(false);
const isReadingPackage = ref(false);
const isApplyingPackage = ref(false);
const showProjectBackupKeyReminder = ref(false);
const isCreatingProjectBackupPublisherKey = ref(false);
const projectBackupKeyReminderError = ref("");
const errorMessage = ref("");
const message = ref("");
const changePackage = ref<ReadChangePackage>();
const packagePreview = ref<ChangePackagePreview>();
const conflicts = ref<ChangeConflict[]>([]);
const changeExportSection = ref<HTMLElement>();
const changeImportSection = ref<HTMLElement>();
const changePackageInput = ref<HTMLInputElement>();

type SigningKeySetupRequest = {
  readiness: Exclude<SigningKeyReadiness, "ready">;
  signingReason: string;
};

const currentUser = computed(() => props.currentUser ?? getCurrentUser());
const currentProject = computed(() => props.project ?? localProject.value);
const membersForKeys = computed(() => props.members ?? localMembers.value);
const currentSigningMember = computed(
  () =>
    membersForKeys.value.find((member) => member.id === currentUser.value?.id) ??
    currentUser.value ??
    null,
);
const hasProjectContext = computed(() => Boolean(props.project));
const canExportChanges = computed(() => canExportMemberChangePackage(currentUser.value));
const canExportMaintenance = computed(() =>
  canExportMaintenanceChangePackage(currentUser.value),
);
const canExportProjectUpdate = computed(() =>
  canExportProjectUpdatePackage(currentUser.value),
);
const canImportPackages = computed(() => canImportMemberChangePackage(currentUser.value));
const canImportMaintenance = computed(() =>
  canImportMaintenanceChangePackage(currentUser.value),
);
const canImportProjectUpdate = computed(() =>
  canImportProjectUpdatePackage(currentUser.value),
);
const canReviewPackages = computed(() => canReviewChangePackage(currentUser.value));
const canSignPackages = computed(() => canSignChangePackage(currentUser.value));
const canImportOwnPrivateKey = computed(() => canImportPrivateKey(currentUser.value));
const canCreateProjectBackupPublisherKey = computed(() =>
  canGenerateKey(currentUser.value),
);
const canGenerateSigningKeyForSetup = computed(() => {
  const hasCurrentActivePublicKey = Boolean(
    currentSigningMember.value?.public_key &&
      currentSigningMember.value.key_id &&
      !currentSigningMember.value.key_revoked_at,
  );

  return Boolean(
    currentUser.value &&
      canGenerateKey(currentUser.value) &&
      !(
        exportMode.value === "project_update" &&
        signingKeySetup.value?.readiness === "private_key_not_loaded" &&
        hasCurrentActivePublicKey
      ),
  );
});
const canVerifyPackages = computed(() => canVerifyChangePackage(currentUser.value));
const canDangerousImport = computed(() =>
  canDangerousImportChangePackage(currentUser.value),
);
const canExportFinalRelease = computed(() => canExportRelease(currentUser.value));
const canExportProjectBackup = computed(() => canProjectBackup(currentUser.value));
const shouldWarnProjectBackupKey = computed(() =>
  shouldWarnProjectBackupMissingPublisherKey(
    currentProject.value,
    currentSigningMember.value,
  ),
);
const canExportAnyTaskChange = computed(() => canManageTask(currentUser.value));
const exportableTasks = computed(() =>
  canExportAnyTaskChange.value
    ? tasks.value
    : tasks.value.filter((task) => task.assignee === currentUser.value?.id),
);
const taskExportEmptyText = computed(() =>
  canExportAnyTaskChange.value
    ? "当前没有可导出的任务。"
    : "没有分配给你的可导出任务。",
);
const requiresSignedChangePackage = computed(() =>
  projectRequiresSignedChangePackages(props.project ?? localProject.value),
);
const mustSignChangePackage = computed(
  () => exportMode.value === "project_update" || requiresSignedChangePackage.value,
);
const canChooseChangePackageSignature = computed(
  () => exportMode.value !== "project_update" && !requiresSignedChangePackage.value,
);
const canIncludeOwnCredentials = computed(
  () => exportMode.value === "member_changes" || exportMode.value === "task_changes",
);
const shouldSignChangePackage = computed(
  () =>
    mustSignChangePackage.value ||
    (canChooseChangePackageSignature.value &&
      signChangePackage.value &&
      canSignPackages.value),
);
const projectRootForExport = computed(() => props.projectRoot ?? localRoot.value);
const projectStorageForServices = computed(
  () => props.projectStorage ?? localProjectStorage.value,
);
const canSelectImportFile = computed(
  () =>
    canVerifyPackages.value &&
    (canImportPackages.value ||
      canImportMaintenance.value ||
      canImportProjectUpdate.value),
);
const canExportSelectedMode = computed(() =>
  exportMode.value === "maintenance_changes"
    ? canExportMaintenance.value
    : exportMode.value === "project_update"
      ? canExportProjectUpdate.value
      : canExportChanges.value,
);
const emptyStateText = computed(() =>
  projectName.value
    ? "当前项目暂无可导出的任务。"
    : "请打开项目文件夹，选择用户和任务后导出修改。",
);
const packageValidation = computed(() => packagePreview.value?.validation);
const needsDangerousImport = computed(
  () => packageValidation.value?.requiresDangerousImport ?? false,
);
const canApplySelectedPackage = computed(() => {
  const validation = packageValidation.value;

  if (!validation) {
    return false;
  }

  if (validation.projectMatch !== "matched") {
    return false;
  }

  if (validation.packageType === "project_update") {
    if (!canImportProjectUpdate.value) {
      return false;
    }
  } else if (validation.packageType === "maintenance_changes") {
    if (!canImportMaintenance.value) {
      return false;
    }
  } else if (!canImportPackages.value) {
    return false;
  }

  if (validation.requiresDangerousImport) {
    if (
      validation.requiresSignedPackage &&
      validation.signatureStatus !== "valid"
    ) {
      return false;
    }

    return canDangerousImport.value;
  }

  return validation.canImportNormally;
});
const applyDisabledReason = computed(() => {
  const validation = packageValidation.value;

  if (!canSelectImportFile.value) {
    return "当前成员没有导入修改包的权限。";
  }

  if (!validation) {
    return "";
  }

  if (validation.projectMatch !== "matched") {
    return "修改包不属于当前项目，不能导入。";
  }

  if (validation.packageType === "project_update" && !canImportProjectUpdate.value) {
    return "当前成员没有接收项目更新包的权限。";
  }

  if (
    validation.packageType === "maintenance_changes" &&
    !canImportMaintenance.value
  ) {
    return "当前成员没有导入项目维护修改的权限。";
  }

  if (validation.requiresDangerousImport && !canDangerousImport.value) {
    return "内容完整性未通过，当前成员没有危险导入权限。";
  }

  if (
    validation.requiresSignedPackage &&
    validation.signatureStatus !== "valid"
  ) {
    return "当前项目要求修改包带有有效成员签名。";
  }

  if (
    validation.packageType !== "project_update" &&
    validation.packageType !== "maintenance_changes" &&
    !canImportPackages.value
  ) {
    return "当前成员没有导入普通修改包的权限。";
  }

  return "";
});
const releaseOptionPayload = computed(() => ({
  format: releaseFormat.value,
  only_reviewed: releaseOnlyReviewed.value,
  include_source: releaseIncludeSource.value,
  include_key: releaseIncludeKey.value,
  include_report: releaseIncludeReport.value,
  include_manifest: releaseIncludeManifest.value,
}));
const signingKeySetup = ref<SigningKeySetupRequest | null>(null);
const isPreparingSigningKey = ref(false);
const signingKeySetupError = ref("");
let resolveSigningKeySetup: ((ready: boolean) => void) | null = null;

function applyReleaseSettings(project: ProjectConfig) {
  const options = normalizeReleaseExportOptions(project);

  releaseFormat.value = options.format;
  releaseOnlyReviewed.value = options.only_reviewed;
  releaseIncludeSource.value = options.include_source;
  releaseIncludeKey.value = options.include_key;
  releaseIncludeReport.value = options.include_report;
  releaseIncludeManifest.value = options.include_manifest;
}

async function refreshReleaseSummary() {
  if (!projectName.value) {
    releaseSummary.value = undefined;
    return;
  }

  isLoadingReleaseSummary.value = true;

  try {
    releaseSummary.value = await getReleaseExportSummary(releaseOptionPayload.value);
  } catch {
    releaseSummary.value = undefined;
  } finally {
    isLoadingReleaseSummary.value = false;
  }
}

async function loadImportExportState() {
  isLoading.value = true;
  errorMessage.value = "";
  message.value = "";
  changePackage.value = undefined;
  packagePreview.value = undefined;
  conflicts.value = [];

  try {
    tasks.value = await loadTasks();
    selectedTaskIds.value = exportableTasks.value[0]?.id
      ? [exportableTasks.value[0].id]
      : [];
    await refreshReleaseSummary();
  } catch (error) {
    tasks.value = [];
    selectedTaskIds.value = [];
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "导入导出准备失败。请确认项目数据可以读取。";
  } finally {
    isLoading.value = false;
  }
}

async function initializeFromProjectContext() {
  if (!props.project) {
    return;
  }

  projectName.value = props.project.name;
  localProject.value = props.project;
  localRoot.value = props.projectRoot ?? null;
  localProjectStorage.value = props.projectStorage ?? null;
  localMembers.value = props.members ?? [];
  applyReleaseSettings(props.project);

  await loadImportExportState();
  await focusTargetPanel();
}

async function focusTargetPanel(): Promise<void> {
  await nextTick();

  if (props.targetPanel === "export") {
    changeExportSection.value?.scrollIntoView({
      behavior: "auto",
      block: "start",
    });
    changeExportSection.value?.focus({ preventScroll: true });
  }

  if (props.targetPanel === "import") {
    changeImportSection.value?.scrollIntoView({
      behavior: "auto",
      block: "start",
    });

    if (canSelectImportFile.value) {
      changePackageInput.value?.focus({ preventScroll: true });
    } else {
      changeImportSection.value?.focus({ preventScroll: true });
    }
  }
}

async function handleOpenProject() {
  isLoading.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const project = await openProject();

    projectName.value = project.config.name;
    localProject.value = project.config;
    localRoot.value = project.root;
    localProjectStorage.value = project.storage;
    localMembers.value = project.members;
    applyReleaseSettings(project.config);

    setChangesProjectStorage(project.storage);
    setExporterProjectStorage(project.storage);
    setTasksProjectStorage(project.storage);
    await loadImportExportState();
  } catch (error) {
    projectName.value = "";
    localProject.value = null;
    localRoot.value = null;
    localProjectStorage.value = null;
    localMembers.value = [];
    tasks.value = [];
    selectedTaskIds.value = [];
    changePackage.value = undefined;
    packagePreview.value = undefined;
    conflicts.value = [];

    if (error instanceof DOMException && error.name === "AbortError") {
      errorMessage.value = "没有打开项目文件夹。你可以重新点击按钮选择项目。";
    } else if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = "导出准备失败。请确认选择的是项目根目录。";
    }
  } finally {
    isLoading.value = false;
  }
}

function requestSigningKeySetup(
  request: SigningKeySetupRequest,
): Promise<boolean> {
  resolveSigningKeySetup?.(false);
  signingKeySetup.value = request;
  signingKeySetupError.value = "";

  return new Promise((resolve) => {
    resolveSigningKeySetup = resolve;
  });
}

function closeSigningKeySetup(ready: boolean): void {
  resolveSigningKeySetup?.(ready);
  resolveSigningKeySetup = null;
  signingKeySetup.value = null;
  signingKeySetupError.value = "";
  isPreparingSigningKey.value = false;
}

function handleCancelSigningKeySetup(): void {
  errorMessage.value = "已取消导出。请先导入私钥文件或创建签名密钥。";
  closeSigningKeySetup(false);
}

function syncMembersAfterKeySetup(members: Member[], successMessage: string): void {
  localMembers.value = members;
  emit("membersUpdated", members);
  message.value = successMessage;
}

async function handleCreateProjectBackupPublisherKey(): Promise<void> {
  const projectRoot = projectRootForExport.value;

  if (!projectRoot) {
    projectBackupKeyReminderError.value = "请先打开项目，再创建负责人身份密钥。";
    return;
  }

  if (!currentUser.value) {
    projectBackupKeyReminderError.value = "请先登录。";
    return;
  }

  if (!canCreateProjectBackupPublisherKey.value) {
    projectBackupKeyReminderError.value = "当前成员没有生成身份密钥的权限。";
    return;
  }

  isCreatingProjectBackupPublisherKey.value = true;
  projectBackupKeyReminderError.value = "";
  errorMessage.value = "";
  message.value = "";

  try {
    const result = await createProjectBackupPublisherKey(
      projectRoot,
      membersForKeys.value,
      currentUser.value,
    );

    if (result.status === "not_saved") {
      projectBackupKeyReminderError.value = result.reason;
      return;
    }

    syncMembersAfterKeySetup(
      result.members,
      `负责人身份密钥已创建，私钥文件已保存为 ${result.fileName}，公钥已写入项目。请重新导出项目备份。`,
    );
    showProjectBackupKeyReminder.value = false;
  } catch (error) {
    projectBackupKeyReminderError.value =
      error instanceof Error ? error.message : "创建负责人身份密钥失败。";
  } finally {
    isCreatingProjectBackupPublisherKey.value = false;
  }
}

async function handleImportSigningKey(file: File): Promise<void> {
  const request = signingKeySetup.value;

  if (!request) {
    return;
  }

  if (!projectRootForExport.value) {
    signingKeySetupError.value = "请先打开项目，再导入私钥文件。";
    return;
  }

  if (!currentUser.value) {
    signingKeySetupError.value = "请先登录。";
    return;
  }

  if (!canImportOwnPrivateKey.value) {
    signingKeySetupError.value = "当前成员没有导入私钥文件的权限。";
    return;
  }

  isPreparingSigningKey.value = true;
  signingKeySetupError.value = "";

  try {
    const result = await importOwnKeyFile(
      projectRootForExport.value,
      membersForKeys.value,
      currentUser.value,
      await file.text(),
      {
        requireExistingPublicKeyMatch:
          request.readiness === "private_key_not_loaded",
      },
    );

    syncMembersAfterKeySetup(
      result.members,
      "私钥文件已导入，本机可用于导出签名修改包。",
    );
    closeSigningKeySetup(true);
  } catch (error) {
    signingKeySetupError.value =
      error instanceof Error ? error.message : "导入私钥文件失败。";
  } finally {
    isPreparingSigningKey.value = false;
  }
}

async function handleGenerateSigningKey(): Promise<void> {
  if (!signingKeySetup.value) {
    return;
  }

  if (!projectRootForExport.value) {
    signingKeySetupError.value = "请先打开项目，再创建身份密钥。";
    return;
  }

  if (!currentUser.value) {
    signingKeySetupError.value = "请先登录。";
    return;
  }

  if (!canGenerateKey(currentUser.value)) {
    signingKeySetupError.value = "当前成员没有生成签名密钥的权限。";
    return;
  }

  isPreparingSigningKey.value = true;
  signingKeySetupError.value = "";

  try {
    const hasCurrentActivePublicKey = Boolean(
      currentSigningMember.value?.public_key &&
        currentSigningMember.value.key_id &&
        !currentSigningMember.value.key_revoked_at,
    );

    if (
      exportMode.value === "project_update" &&
      signingKeySetup.value.readiness === "private_key_not_loaded" &&
      hasCurrentActivePublicKey
    ) {
      signingKeySetupError.value =
        "项目更新包必须使用当前已登记公钥对应的旧私钥签名。请导入匹配的私钥；如果旧私钥已丢失，需要重新分发项目备份建立信任。";
      return;
    }

    const generation = await prepareOwnSigningKeyGeneration(
      membersForKeys.value,
      currentUser.value,
    );
    const keyFile = memberKeyFileToBlob(generation.keyFile);

    if (exportMode.value !== "project_update") {
      if (!currentProject.value) {
        signingKeySetupError.value =
          "当前项目配置不可用。本次签名导出不会继续。";
        return;
      }

      const registration = await exportPreparedPublicKeyRegistrationFile(
        generation,
        currentProject.value.project_id,
      );
      const savedFiles = await saveGeneratedFilesFromFactories([
        {
          fileName: keyFile.fileName,
          createBlob: () => keyFile.blob,
        },
        {
          fileName: registration.fileName,
          createBlob: () => registration.blob,
        },
      ]);

      if (!savedFiles.saved) {
        signingKeySetupError.value =
          `${savedFiles.reason} 项目中没有登记这把公钥，本次签名导出不会继续。`;
        return;
      }

      syncMembersAfterKeySetup(
        (
          await commitPreparedOwnSigningKeyGeneration(
            projectRootForExport.value,
            generation,
            currentUser.value,
          )
        ).members,
        `新密钥和公钥登记文件已保存。请先把 ${savedFiles.files[1]?.fileName ?? registration.fileName} 交给负责人登记，并接收包含该公钥的可信项目更新后再导出签名修改包。`,
      );

      signingKeySetupError.value =
        `新密钥和公钥登记文件已保存。请先把 ${savedFiles.files[1]?.fileName ?? registration.fileName} 交给负责人登记，并接收包含该公钥的可信项目更新后再导出签名修改包。`;
      return;
    }

    const saved = await saveGeneratedFile(keyFile.blob, keyFile.fileName);

    if (!saved.saved) {
      signingKeySetupError.value = `${saved.reason} 项目中没有登记这把公钥。`;
      return;
    }

    const result = await commitPreparedOwnSigningKeyGeneration(
      projectRootForExport.value,
      generation,
      currentUser.value,
    );

    syncMembersAfterKeySetup(
      result.members,
      `签名密钥已创建，私钥文件已保存为 ${saved.fileName}，公钥已写入项目。`,
    );

    closeSigningKeySetup(true);
  } catch (error) {
    signingKeySetupError.value =
      error instanceof Error ? error.message : "生成签名密钥失败。";
  } finally {
    isPreparingSigningKey.value = false;
  }
}

async function ensureSigningKeyIfNeeded(shouldSign: boolean): Promise<boolean> {
  if (!shouldSign) {
    return true;
  }

  const requiredByProject = mustSignChangePackage.value;
  const signingReason = requiredByProject
    ? "当前项目要求修改包签名"
    : "你已选择给本次修改包签名";

  if (!currentUser.value) {
    errorMessage.value = "请先登录。";
    return false;
  }

  if (!canSignPackages.value) {
    errorMessage.value =
      `${signingReason}，但当前成员没有签名修改包的权限。请联系负责人调整权限。`;
    return false;
  }

  const readiness = getMemberSigningReadiness(currentSigningMember.value);

  if (readiness === "ready") {
    return true;
  }

  if (
    !canImportOwnPrivateKey.value &&
    (readiness === "private_key_not_loaded" ||
      !canGenerateKey(currentUser.value))
  ) {
    errorMessage.value =
      readiness === "revoked_key"
        ? "当前项目中你的公钥已被撤销，且当前成员没有生成新签名密钥的权限。请联系负责人重新登记公钥。"
        : `${signingReason}，但当前成员没有导入私钥文件或生成签名密钥所需的权限。请联系负责人处理。`;
    return false;
  }

  return requestSigningKeySetup({
    readiness,
    signingReason,
  });
}

function handleSignChangePackageToggle(event: Event): void {
  signChangePackage.value = (event.target as HTMLInputElement).checked;
}

async function handleExportChanges() {
  if (!currentUser.value) {
    errorMessage.value = "请先登录。";
    return;
  }

  if (exportMode.value === "task_changes" && selectedTaskIds.value.length === 0) {
    errorMessage.value = "请选择至少一个任务。";
    return;
  }

  if (!canExportSelectedMode.value) {
    errorMessage.value =
      exportMode.value === "maintenance_changes"
        ? "当前成员没有导出项目维护修改的权限。"
        : "当前成员没有导出修改包的权限。";
    return;
  }

  if (!(await ensureSigningKeyIfNeeded(shouldSignChangePackage.value))) {
    return;
  }

  isExporting.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const outcome = await withAppOperation("导出修改包", async () => {
      const createdAt = nowIso();
      const exportOptions = {
        mode: exportMode.value,
        taskId: exportMode.value === "task_changes" ? selectedTaskIds.value[0] : undefined,
        taskIds: exportMode.value === "task_changes" ? selectedTaskIds.value : undefined,
        sign: shouldSignChangePackage.value,
        includeOwnCredentials:
          canIncludeOwnCredentials.value && includeOwnCredentials.value,
        actor: currentUser.value,
        createdAt,
      };
      let result: Awaited<ReturnType<typeof exportChangePackage>> | undefined;
      const saved = await saveGeneratedFileFromFactory(
        getChangePackageSuggestedFileName(currentUser.value!.id, exportOptions, createdAt),
        async () => {
          result = await exportChangePackage(currentUser.value!.id, exportOptions);

          return result.blob;
        },
      );

      if (!result) {
        return { result: undefined, saved, updatedProject: undefined };
      }

      const updatedProject = saved.saved
        ? await completeChangePackageExport(result)
        : undefined;

      return { result, saved, updatedProject };
    });
    const { result, saved, updatedProject } = outcome;

    if (!saved.saved) {
      message.value = saved.reason;
      return;
    }

    if (!result) {
      throw new Error("修改包没有生成。");
    }

    if (exportMode.value === "project_update") {
      if (updatedProject) {
        localProject.value = updatedProject;
        emit("projectUpdated", updatedProject);
      }

      message.value = `已发布签名项目更新包：${result.fileName}`;
    } else {
      message.value = result.signature
        ? `已导出已签名普通修改包：${result.fileName}`
        : `已导出未签名普通修改包：${result.fileName}。当前成员未配置签名私钥。`;
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导出修改包失败。请稍后再试。";
  } finally {
    isExporting.value = false;
  }
}

async function handleExportRelease() {
  if (!canExportFinalRelease.value) {
    errorMessage.value = "当前成员没有导出成品的权限。";
    return;
  }

  isExportingRelease.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const exportedAt = nowIso();
    const outcome = await withAppOperation("导出成品", async () => {
      if (!currentProject.value) {
        throw new Error("请先打开项目，再导出成品。");
      }

      let result: Awaited<ReturnType<typeof exportProject>> | undefined;
      const saved = await saveGeneratedFileFromFactory(
        getReleaseExportSuggestedFileName(currentProject.value.project_id, exportedAt),
        async () => {
          result = await exportProject({
            ...releaseOptionPayload.value,
            exportedBy: currentUser.value?.id ?? "",
            exportedAt,
          });

          return result.blob;
        },
      );

      return { result, saved };
    });
    const { result, saved } = outcome;

    if (!saved.saved) {
      message.value = saved.reason;
      return;
    }

    if (!result) {
      throw new Error("成品文件没有生成。");
    }

    releaseSummary.value = result.summary;
    message.value = `成品文件已保存为 ${saved.fileName}。`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导出成品失败。请稍后再试。";
  } finally {
    isExportingRelease.value = false;
  }
}

async function handleSelectChangePackage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  if (!canSelectImportFile.value) {
    errorMessage.value = "当前成员没有导入修改包的权限。";
    input.value = "";
    return;
  }

  isReadingPackage.value = true;
  errorMessage.value = "";
  message.value = "";
  changePackage.value = undefined;
  packagePreview.value = undefined;
  conflicts.value = [];

  try {
    const nextPackage = await withAppOperation("读取修改包", () =>
      readChangePackage(file),
    );
    const validation = await validateChangePackage(nextPackage);

    changePackage.value = nextPackage;
    packagePreview.value = previewChangePackage(nextPackage);
    conflicts.value =
      validation.projectMatch === "matched"
        ? await detectConflicts(nextPackage)
        : [];
    message.value =
      validation.projectMatch !== "matched"
        ? "修改包已读取，但不属于当前项目，不能导入。"
        : conflicts.value.length > 0
          ? "修改包已读取，请先处理冲突。"
          : "修改包已读取，未发现冲突。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "修改包读取失败。请重新选择文件。";
  } finally {
    isReadingPackage.value = false;
    input.value = "";
  }
}

async function handleApplyPackage(resolutions: ConflictResolution[] = []) {
  if (!changePackage.value) {
    errorMessage.value = "请先选择修改包。";
    return;
  }

  if (!canApplySelectedPackage.value) {
    errorMessage.value = applyDisabledReason.value || "当前修改包不能导入。";
    return;
  }

  if (
    needsDangerousImport.value &&
    !window.confirm(
      "修改包内容完整性未通过。危险导入可能覆盖被篡改的内容，确认继续吗？",
    )
  ) {
    return;
  }

  if (
    packageValidation.value?.requiresMaintenanceConfirmation &&
    !window.confirm(
      "这个修改包包含项目维护变更，可能更新项目设置、成员、权限或密码凭据。确认继续吗？",
    )
  ) {
    return;
  }

  if (
    packageValidation.value?.requiresOwnerCredentialConfirmation &&
    !window.confirm(
      "这个修改包涉及负责人账号凭据或负责人权限变更。再次确认继续导入吗？",
    )
  ) {
    return;
  }

  isApplyingPackage.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const selectedPackage = changePackage.value;
    const result = await withAppOperation("导入修改包", () =>
      applyChangePackage(selectedPackage, resolutions, {
        allowDangerous: needsDangerousImport.value,
        confirmMaintenance:
          packageValidation.value?.requiresMaintenanceConfirmation ?? false,
        confirmOwnerCredentials:
          packageValidation.value?.requiresOwnerCredentialConfirmation ?? false,
        actor: currentUser.value,
      }),
    );

    if (projectStorageForServices.value) {
      const [project, members] = await Promise.all([
        loadProjectFromStorage(projectStorageForServices.value),
        loadMembersFromStorage(projectStorageForServices.value),
      ]);

      localProject.value = project;
      localMembers.value = members;
      emit("projectUpdated", project);
      emit("membersUpdated", members);
    }

    conflicts.value = [];
    const detail = `应用 ${result.appliedEntries} 条词条，处理 ${result.importedComments} 条批注、导入 ${result.importedTerms} 条术语、${result.importedTasks} 条任务。`;
    message.value =
      packageValidation.value?.packageType === "project_update"
        ? `项目更新完成：${detail}`
        : needsDangerousImport.value
          ? `危险导入完成：${detail}`
          : `导入完成：${detail}`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导入修改包失败。请检查冲突处理。";
  } finally {
    isApplyingPackage.value = false;
  }
}

async function exportProjectFileNow() {
  const projectRoot = projectRootForExport.value;

  if (!canExportProjectBackup.value) {
    errorMessage.value = "当前成员没有导出 Textile 项目备份的权限。";
    return;
  }

  if (!projectRoot) {
    errorMessage.value = "请先打开项目，再导出 Textile 项目备份。";
    return;
  }

  isExportingProjectFile.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const outcome = await withAppOperation("导出项目备份", async () => {
      if (!currentProject.value) {
        throw new Error("请先打开项目，再导出 Textile 项目备份。");
      }

      let result: Awaited<ReturnType<typeof exportProjectPackage>> | undefined;
      const saved = await saveGeneratedFileFromFactory(
        getProjectPackageSuggestedFileName(currentProject.value),
        async () => {
          result = await exportProjectPackage(projectRoot);

          return result.blob;
        },
      );

      if (saved.saved && result) {
        completeProjectPackageExport(projectRoot);
      }

      return { result, saved };
    });
    const { result, saved } = outcome;

    if (!saved.saved) {
      message.value = saved.reason;
      return;
    }

    if (!result) {
      throw new Error("Textile 项目备份没有生成。");
    }

    message.value = `已导出 Textile 项目备份：${result.fileName}`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导出 Textile 项目备份失败。请稍后再试。";
  } finally {
    isExportingProjectFile.value = false;
  }
}

async function handleExportProjectFile() {
  if (!canExportProjectBackup.value) {
    errorMessage.value = "当前成员没有导出 Textile 项目备份的权限。";
    return;
  }

  if (!projectRootForExport.value) {
    errorMessage.value = "请先打开项目，再导出 Textile 项目备份。";
    return;
  }

  if (shouldWarnProjectBackupKey.value) {
    projectBackupKeyReminderError.value = "";
    errorMessage.value = "";
    message.value = "";
    showProjectBackupKeyReminder.value = true;
    return;
  }

  await exportProjectFileNow();
}

async function handleContinueProjectBackupExport(): Promise<void> {
  showProjectBackupKeyReminder.value = false;
  projectBackupKeyReminderError.value = "";
  await exportProjectFileNow();
}

function handleCancelProjectBackupKeyReminder(): void {
  showProjectBackupKeyReminder.value = false;
  projectBackupKeyReminderError.value = "";
}

watch(
  () => [
    props.project?.project_id,
    props.members?.length ?? 0,
    props.projectRoot?.name,
    currentUser.value?.id,
  ],
  () => {
    void initializeFromProjectContext();
  },
  { immediate: true },
);

watch(
  () => props.targetPanel,
  () => {
    void focusTargetPanel();
  },
);

watch(
  () => exportMode.value,
  () => {
    if (!canIncludeOwnCredentials.value) {
      includeOwnCredentials.value = false;
    }
  },
);

watch(
  () => [
    releaseFormat.value,
    releaseOnlyReviewed.value,
    releaseIncludeSource.value,
    releaseIncludeKey.value,
    releaseIncludeReport.value,
  ],
  () => {
    void refreshReleaseSummary();
  },
);
</script>

<template>
  <main class="import-export-page">
    <section class="export-panel">
      <ProjectPageHeader
        eyebrow="协作与备份"
        title="导入导出"
        summary="导出修改包、导入协作结果，并生成备份或成品文件。"
      >
        <template #actions>
          <button
            v-if="!hasProjectContext"
            class="open-button"
            type="button"
            :disabled="isLoading"
            @click="handleOpenProject"
          >
            {{ isLoading ? "正在加载..." : "打开项目文件夹" }}
          </button>
        </template>
      </ProjectPageHeader>

      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
      <p v-if="message" class="message">{{ message }}</p>

      <section v-if="projectName" class="project-file-section">
        <h2>导出 Textile 项目备份</h2>
        <p class="section-note">
          导出为 Textile 项目文件（.hproj），方便备份或在另一台设备打开。
        </p>
        <button
          class="export-button"
          type="button"
          :disabled="isExportingProjectFile || !canExportProjectBackup"
          @click="handleExportProjectFile"
        >
          {{ isExportingProjectFile ? "正在导出..." : "导出 Textile 项目备份" }}
        </button>
      </section>

      <section
        v-if="projectName"
        ref="changeExportSection"
        class="form-grid change-export-section"
        tabindex="-1"
      >
        <h2>导出修改包</h2>
        <p class="section-note">
          成员把自己的译文、批注、术语或任务修改导出为修改包，可按项目设置签名。
        </p>

        <div class="current-user-field">
          <span>当前用户</span>
          <strong>{{ currentUser?.name || "未登录" }}</strong>
        </div>

        <fieldset class="export-mode-field">
          <legend>导出范围</legend>
          <label>
            <input
              v-model="exportMode"
              type="radio"
              value="member_changes"
            />
            <span>导出我的可提交修改</span>
          </label>
          <label>
            <input
              v-model="exportMode"
              type="radio"
              value="task_changes"
            />
            <span>导出所选任务范围修改</span>
          </label>
          <label>
            <input
              v-model="exportMode"
              type="radio"
              value="maintenance_changes"
              :disabled="!canExportMaintenance"
            />
            <span>导出项目维护修改</span>
          </label>
          <label>
            <input
              v-model="exportMode"
              type="radio"
              value="project_update"
              :disabled="!canExportProjectUpdate"
            />
            <span>发布签名项目更新包</span>
          </label>
        </fieldset>

        <label v-if="exportMode === 'task_changes'">
          <span>任务</span>
          <select v-model="selectedTaskIds" multiple size="6">
            <option v-for="task in exportableTasks" :key="task.id" :value="task.id">
              {{ task.title }}
            </option>
          </select>
          <small v-if="exportableTasks.length === 0" class="field-help">
            {{ taskExportEmptyText }}
          </small>
        </label>

        <div v-if="exportMode !== 'project_update'" class="signature-option">
          <label class="checkbox-line">
            <input
              type="checkbox"
              :checked="mustSignChangePackage || (signChangePackage && canSignPackages)"
              :disabled="mustSignChangePackage || !canSignPackages"
              @change="handleSignChangePackageToggle"
            />
            <span>
              {{
                mustSignChangePackage
                  ? "当前项目要求给修改包签名"
                  : "给本次修改包签名"
              }}
            </span>
          </label>
          <small v-if="canChooseChangePackageSignature" class="field-help">
            不签名也可导出；签名后，导入方可以用项目中的成员公钥验证来源。
          </small>
          <small
            v-if="!mustSignChangePackage && !canSignPackages"
            class="field-help"
          >
            当前成员没有签名修改包权限，只能导出未签名修改包。
          </small>
        </div>

        <div v-if="canIncludeOwnCredentials" class="credential-option">
          <label class="checkbox-line">
            <input v-model="includeOwnCredentials" type="checkbox" />
            <span>包含我的登录密码修改</span>
          </label>
          <small class="field-help">
            只附带当前用户自己的密码哈希、盐和更新时间；不包含明文密码、私钥、角色、权限或公钥。导入方会额外确认后才合并。
          </small>
        </div>

        <button
          v-if="canExportSelectedMode"
          class="export-button"
          type="button"
          :disabled="
            isExporting ||
            Boolean(signingKeySetup) ||
            !currentUser ||
            (exportMode === 'task_changes' && selectedTaskIds.length === 0)
          "
          @click="handleExportChanges"
        >
          {{ isExporting ? "正在导出..." : "导出修改包" }}
        </button>
        <p v-else class="section-note">
          {{
            exportMode === "maintenance_changes"
              ? "当前成员没有导出项目维护修改的权限。"
              : exportMode === "project_update"
                ? "当前成员没有发布项目更新包的权限。"
                : "当前成员没有导出普通修改包的权限。"
          }}
        </p>
      </section>

      <section
        v-if="projectName"
        ref="changeImportSection"
        class="import-section"
        tabindex="-1"
      >
        <h2>导入修改包</h2>
        <p class="section-note">
          负责人合并普通修改包；所有成员可接收负责人发布的签名项目更新包。
        </p>
        <label v-if="canSelectImportFile" class="file-field">
          <span>选择修改包</span>
          <input
            ref="changePackageInput"
            type="file"
            accept=".zip,application/zip"
            :disabled="isReadingPackage || isApplyingPackage"
            @change="handleSelectChangePackage"
          />
        </label>
        <p v-else class="section-note">当前成员没有导入修改包的权限。</p>

        <ChangePreview
          :preview="packagePreview"
          :members="membersForKeys"
          :conflict-count="conflicts.length"
        />

        <p
          v-if="
            packagePreview &&
            packagePreview.packageType !== 'project_update' &&
            !canReviewPackages
          "
          class="section-note"
        >
          当前成员没有预览修改包内容的权限，只能按已有导入权限继续操作。
        </p>

        <button
          v-if="packagePreview && conflicts.length === 0 && canSelectImportFile"
          :class="['export-button', { 'danger-button': needsDangerousImport }]"
          type="button"
          :disabled="isApplyingPackage || !canApplySelectedPackage"
          @click="handleApplyPackage()"
        >
          {{
            isApplyingPackage
              ? "正在导入..."
              : needsDangerousImport
                ? "危险导入修改包"
                : packageValidation?.packageType === "project_update"
                  ? "接收项目更新"
                  : "应用普通修改包"
          }}
        </button>
        <p v-if="packagePreview && applyDisabledReason" class="section-note">
          {{ applyDisabledReason }}
        </p>

        <section class="conflict-section">
          <h2>冲突处理</h2>
          <p class="section-note">
            如果修改包和当前项目同时改过同一词条或批注状态，请先选择处理方式。
          </p>

        <ConflictResolver
          :conflicts="conflicts"
          :is-applying="isApplyingPackage"
          :can-apply="canApplySelectedPackage"
          :disabled-reason="applyDisabledReason"
          @apply="handleApplyPackage"
        />
        </section>
      </section>

      <section v-if="projectName" class="release-section">
        <h2>导出成品</h2>
        <p class="section-note">
          按当前设置生成成品包、项目清单和检查报告。
        </p>
        <p class="section-note">
          成品文件用于发布，不用于恢复 Textile 项目，也不会完整保留校对人员、校对次数、批注和项目设置。
        </p>
        <div class="release-settings-grid">
          <label>
            <span>导出格式</span>
            <select v-model="releaseFormat">
              <option value="json">JSON</option>
              <option value="txt">TXT 对照</option>
              <option value="csv">CSV</option>
              <option value="ks">KS</option>
            </select>
          </label>

          <label class="checkbox-line">
            <input v-model="releaseOnlyReviewed" type="checkbox" />
            <span>只导出流程完成词条</span>
          </label>

          <label class="checkbox-line">
            <input v-model="releaseIncludeSource" type="checkbox" />
            <span>包含原文</span>
          </label>

          <label class="checkbox-line">
            <input v-model="releaseIncludeKey" type="checkbox" />
            <span>包含键值</span>
          </label>

          <label class="checkbox-line">
            <input v-model="releaseIncludeReport" type="checkbox" />
            <span>生成报告</span>
          </label>
        </div>

        <section class="release-summary" aria-label="导出前统计摘要">
          <h3>导出前统计</h3>
          <p v-if="isLoadingReleaseSummary" class="section-note">
            正在刷新统计...
          </p>
          <div v-else-if="releaseSummary" class="summary-grid">
            <span>
              <strong>{{ releaseSummary.totalEntries }}</strong>
              总词条数
            </span>
            <span>
              <strong>{{ releaseSummary.exportEntries }}</strong>
              将导出
            </span>
            <span>
              <strong>{{ releaseSummary.untranslatedEntries }}</strong>
              未翻译数
            </span>
            <span>
              <strong>{{ releaseSummary.disputedEntries }}</strong>
              争议数
            </span>
          </div>
        </section>

        <button
          v-if="canExportFinalRelease"
          class="export-button"
          type="button"
          :disabled="isExportingRelease"
          @click="handleExportRelease"
        >
          {{ isExportingRelease ? "正在导出..." : "导出成品" }}
        </button>
        <p v-else class="section-note">当前成员没有导出成品的权限。</p>
      </section>

      <p v-else-if="!isLoading && !errorMessage" class="empty-state">
        {{ emptyStateText }}
      </p>

      <SigningKeySetupDialog
        v-if="signingKeySetup"
        :readiness="signingKeySetup.readiness"
        :signing-reason="signingKeySetup.signingReason"
        :can-import-private-key="canImportOwnPrivateKey"
        :can-generate-key="canGenerateSigningKeyForSetup"
        :is-busy="isPreparingSigningKey"
        :error-message="signingKeySetupError"
        @import-key="handleImportSigningKey"
        @generate-key="handleGenerateSigningKey"
        @cancel="handleCancelSigningKeySetup"
      />

      <ProjectBackupKeyReminderDialog
        v-if="showProjectBackupKeyReminder"
        :can-create-key="canCreateProjectBackupPublisherKey"
        :is-creating-key="isCreatingProjectBackupPublisherKey"
        :error-message="projectBackupKeyReminderError"
        @create-key="handleCreateProjectBackupPublisherKey"
        @continue-export="handleContinueProjectBackupExport"
        @cancel="handleCancelProjectBackupKeyReminder"
      />
    </section>
  </main>
</template>

<style scoped>
.import-export-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px;
  background: #f6f7f9;
  color: #1f2937;
}

.export-panel {
  width: min(100%, 720px);
  padding: 28px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

p {
  margin: 0;
}

.open-button,
.export-button {
  min-height: 42px;
  padding: 0 16px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: #ffffff;
  font-size: 15px;
  cursor: pointer;
}

button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.error-message,
.message,
.empty-state {
  margin-top: 22px;
  line-height: 1.7;
}

.error-message {
  color: #b42318;
}

.message {
  color: #166534;
}

.empty-state {
  color: #4b5563;
}

.form-grid,
.project-file-section,
.import-section,
.conflict-section,
.release-section {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}

.change-export-section,
.import-section {
  scroll-margin-top: 76px;
}

.project-file-section,
.import-section,
.release-section {
  padding-top: 24px;
  border-top: 1px solid #e5e7eb;
}

.section-note {
  color: #4b5563;
  line-height: 1.7;
}

.field-help {
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}

.conflict-section {
  padding-top: 18px;
  border-top: 1px solid #e5e7eb;
}

h2 {
  margin: 0;
  font-size: 20px;
}

h3 {
  margin: 0;
  color: #111827;
  font-size: 16px;
}

label {
  display: grid;
  gap: 8px;
}

.export-mode-field {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 12px;
  border: 1px solid #d7dde5;
  border-radius: 6px;
}

.export-mode-field legend {
  padding: 0 4px;
  color: #5b6472;
  font-size: 14px;
}

.export-mode-field label {
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 10px;
}

.release-settings-grid {
  display: grid;
  gap: 12px;
}

.checkbox-line {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 10px;
}

.signature-option,
.credential-option {
  display: grid;
  gap: 6px;
}

label span,
.current-user-field span {
  color: #5b6472;
  font-size: 14px;
}

.current-user-field {
  display: grid;
  gap: 8px;
}

.current-user-field strong {
  min-height: 42px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border: 1px solid #d7dde5;
  border-radius: 6px;
  background: #f8fafb;
  color: #111827;
}

select,
input {
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
}

input[type="radio"] {
  min-height: auto;
  width: 16px;
  height: 16px;
  padding: 0;
}

input[type="checkbox"] {
  min-height: auto;
  width: 16px;
  height: 16px;
  padding: 0;
}

.release-summary {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #f8fafb;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.summary-grid span {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #ffffff;
  color: #5b6472;
  font-size: 13px;
}

.summary-grid strong {
  color: #111827;
  font-size: 20px;
}

.export-button {
  justify-self: start;
}

.danger-button {
  background: #b42318;
}

@media (max-width: 680px) {
  .summary-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
