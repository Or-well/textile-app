import type { Entry, EntryStatus, TaskStatus } from "./types";

export const ENTRY_STATUSES = [
  "untranslated",
  "translated",
  "proofread",
  "reviewed",
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

type LegacyEntryStatus = EntryStatus | "disputed" | string;

type LegacyEntry = Omit<Entry, "status"> & {
  status: LegacyEntryStatus;
};

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function inferEntryStatus(entry: {
  status?: LegacyEntryStatus;
  target?: string;
  proofread_by?: string;
  reviewed_by?: string;
}): EntryStatus {
  if (entry.status && ENTRY_STATUSES.includes(entry.status as EntryStatus)) {
    return entry.status as EntryStatus;
  }

  if (hasText(entry.reviewed_by)) {
    return "reviewed";
  }

  if (hasText(entry.proofread_by)) {
    return "proofread";
  }

  if (hasText(entry.target)) {
    return "translated";
  }

  return "untranslated";
}

export function normalizeEntry(entry: LegacyEntry): Entry {
  const wasLegacyDisputed = entry.status === "disputed";

  return {
    ...entry,
    status: inferEntryStatus(entry),
    disputed: entry.disputed === true || wasLegacyDisputed,
  };
}

export function normalizeEntries(entries: LegacyEntry[]): Entry[] {
  return entries.map(normalizeEntry);
}

export function applyEntryWorkflowStatus(
  entry: Entry,
  status: EntryStatus,
  userId: string,
): Entry {
  const nextEntry: Entry = {
    ...entry,
    status,
  };

  if (status === "translated") {
    nextEntry.translated_by = entry.translated_by || userId;
    nextEntry.proofread_by = "";
    nextEntry.reviewed_by = "";
  }

  if (status === "proofread") {
    nextEntry.translated_by = entry.translated_by || userId;
    nextEntry.proofread_by = userId;
    nextEntry.reviewed_by = "";
  }

  if (status === "reviewed") {
    nextEntry.translated_by = entry.translated_by || userId;
    nextEntry.proofread_by = entry.proofread_by || userId;
    nextEntry.reviewed_by = userId;
  }

  return nextEntry;
}
