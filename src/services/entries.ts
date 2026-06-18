import type { Entry } from "../model/types";
import {
  listFiles,
  readJsonl,
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

export async function loadEntries(fileId: string): Promise<Entry[]> {
  const root = getProjectRoot();
  const entryDirectory = `entries/${fileId}`;

  try {
    const fileNames = await listFiles(root, entryDirectory);
    const chunkFiles = fileNames.filter((name) => /^chunk_.*\.jsonl$/i.test(name));
    const entryGroups = await Promise.all(
      chunkFiles.map((fileName) =>
        readJsonl<Entry>(root, `${entryDirectory}/${fileName}`),
      ),
    );
    const entries = entryGroups
      .flat()
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
    const entries = entryGroups
      .flat()
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
