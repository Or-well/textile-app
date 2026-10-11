import type { TaskStatus } from "./types";

export type TaskStatusAction =
  | "assign"
  | "submit"
  | "cancel_submit"
  | "complete"
  | "reclaim"
  | "reopen";

const TASK_STATUS_TRANSITIONS: Record<
  TaskStatusAction,
  Partial<Record<TaskStatus, readonly TaskStatus[]>>
> = {
  assign: {
    unassigned: ["assigned"],
    assigned: ["assigned", "unassigned"],
    submitted: ["assigned", "unassigned"],
  },
  submit: {
    assigned: ["submitted"],
  },
  cancel_submit: {
    submitted: ["assigned", "unassigned"],
  },
  complete: {
    submitted: ["completed"],
  },
  reclaim: {
    assigned: ["unassigned"],
    submitted: ["unassigned"],
  },
  reopen: {
    submitted: ["assigned", "unassigned"],
    completed: ["assigned", "unassigned"],
  },
};

export function normalizeLegacyTaskStatus(
  status: TaskStatus,
): Exclude<TaskStatus, "in_progress"> {
  return status === "in_progress" ? "assigned" : status;
}

export function getTaskStatusTransitionTargets(
  action: TaskStatusAction,
  status: TaskStatus,
): readonly TaskStatus[] {
  return TASK_STATUS_TRANSITIONS[action][normalizeLegacyTaskStatus(status)] ?? [];
}

export function canTransitionTaskStatus(
  action: TaskStatusAction,
  from: TaskStatus,
  to?: TaskStatus,
): boolean {
  const targets = getTaskStatusTransitionTargets(action, from);

  return to === undefined ? targets.length > 0 : targets.includes(to);
}
