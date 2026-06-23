import type {
  Entry,
  EntryStatus,
  ProjectEvent,
} from "../model/types";
import {
  ENTRY_STATUSES,
  normalizeProofreadUsers,
  type EntryWorkflowOperation,
} from "../model/status";
import { createId } from "../utils/id";
import { compareInstants, nowIso } from "../utils/time";
import type { ProjectDirectoryHandle } from "./projectFs";
import {
  createProjectStorage,
  type ProjectStorage,
} from "./projectStorage";

type ProjectEventInput = Omit<ProjectEvent, "id" | "created_at"> &
  Partial<Pick<ProjectEvent, "id" | "created_at">>;

export interface EntryVersionDetail {
  before_target: string;
  after_target: string;
  before_status: EntryStatus;
  after_status: EntryStatus;
  before_translated_by?: string;
  after_translated_by?: string;
  before_proofread_by?: string[];
  after_proofread_by?: string[];
  before_proofread_count?: number;
  after_proofread_count?: number;
  before_reviewed_by?: string;
  after_reviewed_by?: string;
  operation?: EntryHistoryOperation;
  source_event_id?: string;
  package_id?: string;
  restored_from_event_id?: string;
  restored_from_snapshot?: EntryVersionSnapshot;
  batch_id?: string;
}

export type EntryHistoryOperation =
  | EntryWorkflowOperation
  | "translation_import"
  | "package_merge"
  | "restore";

export type EntryVersionSnapshot = "before" | "after";

export interface EntryVersionEvent extends ProjectEvent {
  type: "entry.updated" | "entry.restored";
  entry_id: string;
  file_id: string;
  detail: ProjectEvent["detail"] & EntryVersionDetail;
}

export interface ProjectEventFilter {
  entryId?: string;
  fileId?: string;
  taskId?: string;
  userId?: string;
  type?: string;
}

export interface FileHistoryRow {
  id: string;
  type: string;
  label: string;
  userId: string;
  createdAt: string;
  entryId?: string;
  detail: Record<string, unknown>;
}

export interface EntryWorkflowAudit {
  translatedBy: string;
  proofreadBy: string[];
  proofreadCount: number;
  reviewedBy: string;
}

let currentProjectStorage: ProjectStorage | null = null;

export function setHistoryProjectRoot(root: ProjectDirectoryHandle): void {
  setHistoryProjectStorage(createProjectStorage(root));
}

export function setHistoryProjectStorage(storage: ProjectStorage): void {
  currentProjectStorage = storage;
}

function getProjectStorage(): ProjectStorage {
  if (!currentProjectStorage) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectStorage;
}

export async function loadEvents(
  filter: ProjectEventFilter = {},
): Promise<ProjectEvent[]> {
  const storage = getProjectStorage();

  if (!(await storage.fileExists("logs/events.jsonl"))) {
    return [];
  }

  const events = await storage.readJsonl<ProjectEvent>("logs/events.jsonl");

  return events.filter((event) => {
    if (filter.entryId && event.entry_id !== filter.entryId) {
      return false;
    }

    if (filter.fileId && !isEventForFile(event, filter.fileId)) {
      return false;
    }

    if (filter.taskId && event.task_id !== filter.taskId) {
      return false;
    }

    if (filter.userId && event.user_id !== filter.userId) {
      return false;
    }

    if (filter.type && event.type !== filter.type) {
      return false;
    }

    return true;
  });
}

export async function getFileHistory(fileId: string): Promise<FileHistoryRow[]> {
  const normalizedFileId = fileId.trim();

  if (!normalizedFileId) {
    return [];
  }

  return (await loadEvents({ fileId: normalizedFileId }))
    .map((event) => ({
      id: event.id,
      type: event.type,
      label: getFileHistoryLabel(event.type),
      userId: event.user_id,
      createdAt: event.created_at,
      entryId: event.entry_id,
      detail: event.detail ?? {},
    }))
    .sort((left, right) =>
      compareInstants(right.createdAt, left.createdAt) ||
      right.id.localeCompare(left.id),
    );
}

export async function appendEvent(event: ProjectEventInput): Promise<ProjectEvent> {
  return appendEventToStorage(getProjectStorage(), event);
}

export async function appendEventToRoot(
  root: ProjectDirectoryHandle,
  event: ProjectEventInput,
): Promise<ProjectEvent> {
  return appendEventToStorage(createProjectStorage(root), event);
}

export async function appendEventToStorage(
  storage: ProjectStorage,
  event: ProjectEventInput,
): Promise<ProjectEvent> {
  const events = (await storage.fileExists("logs/events.jsonl"))
    ? await storage.readJsonl<ProjectEvent>("logs/events.jsonl")
    : [];
  const nextEvent: ProjectEvent = {
    ...event,
    id: event.id ?? createId("event"),
    created_at: event.created_at ?? nowIso(),
  };

  await storage.ensureDirectory("logs");
  await storage.writeJsonl("logs/events.jsonl", [...events, nextEvent]);

  return nextEvent;
}

export async function getEntryHistory(entryId: string): Promise<ProjectEvent[]> {
  return loadEvents({ entryId });
}

export function deriveEntryWorkflowAudit(
  entry: Entry,
  events: ProjectEvent[],
): EntryWorkflowAudit {
  const latestEvent = [...events].reverse().find(
    (event): event is EntryVersionEvent =>
      isEntryVersionEvent(event) &&
      event.entry_id === entry.id &&
      event.created_at === entry.updated_at &&
      event.detail.after_proofread_by !== undefined &&
      event.detail.after_proofread_count !== undefined &&
      event.detail.after_reviewed_by !== undefined,
  );

  if (!latestEvent) {
    return {
      translatedBy: entry.translated_by,
      proofreadBy: normalizeProofreadUsers(entry.proofread_by),
      proofreadCount: entry.proofread_count ?? 0,
      reviewedBy: entry.reviewed_by,
    };
  }

  return {
    translatedBy:
      latestEvent.detail.after_translated_by ?? entry.translated_by,
    proofreadBy: latestEvent.detail.after_proofread_by ?? [],
    proofreadCount: latestEvent.detail.after_proofread_count ?? 0,
    reviewedBy: latestEvent.detail.after_reviewed_by ?? "",
  };
}

export function createEntryVersionEvent(
  before: Entry,
  after: Entry,
  userId: string,
  options: {
    type?: EntryVersionEvent["type"];
    operation?: EntryHistoryOperation;
    sourceEventId?: string;
    packageId?: string;
    restoredFromEventId?: string;
    restoredFromSnapshot?: EntryVersionSnapshot;
    batchId?: string;
  } = {},
): EntryVersionEvent {
  return {
    id: createId("event"),
    type: options.type ?? "entry.updated",
    user_id: userId,
    entry_id: after.id,
    file_id: after.file_id,
    created_at: after.updated_at || nowIso(),
    detail: {
      before_target: before.target,
      after_target: after.target,
      before_status: before.status,
      after_status: after.status,
      before_translated_by: before.translated_by,
      after_translated_by: after.translated_by,
      before_proofread_by: normalizeProofreadUsers(before.proofread_by),
      after_proofread_by: normalizeProofreadUsers(after.proofread_by),
      before_proofread_count: before.proofread_count ?? 0,
      after_proofread_count: after.proofread_count ?? 0,
      before_reviewed_by: before.reviewed_by,
      after_reviewed_by: after.reviewed_by,
      operation: options.operation ?? "translation_edit",
      ...(options.sourceEventId
        ? { source_event_id: options.sourceEventId }
        : {}),
      ...(options.packageId ? { package_id: options.packageId } : {}),
      ...(options.restoredFromEventId
        ? { restored_from_event_id: options.restoredFromEventId }
        : {}),
      ...(options.restoredFromSnapshot
        ? { restored_from_snapshot: options.restoredFromSnapshot }
        : {}),
      ...(options.batchId ? { batch_id: options.batchId } : {}),
    },
  };
}

export function isEntryVersionEvent(
  event: ProjectEvent,
): event is EntryVersionEvent {
  const detail = event.detail;

  return Boolean(
    (event.type === "entry.updated" || event.type === "entry.restored") &&
      event.entry_id &&
      event.file_id &&
      detail &&
      typeof detail.before_target === "string" &&
      typeof detail.after_target === "string" &&
      ENTRY_STATUSES.includes(detail.before_status as EntryStatus) &&
      ENTRY_STATUSES.includes(detail.after_status as EntryStatus) &&
      (detail.before_translated_by === undefined ||
        typeof detail.before_translated_by === "string") &&
      (detail.after_translated_by === undefined ||
        typeof detail.after_translated_by === "string") &&
      (detail.before_proofread_by === undefined ||
        (Array.isArray(detail.before_proofread_by) &&
          detail.before_proofread_by.every((value) => typeof value === "string"))) &&
      (detail.after_proofread_by === undefined ||
        (Array.isArray(detail.after_proofread_by) &&
          detail.after_proofread_by.every((value) => typeof value === "string"))) &&
      (detail.before_proofread_count === undefined ||
        typeof detail.before_proofread_count === "number") &&
      (detail.after_proofread_count === undefined ||
        typeof detail.after_proofread_count === "number") &&
      (detail.before_reviewed_by === undefined ||
        typeof detail.before_reviewed_by === "string") &&
      (detail.after_reviewed_by === undefined ||
        typeof detail.after_reviewed_by === "string"),
  );
}

function isEventForFile(event: ProjectEvent, fileId: string): boolean {
  if (event.file_id === fileId) {
    return true;
  }

  if (event.entry_id?.startsWith(`${fileId}:`)) {
    return true;
  }

  const detailFileId = event.detail?.file_id;

  return typeof detailFileId === "string" && detailFileId === fileId;
}

function getFileHistoryLabel(type: string): string {
  const labels: Record<string, string> = {
    "file.added": "添加源文件",
    "file.source_updated": "更新源文件",
    "file.translation_imported": "导入译文",
    "file.renamed": "重命名文件",
    "file.folder_updated": "调整文件分组",
    "file.hidden": "隐藏文件",
    "file.unhidden": "取消隐藏文件",
    "file.locked": "锁定文件",
    "file.unlocked": "解锁文件",
    "file.updated": "更新文件信息",
    "file.deleted": "删除文件",
    "entry.updated": "更新词条",
    "entry.restored": "恢复历史译文",
    "entry.mark_disputed": "标记争议",
    "entry.resolve_dispute": "解决争议",
    "comment.added": "新增批注",
    "comment.replied": "回复批注",
    "comment.resolved": "解决批注",
    "comment.reopened": "重新打开批注",
    "comment.deleted": "删除批注",
  };

  return labels[type] ?? type;
}
