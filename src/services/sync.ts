import {
  commit,
  getLog,
  getStatus,
  pull,
  push,
  resolveConflict,
  type GitAdapterStatus,
  type GitConflictResolution,
} from "./gitAdapter";
import { PERMISSION_ACTIONS } from "../model/permissions";
import type { Member } from "../model/types";
import { can, getCurrentUser } from "./permissions";

export type SyncState =
  | "disabled"
  | "ready"
  | "clean"
  | "dirty"
  | "need_pull"
  | "syncing"
  | "conflict"
  | "error"
  | "failed";

export interface SyncFallbackAction {
  label: "导出修改包";
  message: string;
}

export interface SyncStatus {
  state: SyncState;
  title: string;
  message: string;
  canSync: boolean;
  canUpload: boolean;
  canResolveConflict?: boolean;
  canExportChangePackage?: boolean;
  hasLocalChanges?: boolean;
  hasRemoteChanges?: boolean;
  lastSyncAt?: string;
  failureMessage?: string;
  fallbackMessage?: string;
  fallbackAction?: SyncFallbackAction;
}

export interface SyncActionResult {
  ok: boolean;
  state: SyncState;
  message: string;
  fallbackMessage?: string;
  fallbackAction?: SyncFallbackAction;
  status?: SyncStatus;
}

const syncLabels: Record<Exclude<SyncState, "failed">, string> = {
  disabled: "同步未启用",
  ready: "可以同步",
  clean: "已是最新",
  dirty: "有本地修改",
  need_pull: "项目有新内容",
  syncing: "正在同步",
  conflict: "发现内容冲突",
  error: "同步失败",
};

const fallbackAction: SyncFallbackAction = {
  label: "导出修改包",
  message: "同步失败时，你可以先导出修改包，交给负责人合并。",
};

let lastSuccessfulSyncAt = "";

function normalizeSyncState(state: GitAdapterStatus["state"]): Exclude<SyncState, "failed"> {
  return state;
}

function getUser(user?: Member | null): Member | null {
  return user === undefined ? getCurrentUser() : user;
}

function canExportFallback(user?: Member | null): boolean {
  return can(getUser(user), PERMISSION_ACTIONS.CHANGE_PACKAGE_EXPORT);
}

function canUseSyncPermission(user?: Member | null): boolean {
  return can(getUser(user), PERMISSION_ACTIONS.SYNC_USE);
}

function buildDisabledStatus(
  adapterStatus: GitAdapterStatus,
  user?: Member | null,
): SyncStatus {
  return {
    state: "disabled",
    title: syncLabels.disabled,
    message: adapterStatus.message,
    canSync: false,
    canUpload: false,
    canResolveConflict: false,
    canExportChangePackage: canExportFallback(user),
    hasLocalChanges: adapterStatus.hasLocalChanges,
    hasRemoteChanges: adapterStatus.hasRemoteChanges,
    lastSyncAt: adapterStatus.lastSyncAt || lastSuccessfulSyncAt || undefined,
    fallbackMessage: "当前环境暂不支持自动同步。你可以导出修改包交给负责人合并。",
    fallbackAction,
  };
}

function buildPermissionBlockedStatus(
  adapterStatus: GitAdapterStatus,
  user?: Member | null,
): SyncStatus {
  return {
    state: adapterStatus.available ? "ready" : "disabled",
    title: adapterStatus.available ? syncLabels.ready : syncLabels.disabled,
    message: "当前成员没有使用自动同步的权限，可以改用导出修改包。",
    canSync: false,
    canUpload: false,
    canResolveConflict: false,
    canExportChangePackage: canExportFallback(user),
    hasLocalChanges: adapterStatus.hasLocalChanges,
    hasRemoteChanges: adapterStatus.hasRemoteChanges,
    lastSyncAt: adapterStatus.lastSyncAt || lastSuccessfulSyncAt || undefined,
    fallbackMessage: "你可以导出修改包交给负责人合并。",
    fallbackAction,
  };
}

function buildSyncStatus(
  adapterStatus: GitAdapterStatus,
  user?: Member | null,
): SyncStatus {
  if (!adapterStatus.available || adapterStatus.state === "disabled") {
    return buildDisabledStatus(adapterStatus, user);
  }

  if (!canUseSyncPermission(user)) {
    return buildPermissionBlockedStatus(adapterStatus, user);
  }

  const state = normalizeSyncState(adapterStatus.state);
  const isBusy = state === "syncing";
  const isConflict = state === "conflict";
  const isError = state === "error";

  return {
    state,
    title: syncLabels[state],
    message: adapterStatus.message,
    canSync: !isBusy && !isConflict && !isError,
    canUpload:
      !isBusy &&
      !isConflict &&
      !isError &&
      (state === "dirty" || adapterStatus.hasLocalChanges),
    canResolveConflict: isConflict,
    canExportChangePackage: canExportFallback(user),
    hasLocalChanges: adapterStatus.hasLocalChanges,
    hasRemoteChanges: adapterStatus.hasRemoteChanges,
    lastSyncAt: adapterStatus.lastSyncAt || lastSuccessfulSyncAt || undefined,
    failureMessage: adapterStatus.errorMessage,
    fallbackMessage: isError || isConflict ? fallbackAction.message : undefined,
    fallbackAction,
  };
}

function blockedResult(message: string, status: SyncStatus): SyncActionResult {
  return {
    ok: false,
    state: status.state,
    message,
    fallbackMessage: status.fallbackMessage ?? fallbackAction.message,
    fallbackAction,
    status,
  };
}

function successResult(message: string, status: SyncStatus): SyncActionResult {
  return {
    ok: true,
    state: status.state,
    message,
    status,
  };
}

export async function getSyncStatus(user?: Member | null): Promise<SyncStatus> {
  try {
    return buildSyncStatus(await getStatus(), user);
  } catch (error) {
    return {
      state: "error",
      title: syncLabels.error,
      message:
        error instanceof Error
          ? error.message
          : "同步状态检查失败。你可以导出修改包继续协作。",
      canSync: false,
      canUpload: false,
      canResolveConflict: false,
      canExportChangePackage: canExportFallback(user),
      hasLocalChanges: false,
      hasRemoteChanges: false,
      failureMessage:
        error instanceof Error ? error.message : "同步状态检查失败。",
      fallbackMessage: fallbackAction.message,
      fallbackAction,
    };
  }
}

export async function canUseSync(user?: Member | null): Promise<boolean> {
  const status = await getSyncStatus(user);

  return Boolean(status.canSync || status.canUpload || status.canResolveConflict);
}

export function getSyncFallbackAction(): SyncFallbackAction {
  return fallbackAction;
}

export async function syncLatestProject(
  user?: Member | null,
): Promise<SyncActionResult> {
  const currentStatus = await getSyncStatus(user);

  if (!currentStatus.canSync) {
    return blockedResult("当前不能自动同步项目。", currentStatus);
  }

  const nextStatus = buildSyncStatus(await pull(), user);

  if (nextStatus.state === "error" || nextStatus.state === "conflict") {
    return blockedResult(nextStatus.message, nextStatus);
  }

  lastSuccessfulSyncAt = new Date().toISOString();

  return successResult("项目已同步。", {
    ...nextStatus,
    lastSyncAt: lastSuccessfulSyncAt,
  });
}

export async function uploadMyChanges(
  user?: Member | null,
): Promise<SyncActionResult> {
  const currentStatus = await getSyncStatus(user);

  if (!currentStatus.canUpload) {
    return blockedResult("当前不能自动上传修改。", currentStatus);
  }

  const committedStatus = buildSyncStatus(
    await commit("保存本地修改"),
    user,
  );

  if (committedStatus.state === "error" || committedStatus.state === "conflict") {
    return blockedResult(committedStatus.message, committedStatus);
  }

  const pushedStatus = buildSyncStatus(await push(), user);

  if (pushedStatus.state === "error" || pushedStatus.state === "conflict") {
    return blockedResult(pushedStatus.message, pushedStatus);
  }

  lastSuccessfulSyncAt = new Date().toISOString();

  return successResult("修改已上传。", {
    ...pushedStatus,
    lastSyncAt: lastSuccessfulSyncAt,
  });
}

export async function submitTaskWithSync(
  taskId: string,
  user?: Member | null,
): Promise<SyncActionResult> {
  const result = await uploadMyChanges(user);

  if (!result.ok) {
    return {
      ...result,
      message: `任务 ${taskId} 已保存在本地，但当前不能自动同步提交。`,
    };
  }

  return {
    ...result,
    message: "任务已同步提交。",
  };
}

export async function generateChangeSummary(): Promise<string> {
  const status = await getSyncStatus();

  if (status.state === "disabled") {
    return "当前环境暂不支持自动同步。你可以导出修改包继续协作。";
  }

  const logRows = await getLog();
  const localText = status.hasLocalChanges ? "有本地修改" : "没有本地修改";
  const remoteText = status.hasRemoteChanges ? "项目有新内容" : "没有发现项目新内容";

  if (logRows.length === 0) {
    return `${localText}，${remoteText}。`;
  }

  return `${localText}，${remoteText}。最近记录：${logRows
    .slice(0, 3)
    .map((row) => row.message)
    .join("；")}`;
}

export async function resolveSyncConflict(
  resolutions?: GitConflictResolution[],
  user?: Member | null,
): Promise<SyncActionResult> {
  const currentStatus = await getSyncStatus(user);

  if (!currentStatus.canResolveConflict) {
    return blockedResult("当前没有可处理的内容冲突。", currentStatus);
  }

  const nextStatus = buildSyncStatus(await resolveConflict(resolutions), user);

  if (nextStatus.state === "error" || nextStatus.state === "conflict") {
    return blockedResult(nextStatus.message, nextStatus);
  }

  return successResult("内容冲突已处理。", nextStatus);
}
