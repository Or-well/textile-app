import {
  getWorkingTreeStatus,
  pullLatest,
  pushChanges,
} from "./gitAdapter";

export type SyncState = "ready" | "unavailable" | "failed";

export interface SyncStatus {
  state: SyncState;
  title: string;
  message: string;
  canSync: boolean;
  canUpload: boolean;
  fallbackMessage?: string;
}

export interface SyncActionResult {
  ok: boolean;
  message: string;
  fallbackMessage?: string;
}

const fallbackMessage = "同步失败。你可以先导出修改包，交给负责人合并。";

function unavailableResult(actionName: string): SyncActionResult {
  return {
    ok: false,
    message: `${actionName}暂未启用。`,
    fallbackMessage,
  };
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const status = await getWorkingTreeStatus();

  if (!status.available) {
    return {
      state: "unavailable",
      title: "同步暂不可用",
      message: status.message,
      canSync: false,
      canUpload: false,
      fallbackMessage,
    };
  }

  return {
    state: "ready",
    title: "可以同步",
    message: "项目同步功能可以使用。",
    canSync: true,
    canUpload: true,
  };
}

export async function syncLatestProject(): Promise<SyncActionResult> {
  const result = await pullLatest();

  if (!result.available) {
    return unavailableResult("同步项目");
  }

  return {
    ok: true,
    message: "项目已同步。",
  };
}

export async function submitTaskWithSync(
  taskId: string,
): Promise<SyncActionResult> {
  const result = await pushChanges();

  if (!result.available) {
    return {
      ok: false,
      message: `任务 ${taskId} 暂时不能通过同步提交。`,
      fallbackMessage,
    };
  }

  return {
    ok: true,
    message: "任务已提交。",
  };
}

export async function uploadMyChanges(): Promise<SyncActionResult> {
  const result = await pushChanges();

  if (!result.available) {
    return unavailableResult("上传修改");
  }

  return {
    ok: true,
    message: "修改已上传。",
  };
}

export async function generateChangeSummary(): Promise<string> {
  return "当前版本暂未启用同步提交。你可以使用导出修改包继续协作。";
}
