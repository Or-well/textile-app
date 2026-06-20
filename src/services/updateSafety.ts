export type UpdateSafetyPage =
  | "home"
  | "projects"
  | "create-project"
  | "project"
  | "not-found";

export type UpdateSafetySection =
  | "overview"
  | "files"
  | "tasks"
  | "terms"
  | "comments"
  | "stats"
  | "import-export"
  | "settings"
  | "file-entry";

export interface UpdateSafetyInput {
  page: UpdateSafetyPage;
  section?: UpdateSafetySection;
  hasProject: boolean;
  hasUser: boolean;
  isBusy?: boolean;
}

export interface UpdateSafetyState {
  canAutoRefresh: boolean;
  reason: string;
}

const SAFE_PROJECT_SECTIONS = new Set<UpdateSafetySection>([
  "overview",
  "stats",
]);

let state: UpdateSafetyState = {
  canAutoRefresh: true,
  reason: "当前页面可以自动切换到新版。",
};

export function setAppUpdateSafety(input: UpdateSafetyInput): UpdateSafetyState {
  state = evaluateUpdateSafety(input);
  return getAppUpdateSafety();
}

export function getAppUpdateSafety(): UpdateSafetyState {
  return { ...state };
}

export function getPendingUpdateBlockedReason(
  safety: UpdateSafetyState,
  hasPendingUpdate: boolean,
): string {
  return hasPendingUpdate && !safety.canAutoRefresh ? safety.reason : "";
}

function evaluateUpdateSafety(input: UpdateSafetyInput): UpdateSafetyState {
  const activeOperations = getActiveAppOperations();

  if (activeOperations.length > 0) {
    const operationLabels = Array.from(
      new Set(activeOperations.map((operation) => operation.label)),
    ).join("、");

    return {
      canAutoRefresh: false,
      reason: `Textile 正在执行${operationLabels}，完成后才能安装更新。`,
    };
  }

  if (input.isBusy) {
    return {
      canAutoRefresh: false,
      reason: "Textile 正在处理当前操作，完成后再刷新使用新版。",
    };
  }

  if (input.page !== "project") {
    return {
      canAutoRefresh: true,
      reason: "当前未进入项目编辑流程，可以自动切换到新版。",
    };
  }

  if (!input.hasProject || !input.hasUser) {
    return {
      canAutoRefresh: true,
      reason: "当前没有正在编辑的项目内容，可以自动切换到新版。",
    };
  }

  if (input.section && SAFE_PROJECT_SECTIONS.has(input.section)) {
    return {
      canAutoRefresh: true,
      reason: "当前页面没有正在编辑的内容，可以自动切换到新版。",
    };
  }

  return {
    canAutoRefresh: false,
    reason: "Textile 新版本已准备好。完成当前编辑或导入导出后，刷新即可使用新版。",
  };
}
import { getActiveAppOperations } from "./appOperation";
