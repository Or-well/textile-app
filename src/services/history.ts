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
import { nowIso } from "../utils/time";
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
  taskId?: string;
  userId?: string;
  type?: string;
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
