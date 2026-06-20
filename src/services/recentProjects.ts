import {
  readLocalStorageItem,
  removeLocalStorageItem,
  writeLocalStorageItem,
} from "../utils/browserStorage";
import { nowIso } from "../utils/time";
import type { ProjectDirectoryHandle } from "./projectFs";

export type RecentProjectSourceType = "folder" | "hproj";

export interface RecentProjectRecord {
  recordId: string;
  projectId: string;
  name: string;
  sourceType: RecentProjectSourceType;
  displayPath: string;
  lastOpenedAt: string;
  lastUserId?: string;
}

export interface RecentProjectInput {
  projectId: string;
  name: string;
  sourceType: RecentProjectSourceType;
  displayPath: string;
  lastUserId?: string;
}

export type RecentProjectAccessState = "granted" | "prompt" | "denied";

const RECENT_PROJECTS_STORAGE_KEY = "textile.recentProjects.v1";
const RECENT_PROJECTS_DB_NAME = "textile-recent-projects";
const RECENT_PROJECTS_DB_VERSION = 1;
const PROJECT_HANDLES_STORE = "projectHandles";
const MAX_RECENT_PROJECTS = 12;

function readRecentProjects(): RecentProjectRecord[] {
  const text = readLocalStorageItem(RECENT_PROJECTS_STORAGE_KEY);

  if (!text) {
    return [];
  }

  try {
    const rows = JSON.parse(text) as RecentProjectRecord[];

    return Array.isArray(rows) ? sortRecentProjects(normalizeRecords(rows)) : [];
  } catch {
    removeLocalStorageItem(RECENT_PROJECTS_STORAGE_KEY);
    return [];
  }
}

function buildRecentProjectRecordId(input: RecentProjectInput): string {
  return [
    input.projectId,
    input.sourceType,
    input.displayPath.trim() || input.name.trim() || "project",
  ].join("::");
}

function normalizeRecords(records: RecentProjectRecord[]): RecentProjectRecord[] {
  return records
    .filter((record) => record?.projectId && record.name)
    .map((record) => ({
      ...record,
      recordId: record.recordId || record.projectId,
    }));
}

function writeRecentProjects(records: RecentProjectRecord[]): void {
  writeLocalStorageItem(
    RECENT_PROJECTS_STORAGE_KEY,
    JSON.stringify(sortRecentProjects(records).slice(0, MAX_RECENT_PROJECTS)),
  );
}

function sortRecentProjects(
  records: RecentProjectRecord[],
): RecentProjectRecord[] {
  return [...records].sort((left, right) =>
    right.lastOpenedAt.localeCompare(left.lastOpenedAt),
  );
}

function openRecentProjectDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(
      RECENT_PROJECTS_DB_NAME,
      RECENT_PROJECTS_DB_VERSION,
    );

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(PROJECT_HANDLES_STORE)) {
        database.createObjectStore(PROJECT_HANDLES_STORE);
      }
    };

    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  });
}

async function writeProjectHandle(
  recordId: string,
  root?: ProjectDirectoryHandle,
): Promise<void> {
  if (!root || root.storageKind === "packed") {
    return;
  }

  const database = await openRecentProjectDatabase();

  if (!database) {
    return;
  }

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(PROJECT_HANDLES_STORE, "readwrite");

    try {
      transaction.objectStore(PROJECT_HANDLES_STORE).put(root, recordId);
    } catch {
      resolve();
      return;
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
  database.close();
}

async function deleteProjectHandle(recordId: string): Promise<void> {
  const database = await openRecentProjectDatabase();

  if (!database) {
    return;
  }

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(PROJECT_HANDLES_STORE, "readwrite");

    transaction.objectStore(PROJECT_HANDLES_STORE).delete(recordId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
  database.close();
}

async function clearProjectHandles(): Promise<void> {
  const database = await openRecentProjectDatabase();

  if (!database) {
    return;
  }

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(PROJECT_HANDLES_STORE, "readwrite");

    transaction.objectStore(PROJECT_HANDLES_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
  database.close();
}

export function listRecentProjects(): RecentProjectRecord[] {
  return readRecentProjects();
}

export async function rememberRecentProject(
  input: RecentProjectInput,
  root?: ProjectDirectoryHandle,
): Promise<RecentProjectRecord[]> {
  const recordId = buildRecentProjectRecordId(input);
  const existing = readRecentProjects().filter(
    (record) => record.recordId !== recordId,
  );
  const record: RecentProjectRecord = {
    ...input,
    recordId,
    lastOpenedAt: nowIso(),
  };

  writeRecentProjects([record, ...existing]);
  await writeProjectHandle(recordId, root);

  return listRecentProjects();
}

export function updateRecentProjectUser(
  projectId: string,
  userId: string,
): RecentProjectRecord[] {
  const records = readRecentProjects().map((record) =>
    record.projectId === projectId ? { ...record, lastUserId: userId } : record,
  );

  writeRecentProjects(records);

  return listRecentProjects();
}

export async function removeRecentProject(recordId: string): Promise<RecentProjectRecord[]> {
  writeRecentProjects(
    readRecentProjects().filter((record) => record.recordId !== recordId),
  );
  await deleteProjectHandle(recordId);

  return listRecentProjects();
}

export async function clearRecentProjects(): Promise<RecentProjectRecord[]> {
  writeRecentProjects([]);
  await clearProjectHandles();

  return [];
}

export async function getRecentProjectHandle(
  recordId: string,
): Promise<ProjectDirectoryHandle | null> {
  const database = await openRecentProjectDatabase();

  if (!database) {
    return null;
  }

  const handle = await new Promise<ProjectDirectoryHandle | null>((resolve) => {
    const transaction = database.transaction(PROJECT_HANDLES_STORE, "readonly");
    const request = transaction.objectStore(PROJECT_HANDLES_STORE).get(recordId);

    request.onsuccess = () =>
      resolve((request.result as ProjectDirectoryHandle | undefined) ?? null);
    request.onerror = () => resolve(null);
  });

  database.close();

  return handle;
}

export async function hasRecentProjectAccess(
  root: ProjectDirectoryHandle,
): Promise<boolean> {
  return (await getRecentProjectAccessState(root)) === "granted";
}

export async function getRecentProjectAccessState(
  root: ProjectDirectoryHandle,
): Promise<RecentProjectAccessState> {
  if (!root.queryPermission) {
    return "granted";
  }

  try {
    const permission = await root.queryPermission({ mode: "readwrite" });

    return permission === "granted" || permission === "prompt"
      ? permission
      : "denied";
  } catch {
    return "denied";
  }
}

export async function requestRecentProjectAccess(
  root: ProjectDirectoryHandle,
): Promise<boolean> {
  const currentState = await getRecentProjectAccessState(root);

  if (currentState === "granted") {
    return true;
  }

  if (currentState === "denied" || !root.requestPermission) {
    return false;
  }

  try {
    return (await root.requestPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}
