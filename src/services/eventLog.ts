import type { ProjectEvent } from "../model/types";
import { mapWithConcurrency } from "../utils/async";
import type { ProjectStorage } from "./projectStorage";
import type { ProjectWritePlan } from "./projectWritePlan";

export const LEGACY_EVENT_LOG_PATH = "logs/events.jsonl";
export const EVENT_ARCHIVE_DIRECTORY = "logs/events";
export const EVENT_LOG_CHUNK_SIZE = 1000;

const EVENT_ARCHIVE_PATTERN = /^chunk_(\d{6})\.jsonl$/;

interface EventArchiveFile {
  index: number;
  path: string;
}

async function listEventArchiveFiles(
  storage: ProjectStorage,
): Promise<EventArchiveFile[]> {
  if (!(await storage.fileExists(EVENT_ARCHIVE_DIRECTORY))) {
    return [];
  }

  return (await storage.listFiles(EVENT_ARCHIVE_DIRECTORY))
    .map((name) => {
      const match = EVENT_ARCHIVE_PATTERN.exec(name);

      return match
        ? {
            index: Number(match[1]),
            path: `${EVENT_ARCHIVE_DIRECTORY}/${name}`,
          }
        : null;
    })
    .filter((file): file is EventArchiveFile => file !== null)
    .sort((left, right) => left.index - right.index);
}

function archivePath(index: number): string {
  return `${EVENT_ARCHIVE_DIRECTORY}/chunk_${String(index).padStart(6, "0")}.jsonl`;
}

function findLastMatchingEvent(
  events: readonly ProjectEvent[],
  predicate: (event: ProjectEvent) => boolean,
): ProjectEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;

    if (predicate(event)) {
      return event;
    }
  }

  return undefined;
}

export async function loadProjectEventsFromStorage(
  storage: ProjectStorage,
): Promise<ProjectEvent[]> {
  const archives = await listEventArchiveFiles(storage);
  const archiveGroups = await mapWithConcurrency(
    archives,
    8,
    (file) => storage.readJsonl<ProjectEvent>(file.path),
  );
  const activeEvents = (await storage.fileExists(LEGACY_EVENT_LOG_PATH))
    ? await storage.readJsonl<ProjectEvent>(LEGACY_EVENT_LOG_PATH)
    : [];

  return [...archiveGroups.flat(), ...activeEvents];
}

export async function findProjectEventFromNewest(
  storage: ProjectStorage,
  predicate: (event: ProjectEvent) => boolean,
): Promise<ProjectEvent | undefined> {
  const activeEvents = (await storage.fileExists(LEGACY_EVENT_LOG_PATH))
    ? await storage.readJsonl<ProjectEvent>(LEGACY_EVENT_LOG_PATH)
    : [];
  const activeMatch = findLastMatchingEvent(activeEvents, predicate);

  if (activeMatch) {
    return activeMatch;
  }

  const archives = await listEventArchiveFiles(storage);

  for (const archive of archives.reverse()) {
    const match = findLastMatchingEvent(
      await storage.readJsonl<ProjectEvent>(archive.path),
      predicate,
    );

    if (match) {
      return match;
    }
  }

  return undefined;
}

export async function planAppendProjectEvents(
  writePlan: ProjectWritePlan,
  storage: ProjectStorage,
  events: readonly ProjectEvent[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const archives = await listEventArchiveFiles(storage);
  const activeEvents = (await storage.fileExists(LEGACY_EVENT_LOG_PATH))
    ? await storage.readJsonl<ProjectEvent>(LEGACY_EVENT_LOG_PATH)
    : [];
  const pending = [...activeEvents, ...events];
  let nextArchiveIndex = (archives.at(-1)?.index ?? 0) + 1;

  while (pending.length > EVENT_LOG_CHUNK_SIZE) {
    writePlan.writeJsonl(
      archivePath(nextArchiveIndex),
      pending.splice(0, EVENT_LOG_CHUNK_SIZE),
    );
    nextArchiveIndex += 1;
  }

  writePlan.writeJsonl(LEGACY_EVENT_LOG_PATH, pending);
}

export async function planReplaceProjectEvents(
  writePlan: ProjectWritePlan,
  storage: ProjectStorage,
  events: readonly ProjectEvent[],
): Promise<void> {
  const existingArchives = await listEventArchiveFiles(storage);
  const desiredArchives: ProjectEvent[][] = [];
  const pending = [...events];

  while (pending.length > EVENT_LOG_CHUNK_SIZE) {
    desiredArchives.push(pending.splice(0, EVENT_LOG_CHUNK_SIZE));
  }

  for (const [index, rows] of desiredArchives.entries()) {
    writePlan.writeJsonl(archivePath(index + 1), rows);
  }

  for (const archive of existingArchives.filter(
    (file) => file.index > desiredArchives.length,
  )) {
    writePlan.deleteFile(archive.path);
  }

  writePlan.writeJsonl(LEGACY_EVENT_LOG_PATH, pending);
}
