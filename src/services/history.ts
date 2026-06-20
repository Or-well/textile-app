import type { ProjectEvent } from "../model/types";
import { createId } from "../utils/id";
import { nowIso } from "../utils/time";
import type { ProjectDirectoryHandle } from "./projectFs";
import {
  createProjectStorage,
  type ProjectStorage,
} from "./projectStorage";

type ProjectEventInput = Omit<ProjectEvent, "id" | "created_at"> &
  Partial<Pick<ProjectEvent, "id" | "created_at">>;

export interface ProjectEventFilter {
  entryId?: string;
  taskId?: string;
  userId?: string;
  type?: string;
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
