import type { ProjectEvent } from "../model/types";
import { mapWithConcurrency } from "../utils/async";
import { stringifyJsonl } from "../utils/jsonl";
import type { ProjectStorage } from "./projectStorage";
import type { ProjectWritePlan } from "./projectWritePlan";

export const LEGACY_EVENT_LOG_PATH = "logs/events.jsonl";
export const EVENT_ARCHIVE_DIRECTORY = "logs/events";
export const EVENT_LOG_CHUNK_SIZE = 1000;
export const EVENT_LOG_CHUNK_BYTES = 256 * 1024;

const EVENT_ARCHIVE_PATTERN = /^chunk_(\d{6})\.jsonl$/;

export interface EventArchiveFile {
  index: number;
  path: string;
}

export interface ProjectEventLogTail {
  archives: readonly EventArchiveFile[];
  activeEvents: readonly ProjectEvent[];
}

const textEncoder = new TextEncoder();

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

function splitEventChunks(events: readonly ProjectEvent[]): ProjectEvent[][] {
  const chunks: ProjectEvent[][] = [];
  let current: ProjectEvent[] = [];
  let currentBytes = 0;

  for (const event of events) {
    const eventBytes = textEncoder.encode(stringifyJsonl([event])).byteLength;

    if (
      current.length > 0 &&
      (current.length >= EVENT_LOG_CHUNK_SIZE ||
        currentBytes + eventBytes > EVENT_LOG_CHUNK_BYTES)
    ) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(event);
    currentBytes += eventBytes;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

export async function loadProjectEventLogTail(
  storage: ProjectStorage,
): Promise<ProjectEventLogTail> {
  const [archives, activeEvents] = await Promise.all([
    listEventArchiveFiles(storage),
    storage.fileExists(LEGACY_EVENT_LOG_PATH).then((exists) =>
      exists ? storage.readJsonl<ProjectEvent>(LEGACY_EVENT_LOG_PATH) : [],
    ),
  ]);

  return { archives, activeEvents };
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
  tail?: ProjectEventLogTail,
): Promise<ProjectEvent | undefined> {
  const eventLogTail = tail ?? (await loadProjectEventLogTail(storage));
  const activeMatch = findLastMatchingEvent(eventLogTail.activeEvents, predicate);

  if (activeMatch) {
    return activeMatch;
  }

  for (const archive of [...eventLogTail.archives].reverse()) {
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
  tail?: ProjectEventLogTail,
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const eventLogTail = tail ?? (await loadProjectEventLogTail(storage));
  const chunks = splitEventChunks([...eventLogTail.activeEvents, ...events]);
  const activeEvents = chunks.pop() ?? [];
  let nextArchiveIndex = (eventLogTail.archives.at(-1)?.index ?? 0) + 1;

  for (const chunk of chunks) {
    writePlan.writeJsonl(archivePath(nextArchiveIndex), chunk);
    nextArchiveIndex += 1;
  }

  writePlan.writeJsonl(LEGACY_EVENT_LOG_PATH, activeEvents);
}

export async function planReplaceProjectEvents(
  writePlan: ProjectWritePlan,
  storage: ProjectStorage,
  events: readonly ProjectEvent[],
): Promise<void> {
  const existingArchives = await listEventArchiveFiles(storage);
  const chunks = splitEventChunks(events);
  const activeEvents = chunks.pop() ?? [];
  const desiredArchives = chunks;

  for (const [index, rows] of desiredArchives.entries()) {
    writePlan.writeJsonl(archivePath(index + 1), rows);
  }

  for (const archive of existingArchives.filter(
    (file) => file.index > desiredArchives.length,
  )) {
    writePlan.deleteFile(archive.path);
  }

  writePlan.writeJsonl(LEGACY_EVENT_LOG_PATH, activeEvents);
}
