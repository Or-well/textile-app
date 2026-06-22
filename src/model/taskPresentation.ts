import type { TaskType } from "./types";

export const TASK_TYPE_OPTIONS: ReadonlyArray<{
  value: TaskType;
  label: string;
}> = [
  { value: "translate", label: "翻译" },
  { value: "proofread", label: "校对" },
  { value: "review", label: "审核" },
  { value: "term", label: "术语" },
  { value: "custom", label: "自定义" },
];

const TASK_TYPE_LABELS = Object.fromEntries(
  TASK_TYPE_OPTIONS.map((item) => [item.value, item.label]),
) as Record<TaskType, string>;

export function getTaskTypeLabel(type: TaskType): string {
  return TASK_TYPE_LABELS[type];
}
