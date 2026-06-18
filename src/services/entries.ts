import type { Entry } from "../model/types";
import { normalizeEntries, normalizeEntry } from "../model/status";
import { nowIso } from "../utils/time";
import {
  listFiles,
  readJsonl,
  writeJsonl,
  type ProjectDirectoryHandle,
} from "./projectFs";

let currentProjectRoot: ProjectDirectoryHandle | null = null;
let cachedEntries: Entry[] = [];

export function setEntriesProjectRoot(root: ProjectDirectoryHandle): void {
  currentProjectRoot = root;
  cachedEntries = [];
}

function getProjectRoot(): ProjectDirectoryHandle {
  if (!currentProjectRoot) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectRoot;
}

function getFileIdFromEntryId(entryId: string): string {
  const [fileId] = entryId.split(":");

  if (!fileId) {
    throw new Error("词条编号不正确，无法查找词条。");
  }

  return fileId;
}

async function listEntryChunkFiles(
  root: ProjectDirectoryHandle,
  fileId: string,
): Promise<string[]> {
  const entryDirectory = `entries/${fileId}`;
  const fileNames = await listFiles(root, entryDirectory);

  return fileNames
    .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

export async function loadEntries(fileId: string): Promise<Entry[]> {
  const root = getProjectRoot();
  const entryDirectory = `entries/${fileId}`;

  try {
    const chunkFiles = await listEntryChunkFiles(root, fileId);
    const entryGroups = await Promise.all(
      chunkFiles.map((fileName) =>
        readJsonl<Entry>(root, `${entryDirectory}/${fileName}`),
      ),
    );
    const entries = normalizeEntries(entryGroups.flat())
      .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));

    cachedEntries = [
      ...cachedEntries.filter((entry) => entry.file_id !== fileId),
      ...entries,
    ];

    return entries;
  } catch {
    throw new Error("词条数据无法读取。请确认项目文件夹和词条文件没有损坏。");
  }
}

export async function loadAllEntries(): Promise<Entry[]> {
  const root = getProjectRoot();

  try {
    const fileIds = await listFiles(root, "entries");
    const entryGroups = await Promise.all(
      fileIds.map((fileId) => loadEntries(fileId)),
    );
    const entries = normalizeEntries(entryGroups.flat())
      .sort((a, b) => a.file_id.localeCompare(b.file_id) || a.index - b.index);

    cachedEntries = entries;

    return entries;
  } catch {
    throw new Error("词条列表无法读取。请确认项目里包含 entries 文件夹。");
  }
}

export async function getEntryById(entryId: string): Promise<Entry | undefined> {
  const cachedEntry = cachedEntries.find((entry) => entry.id === entryId);

  if (cachedEntry) {
    return cachedEntry;
  }

  const fileId = getFileIdFromEntryId(entryId);
  const entries = await loadEntries(fileId);

  return entries.find((entry) => entry.id === entryId);
}

export async function saveEntry(entry: Entry): Promise<Entry> {
  const root = getProjectRoot();
  const fileId = getFileIdFromEntryId(entry.id);
  const entryDirectory = `entries/${fileId}`;
  const chunkFiles = await listEntryChunkFiles(root, fileId);

  for (const chunkFile of chunkFiles) {
    const chunkPath = `${entryDirectory}/${chunkFile}`;
    const entries = normalizeEntries(await readJsonl<Entry>(root, chunkPath));
    const entryIndex = entries.findIndex((row) => row.id === entry.id);

    if (entryIndex < 0) {
      continue;
    }

    const originalEntry = normalizeEntry(entries[entryIndex]);
    const target = entry.target;
    const shouldMarkTranslated =
      target.trim().length > 0 && originalEntry.status === "untranslated";
    const savedEntry: Entry = {
      ...originalEntry,
      ...entry,
      status: shouldMarkTranslated ? "translated" : entry.status,
      updated_at: nowIso(),
      updated_by: entry.updated_by || originalEntry.assignee || originalEntry.updated_by,
    };

    if (shouldMarkTranslated && !savedEntry.translated_by) {
      savedEntry.translated_by = savedEntry.updated_by;
    }

    entries[entryIndex] = savedEntry;

    await writeJsonl(root, chunkPath, entries);

    cachedEntries = cachedEntries.map((cachedEntry) =>
      cachedEntry.id === savedEntry.id ? savedEntry : cachedEntry,
    );

    if (!cachedEntries.some((cachedEntry) => cachedEntry.id === savedEntry.id)) {
      cachedEntries.push(savedEntry);
    }

    return savedEntry;
  }

  throw new Error("没有找到要保存的词条。请重新打开项目后再试。");
}
