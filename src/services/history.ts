import type { ProjectEvent } from "../model/types";
import { createId } from "../utils/id";
import { nowIso } from "../utils/time";
import {
  ensureDirectory,
  fileExists,
  readJsonl,
  writeJsonl,
  type ProjectDirectoryHandle,
} from "./projectFs";

type ProjectEventInput = Omit<ProjectEvent, "id" | "created_at"> &
  Partial<Pick<ProjectEvent, "id" | "created_at">>;

export interface ProjectEventFilter {
  entryId?: string;
  taskId?: string;
  userId?: string;
  type?: string;
}

let currentProjectRoot: ProjectDirectoryHandle | null = null;

export function setHistoryProjectRoot(root: ProjectDirectoryHandle): void {
  currentProjectRoot = root;
}

function getProjectRoot(): ProjectDirectoryHandle {
  if (!currentProjectRoot) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectRoot;
}

export async function loadEvents(
  filter: ProjectEventFilter = {},
): Promise<ProjectEvent[]> {
  const root = getProjectRoot();

  if (!(await fileExists(root, "logs/events.jsonl"))) {
    return [];
  }

  const events = await readJsonl<ProjectEvent>(root, "logs/events.jsonl");

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
  const root = getProjectRoot();

  return appendEventToRoot(root, event);
}

export async function appendEventToRoot(
  root: ProjectDirectoryHandle,
  event: ProjectEventInput,
): Promise<ProjectEvent> {
  const events = (await fileExists(root, "logs/events.jsonl"))
    ? await readJsonl<ProjectEvent>(root, "logs/events.jsonl")
    : [];
  const nextEvent: ProjectEvent = {
    ...event,
    id: event.id ?? createId("event"),
    created_at: event.created_at ?? nowIso(),
  };

  await ensureDirectory(root, "logs");
  await writeJsonl(root, "logs/events.jsonl", [...events, nextEvent]);

  return nextEvent;
}

export async function getEntryHistory(entryId: string): Promise<ProjectEvent[]> {
  return loadEvents({ entryId });
}
