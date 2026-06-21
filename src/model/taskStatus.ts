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
    in_progress: ["assigned", "unassigned"],
    submitted: ["assigned", "unassigned"],
  },
  submit: {
    assigned: ["submitted"],
    in_progress: ["submitted"],
  },
  cancel_submit: {
    submitted: ["assigned", "in_progress"],
  },
  complete: {
    submitted: ["completed"],
  },
  reclaim: {
    assigned: ["unassigned"],
    in_progress: ["unassigned"],
    submitted: ["unassigned"],
  },
  reopen: {
    submitted: ["assigned", "in_progress", "unassigned"],
    completed: ["assigned", "in_progress", "unassigned"],
  },
};

export function getTaskStatusTransitionTargets(
  action: TaskStatusAction,
  status: TaskStatus,
): readonly TaskStatus[] {
  return TASK_STATUS_TRANSITIONS[action][status] ?? [];
}

export function canTransitionTaskStatus(
  action: TaskStatusAction,
  from: TaskStatus,
  to?: TaskStatus,
): boolean {
  const targets = getTaskStatusTransitionTargets(action, from);

  return to === undefined ? targets.length > 0 : targets.includes(to);
}
