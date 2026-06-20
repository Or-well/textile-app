import { getActiveAppDrafts } from "./appDraft";
import { getActiveAppOperations } from "./appOperation";

export interface UpdateSafetyInput {
  isBusy?: boolean;
}

export interface UpdateBlocker {
  kind: "operation" | "unsaved-draft";
  labels: string[];
}

export interface UpdateSafetyState {
  canApplyUpdate: boolean;
  reason: string;
  blocker?: UpdateBlocker;
}

let state: UpdateSafetyState = {
  canApplyUpdate: true,
  reason: "",
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
  return hasPendingUpdate && !safety.canApplyUpdate ? safety.reason : "";
}

function evaluateUpdateSafety(input: UpdateSafetyInput): UpdateSafetyState {
  const activeOperations = getActiveAppOperations();

  if (activeOperations.length > 0) {
    const labels = Array.from(
      new Set(activeOperations.map((operation) => operation.label)),
    );

    return {
      canApplyUpdate: false,
      reason: `正在执行${labels.join("、")}，完成后即可继续。`,
      blocker: {
        kind: "operation",
        labels,
      },
    };
  }

  if (input.isBusy) {
    return {
      canApplyUpdate: false,
      reason: "正在处理当前操作，完成后即可继续。",
      blocker: {
        kind: "operation",
        labels: ["当前操作"],
      },
    };
  }

  const activeDrafts = getActiveAppDrafts();

  if (activeDrafts.length > 0) {
    const labels = Array.from(new Set(activeDrafts.map((draft) => draft.label)));

    return {
      canApplyUpdate: false,
      reason: `存在未保存的${labels.join("、")}，请先保存或放弃修改。`,
      blocker: {
        kind: "unsaved-draft",
        labels,
      },
    };
  }

  return {
    canApplyUpdate: true,
    reason: "",
  };
}
