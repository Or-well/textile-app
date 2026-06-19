import type {
  Entry,
  EntryStatus,
  ProjectWorkflowSettings,
  ProofreadRequired,
  TaskStatus,
} from "./types";

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
};

type LegacyEntryStatus = EntryStatus | "disputed" | string;

type LegacyEntry = Omit<Entry, "status" | "proofread_by"> & {
  status: LegacyEntryStatus;
  proofread_by?: string | string[];
  proofread_count?: number;
};

export type NormalizedWorkflowSettings = Required<
  Pick<
    ProjectWorkflowSettings,
    | "proofread_required"
    | "review_required"
    | "allow_self_proofread"
    | "allow_self_review"
    | "allow_same_user_multi_proofread"
  >
> & {
  enable_tasks: boolean;
  enable_proofread: boolean;
  enable_review: boolean;
};

const DEFAULT_WORKFLOW_SETTINGS: NormalizedWorkflowSettings = {
  enable_tasks: true,
  enable_proofread: true,
  enable_review: true,
  proofread_required: 1,
  review_required: true,
  allow_self_proofread: false,
  allow_self_review: false,
  allow_same_user_multi_proofread: false,
};

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function clampProofreadRequired(value: unknown): ProofreadRequired {
  const numberValue = Math.trunc(Number(value));

  if (numberValue <= 0) {
    return 0;
  }

  if (numberValue >= 3) {
    return 3;
  }

  return numberValue as ProofreadRequired;
}

export function normalizeWorkflowSettings(
  workflow?: ProjectWorkflowSettings,
): NormalizedWorkflowSettings {
  const proofreadRequired =
    workflow?.proofread_required !== undefined
      ? clampProofreadRequired(workflow.proofread_required)
      : workflow?.enable_proofread === false
        ? 0
        : DEFAULT_WORKFLOW_SETTINGS.proofread_required;
  const reviewRequired =
    workflow?.review_required ?? workflow?.enable_review ?? DEFAULT_WORKFLOW_SETTINGS.review_required;

  return {
    enable_tasks: workflow?.enable_tasks ?? DEFAULT_WORKFLOW_SETTINGS.enable_tasks,
    enable_proofread: proofreadRequired > 0,
    enable_review: reviewRequired,
    proofread_required: proofreadRequired,
    review_required: reviewRequired,
    allow_self_proofread:
      workflow?.allow_self_proofread ??
      DEFAULT_WORKFLOW_SETTINGS.allow_self_proofread,
    allow_self_review:
      workflow?.allow_self_review ?? DEFAULT_WORKFLOW_SETTINGS.allow_self_review,
    allow_same_user_multi_proofread:
      workflow?.allow_same_user_multi_proofread ??
      DEFAULT_WORKFLOW_SETTINGS.allow_same_user_multi_proofread,
  };
}

export function normalizeProofreadUsers(
  proofreadBy?: string | string[],
): string[] {
  if (Array.isArray(proofreadBy)) {
    return proofreadBy.map((userId) => userId.trim()).filter(Boolean);
  }

  return proofreadBy?.trim() ? [proofreadBy.trim()] : [];
}

export function getEntryProofreadCount(entry: {
  proofread_by?: string[] | string;
  proofread_count?: number;
}): number {
  const proofreadUsers = normalizeProofreadUsers(entry.proofread_by);
  const count = Math.max(0, Math.trunc(Number(entry.proofread_count) || 0));

  return Math.max(count, proofreadUsers.length);
}

export function isEntryProofreadComplete(
  entry: {
    proofread_by?: string[] | string;
    proofread_count?: number;
  },
  workflow?: ProjectWorkflowSettings,
): boolean {
  const settings = normalizeWorkflowSettings(workflow);

  return getEntryProofreadCount(entry) >= settings.proofread_required;
}

export function isEntryReviewComplete(
  entry: { status?: EntryStatus },
  workflow?: ProjectWorkflowSettings,
): boolean {
  const settings = normalizeWorkflowSettings(workflow);

  return !settings.review_required || entry.status === "reviewed";
}

export function inferEntryStatus(entry: {
  status?: LegacyEntryStatus;
  target?: string;
  proofread_by?: string | string[];
  proofread_count?: number;
  reviewed_by?: string;
}): EntryStatus {
  if (entry.status && ENTRY_STATUSES.includes(entry.status as EntryStatus)) {
    return entry.status as EntryStatus;
  }

  if (hasText(entry.reviewed_by)) {
    return "reviewed";
  }

  if (getEntryProofreadCount(entry) > 0) {
    return "proofread";
  }

  if (hasText(entry.target)) {
    return "translated";
  }

  return "untranslated";
}

export function normalizeEntry(entry: LegacyEntry): Entry {
  const wasLegacyDisputed = entry.status === "disputed";
  const proofreadBy = normalizeProofreadUsers(entry.proofread_by);
  const proofreadCount = getEntryProofreadCount(entry);

  return {
    ...entry,
    status: inferEntryStatus(entry),
    proofread_by: proofreadBy,
    proofread_count: proofreadCount,
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
  workflow?: ProjectWorkflowSettings,
): Entry {
  const settings = normalizeWorkflowSettings(workflow);
  const currentProofreadBy = normalizeProofreadUsers(entry.proofread_by);
  const nextEntry: Entry = {
    ...entry,
    status,
    proofread_by: currentProofreadBy,
    proofread_count: getEntryProofreadCount(entry),
  };

  if (status === "translated") {
    nextEntry.translated_by = entry.translated_by || userId;
    nextEntry.proofread_by = [];
    nextEntry.proofread_count = 0;
    nextEntry.reviewed_by = "";
  }

  if (status === "proofread") {
    const nextProofreadBy =
      userId && (settings.allow_same_user_multi_proofread || !currentProofreadBy.includes(userId))
        ? [...currentProofreadBy, userId]
        : currentProofreadBy;
    const nextProofreadCount = Math.max(
      getEntryProofreadCount(entry) + (nextProofreadBy.length > currentProofreadBy.length ? 1 : 0),
      nextProofreadBy.length,
    );

    nextEntry.translated_by = entry.translated_by || userId;
    nextEntry.proofread_by = nextProofreadBy;
    nextEntry.proofread_count = nextProofreadCount;
    nextEntry.status =
      nextProofreadCount >= settings.proofread_required ? "proofread" : "translated";
    nextEntry.reviewed_by = "";
  }

  if (status === "reviewed") {
    nextEntry.translated_by = entry.translated_by || userId;
    nextEntry.proofread_by =
      currentProofreadBy.length > 0 || settings.proofread_required === 0
        ? currentProofreadBy
        : [userId];
    nextEntry.proofread_count = Math.max(
      getEntryProofreadCount(entry),
      settings.proofread_required,
      nextEntry.proofread_by.length,
    );
    nextEntry.reviewed_by = userId;
  }

  return nextEntry;
}

export function getEntryWorkflowLabel(
  entry: Entry,
  workflow?: ProjectWorkflowSettings,
): string {
  const settings = normalizeWorkflowSettings(workflow);
  const proofreadCount = getEntryProofreadCount(entry);

  if (entry.status === "untranslated") {
    return ENTRY_STATUS_LABELS.untranslated;
  }

  if (entry.status === "reviewed") {
    return settings.review_required ? "已审核" : "已校对";
  }

  if (settings.proofread_required > 0 && proofreadCount > 0 && proofreadCount < settings.proofread_required) {
    return `校对中 ${proofreadCount}/${settings.proofread_required}`;
  }

  if (settings.proofread_required > 0 && proofreadCount < settings.proofread_required) {
    return "待校对";
  }

  if (settings.review_required) {
    return "待审核";
  }

  return "已校对";
}

export function getNextProofreadLabel(
  entry: Entry,
  workflow?: ProjectWorkflowSettings,
): string {
  const settings = normalizeWorkflowSettings(workflow);
  const nextCount = Math.min(
    getEntryProofreadCount(entry) + 1,
    settings.proofread_required,
  );

  return settings.proofread_required > 1
    ? `校对通过 ${nextCount}/${settings.proofread_required}`
    : "校对通过";
}
