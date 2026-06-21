import type { Entry, ProjectConfig, ProjectFile } from "../model/types";
import type { ProjectStorage } from "./projectStorage";

export interface EntryAccessState {
  entryLocked: boolean;
  entryHidden: boolean;
  fileLocked: boolean;
  fileHidden: boolean;
  locked: boolean;
  hidden: boolean;
}

export function resolveEntryAccess(
  entry: Pick<Entry, "locked" | "hidden">,
  file?: Pick<ProjectFile, "locked" | "hidden">,
): EntryAccessState {
  const entryLocked = entry.locked === true;
  const entryHidden = entry.hidden === true;
  const fileLocked = file?.locked === true;
  const fileHidden = file?.hidden === true;

  return {
    entryLocked,
    entryHidden,
    fileLocked,
    fileHidden,
    locked: entryLocked || fileLocked,
    hidden: entryHidden || fileHidden,
  };
}

export async function loadEntryAccess(
  storage: ProjectStorage,
  entry: Pick<Entry, "file_id" | "locked" | "hidden">,
): Promise<EntryAccessState> {
  const project = await storage.readJson<ProjectConfig>("project.json");
  const file = project.files.find((item) => item.id === entry.file_id);

  if (!file) {
    throw new Error("词条所属文件不存在，无法继续操作。");
  }

  return resolveEntryAccess(entry, file);
}

export async function assertEntryContentWritable(
  storage: ProjectStorage,
  entry: Pick<Entry, "file_id" | "locked" | "hidden">,
): Promise<void> {
  const access = await loadEntryAccess(storage, entry);

  if (access.fileLocked) {
    throw new Error("词条所属文件已锁定，不能修改。");
  }

  if (access.fileHidden) {
    throw new Error("词条所属文件已隐藏，不能修改。");
  }

  if (access.entryLocked) {
    throw new Error("当前词条已锁定，不能修改。");
  }

  if (access.entryHidden) {
    throw new Error("当前词条已隐藏，不能修改。");
  }
}
