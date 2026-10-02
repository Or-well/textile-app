import type { Entry } from "../model/types";

export interface EntryLocation {
  chunkPath: string;
  rowIndex: number;
}

export interface EntryChunkSnapshot {
  path: string;
  entries: Entry[];
}

interface FileEntrySnapshot {
  entries: Entry[];
  locations: Map<string, EntryLocation>;
}

const fileSnapshots = new Map<string, FileEntrySnapshot>();
const loadingFiles = new Map<string, Promise<Entry[]>>();
const entriesById = new Map<string, Entry>();
let generation = 0;
const fileGenerations = new Map<string, number>();

function removeIndexedFile(fileId: string): void {
  const snapshot = fileSnapshots.get(fileId);

  if (!snapshot) {
    return;
  }

  for (const entry of snapshot.entries) {
    if (entriesById.get(entry.id)?.file_id === fileId) {
      entriesById.delete(entry.id);
    }
  }
}

function indexFile(
  fileId: string,
  entries: Entry[],
  locations: Map<string, EntryLocation>,
): Entry[] {
  removeIndexedFile(fileId);
  fileSnapshots.set(fileId, { entries, locations });

  for (const entry of entries) {
    entriesById.set(entry.id, entry);
  }

  return entries;
}

export function resetEntryReadModel(): void {
  generation += 1;
  fileSnapshots.clear();
  loadingFiles.clear();
  entriesById.clear();
  fileGenerations.clear();
}

export function getEntryReadModelGeneration(): number {
  return generation;
}

export function getFileReadGeneration(fileId: string): number {
  return fileGenerations.get(fileId) ?? 0;
}

function advanceFileGeneration(fileId: string): void {
  fileGenerations.set(fileId, getFileReadGeneration(fileId) + 1);
  loadingFiles.delete(fileId);
}

export function getCachedFileEntries(fileId: string): Entry[] | undefined {
  return fileSnapshots.get(fileId)?.entries;
}

export function getCachedEntry(entryId: string): Entry | undefined {
  return entriesById.get(entryId);
}

export function getCachedEntryLocation(
  entryId: string,
): EntryLocation | undefined {
  const fileId = entriesById.get(entryId)?.file_id;

  return fileId
    ? fileSnapshots.get(fileId)?.locations.get(entryId)
    : undefined;
}

export function cacheFileEntryChunks(
  fileId: string,
  chunks: EntryChunkSnapshot[],
  expectedGeneration = generation,
  expectedFileGeneration = getFileReadGeneration(fileId),
): Entry[] {
  const entries: Entry[] = [];
  const locations = new Map<string, EntryLocation>();

  for (const chunk of chunks) {
    for (const [rowIndex, entry] of chunk.entries.entries()) {
      entries.push(entry);
      locations.set(entry.id, { chunkPath: chunk.path, rowIndex });
    }
  }

  entries.sort(
    (left, right) => left.index - right.index || left.id.localeCompare(right.id),
  );

  return expectedGeneration === generation &&
    expectedFileGeneration === getFileReadGeneration(fileId)
    ? indexFile(fileId, entries, locations)
    : entries;
}

export function cacheFileEntries(fileId: string, entries: Entry[]): Entry[] {
  advanceFileGeneration(fileId);
  const previous = fileSnapshots.get(fileId);
  // Positions remain valid only when membership and ordering have not changed.
  const unchangedLayout = previous?.entries.length === entries.length &&
    previous.entries.every((entry, index) => entry.id === entries[index]?.id);
  return indexFile(fileId, entries, unchangedLayout ? previous.locations : new Map());
}

export function cacheWrittenEntryChunks(fileId: string, chunks: EntryChunkSnapshot[]): Entry[] {
  advanceFileGeneration(fileId);
  return cacheFileEntryChunks(fileId, chunks);
}

export function updateCachedEntry(entry: Entry): void {
  advanceFileGeneration(entry.file_id);
  const snapshot = fileSnapshots.get(entry.file_id);

  if (!snapshot) {
    return;
  }

  const index = snapshot.entries.findIndex((row) => row.id === entry.id);

  if (index < 0) {
    return;
  }

  snapshot.entries[index] = entry;
  entriesById.set(entry.id, entry);
}

export function invalidateCachedFile(fileId: string): void {
  advanceFileGeneration(fileId);
  removeIndexedFile(fileId);
  fileSnapshots.delete(fileId);
  loadingFiles.delete(fileId);
}

export function getOrLoadFileEntries(
  fileId: string,
  loader: () => Promise<Entry[]>,
): Promise<Entry[]> {
  const cached = getCachedFileEntries(fileId);

  if (cached) {
    return Promise.resolve(cached);
  }

  const existingRequest = loadingFiles.get(fileId);

  if (existingRequest) {
    return existingRequest;
  }

  const request = loader().finally(() => {
    if (loadingFiles.get(fileId) === request) {
      loadingFiles.delete(fileId);
    }
  });

  loadingFiles.set(fileId, request);
  return request;
}
