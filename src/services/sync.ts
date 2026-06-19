import { PERMISSION_ACTIONS } from "../model/permissions";
import type { Member } from "../model/types";
import { can, getCurrentUser } from "./permissions";

export type SyncState = "disabled" | "ready" | "conflict" | "error" | "failed";

export interface SyncFallbackAction {
  label: "导出修改包";
  message: string;
}

export interface SyncStatus {
  state: SyncState;
  title: string;
  message: string;
  canSync: false;
  canUpload: false;
  canResolveConflict?: boolean;
  canExportChangePackage?: boolean;
  hasLocalChanges?: false;
  hasRemoteChanges?: false;
  lastSyncAt?: string;
  failureMessage?: string;
  fallbackMessage?: string;
  fallbackAction?: SyncFallbackAction;
}

export interface SyncActionResult {
  ok: false;
  state: SyncState;
  message: string;
  fallbackMessage?: string;
  fallbackAction?: SyncFallbackAction;
  status?: SyncStatus;
}

const fallbackAction: SyncFallbackAction = {
  label: "导出修改包",
  message: "当前项目使用修改包协作。成员导出修改包后交给负责人导入合并。",
};

function getUser(user?: Member | null): Member | null {
  return user === undefined ? getCurrentUser() : user;
}

function canExportPackage(user?: Member | null): boolean {
  return can(getUser(user), PERMISSION_ACTIONS.CHANGE_PACKAGE_EXPORT);
}

function buildPackageStatus(user?: Member | null): SyncStatus {
  return {
    state: "disabled",
    title: "协作方式：修改包",
    message: "当前项目不使用自动协作。请通过签名修改包导出、导入和冲突处理完成协作。",
    canSync: false,
    canUpload: false,
    canResolveConflict: false,
    canExportChangePackage: canExportPackage(user),
    hasLocalChanges: false,
    hasRemoteChanges: false,
    fallbackMessage: fallbackAction.message,
    fallbackAction,
  };
}

function blockedResult(message: string, user?: Member | null): SyncActionResult {
  const status = buildPackageStatus(user);

  return {
    ok: false,
    state: status.state,
    message,
    fallbackMessage: status.fallbackMessage,
    fallbackAction,
    status,
  };
}

export async function getSyncStatus(user?: Member | null): Promise<SyncStatus> {
  return buildPackageStatus(user);
}

export async function canUseSync(): Promise<boolean> {
  return false;
}

export function getSyncFallbackAction(): SyncFallbackAction {
  return fallbackAction;
}

export async function syncLatestProject(
  user?: Member | null,
): Promise<SyncActionResult> {
  return blockedResult("请使用修改包导入负责人合并后的内容。", user);
}

export async function uploadMyChanges(
  user?: Member | null,
): Promise<SyncActionResult> {
  return blockedResult("请导出修改包交给负责人合并。", user);
}

export async function submitTaskWithSync(
  taskId: string,
  user?: Member | null,
): Promise<SyncActionResult> {
  return blockedResult(`任务 ${taskId} 已提交。请导出修改包交给负责人合并。`, user);
}

export async function generateChangeSummary(): Promise<string> {
  return fallbackAction.message;
}

export async function resolveSyncConflict(
  _resolutions?: unknown[],
  user?: Member | null,
): Promise<SyncActionResult> {
  return blockedResult("请在导入修改包时处理冲突。", user);
}
