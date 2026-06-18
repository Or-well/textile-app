import type { EntryStatus, TaskStatus } from "./types";

export const ENTRY_STATUSES = [
  "untranslated",
  "translated",
  "proofread",
  "reviewed",
  "disputed",
] as const satisfies readonly EntryStatus[];

export const TASK_STATUSES = [
  "unassigned",
  "assigned",
  "in_progress",
  "submitted",
  "completed",
  "reclaimed",
  "blocked",
] as const satisfies readonly TaskStatus[];

export const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = {
  untranslated: "未翻译",
  translated: "已翻译",
  proofread: "已校对",
  reviewed: "已审核",
  disputed: "有争议",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  unassigned: "未领取",
  assigned: "已分配",
  in_progress: "进行中",
  submitted: "已提交",
  completed: "已完成",
  reclaimed: "已回收",
  blocked: "有问题",
};
