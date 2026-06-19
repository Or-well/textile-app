import type { Member, ProjectConfig } from "../model/types";
import { nowIso } from "../utils/time";
import { appendEventToRoot } from "./history";
import {
  fileExists,
  readJson,
  type ProjectDirectoryHandle,
} from "./projectFs";

export type ProjectDeletionMode = "folder_contents" | "hproj_source";

export interface ProjectDeletionScan {
  canDelete: boolean;
  mode: ProjectDeletionMode;
  fileCount: number;
  directoryCount: number;
  rootName: string;
  deleteTarget: string;
  entries: string[];
  warnings: string[];
}

export interface ProjectDeletionResult {
  diskFilesDeleted: boolean;
  rootFolderDeleted: boolean;
  deletedEntries: string[];
  failedEntries: Array<{ path: string; reason: string }>;
  message: string;
}

interface AppProjectDeletionEvent {
  id: string;
  type: "project.deleted";
  project_id: string;
  project_name: string;
  user_id: string;
  deleted_at: string;
  disk_files_deleted: boolean;
  root_folder_deleted: boolean;
  delete_mode: ProjectDeletionMode;
  failed_entries: Array<{ path: string; reason: string }>;
}

const APP_DELETION_LOG_KEY = "textile.app.projectDeletionEvents.v1";
const REQUIRED_PROJECT_MARKERS = [
  "project.json",
  "members.json",
  "entries",
] as const;

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function createEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `project-delete-${Date.now()}`;
}

function isDirectoryLikeError(error: unknown): boolean {
  return error instanceof Error && /directory|目录/i.test(error.message);
}

async function isDirectory(root: ProjectDirectoryHandle, name: string): Promise<boolean> {
  try {
    await root.getDirectoryHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function countTree(
  directory: ProjectDirectoryHandle,
  prefix = "",
): Promise<{ fileCount: number; directoryCount: number; entries: string[] }> {
  let fileCount = 0;
  let directoryCount = 0;
  const entries: string[] = [];

  for await (const name of directory.keys()) {
    const path = prefix ? `${prefix}/${name}` : name;

    if (await isDirectory(directory, name)) {
      directoryCount += 1;
      entries.push(`${path}/`);

      const child = await directory.getDirectoryHandle(name);
      const childCount = await countTree(child, path);

      fileCount += childCount.fileCount;
      directoryCount += childCount.directoryCount;
      entries.push(...childCount.entries);
    } else {
      fileCount += 1;
      entries.push(path);
    }
  }

  return { fileCount, directoryCount, entries };
}

async function assertCurrentProjectSource(
  root: ProjectDirectoryHandle,
  project: ProjectConfig,
): Promise<void> {
  for (const marker of REQUIRED_PROJECT_MARKERS) {
    if (!(await fileExists(root, marker))) {
      throw new Error("当前项目来源不像 Textile 项目，已阻止删除。");
    }
  }

  const sourceProject = await readJson<ProjectConfig>(root, "project.json");

  if (sourceProject.project_id !== project.project_id) {
    throw new Error("当前项目来源中的项目 ID 与正在打开的项目不一致，已阻止删除。");
  }
}

export async function scanProjectDeletion(
  root: ProjectDirectoryHandle,
  project: ProjectConfig,
): Promise<ProjectDeletionScan> {
  await assertCurrentProjectSource(root, project);

  const tree = await countTree(root);

  if (root.storageKind === "packed") {
    const sourceName = root.sourceFileName ?? root.name;

    return {
      canDelete: false,
      mode: "hproj_source",
      fileCount: tree.fileCount,
      directoryCount: tree.directoryCount,
      rootName: sourceName,
      deleteTarget: sourceName,
      entries: [sourceName],
      warnings: [
        "当前项目来自 .hproj 文件，但浏览器只提供了读取这个文件的权限。",
        "程序无法确认并删除源 .hproj 文件。请在文件管理器中手动删除该 .hproj 文件。",
      ],
    };
  }

  if (!root.removeEntry) {
    throw new Error("当前浏览器不支持删除本地项目文件。");
  }

  return {
    canDelete: true,
    mode: "folder_contents",
    fileCount: tree.fileCount,
    directoryCount: tree.directoryCount,
    rootName: root.name,
    deleteTarget: `${root.name} 文件夹中的项目内容`,
    entries: tree.entries.slice(0, 40),
    warnings: [
      "浏览器只能删除当前项目文件夹中的内容，项目根文件夹本身可能会保留为空文件夹。",
      "删除后无法从程序内恢复，请确认已经备份。",
    ],
  };
}

export async function deleteCurrentProjectSource(
  root: ProjectDirectoryHandle,
  project: ProjectConfig,
  actor: Member | null | undefined,
): Promise<ProjectDeletionResult> {
  await assertCurrentProjectSource(root, project);

  if (root.storageKind === "packed") {
    throw new Error("当前浏览器没有授予删除源 .hproj 文件的权限，请手动删除该文件。");
  }

  if (!root.removeEntry) {
    throw new Error("当前浏览器不支持删除本地项目文件。");
  }

  await appendEventToRoot(root, {
    type: "project.delete_requested",
    user_id: actor?.id ?? "",
    detail: {
      project_name: project.name,
      delete_mode: "folder_contents",
      disk_files_deleted: true,
    },
  });

  const deletedEntries: string[] = [];
  const failedEntries: Array<{ path: string; reason: string }> = [];

  for await (const name of root.keys()) {
    try {
      await root.removeEntry(name, { recursive: true });
      deletedEntries.push(name);
    } catch (error) {
      failedEntries.push({
        path: name,
        reason: error instanceof Error ? error.message : "删除失败。",
      });

      if (!isDirectoryLikeError(error)) {
        continue;
      }
    }
  }

  const diskFilesDeleted = failedEntries.length === 0;
  const result: ProjectDeletionResult = {
    diskFilesDeleted,
    rootFolderDeleted: false,
    deletedEntries,
    failedEntries,
    message: diskFilesDeleted
      ? "项目内容已删除。项目根文件夹可能仍为空文件夹。"
      : "项目未完全删除，请手动检查失败项。",
  };

  appendAppProjectDeletionEvent(project, actor, result);

  return result;
}

function appendAppProjectDeletionEvent(
  project: ProjectConfig,
  actor: Member | null | undefined,
  result: ProjectDeletionResult,
): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    const text = window.localStorage.getItem(APP_DELETION_LOG_KEY);
    const rows = text
      ? (JSON.parse(text) as AppProjectDeletionEvent[])
      : [];
    const event: AppProjectDeletionEvent = {
      id: createEventId(),
      type: "project.deleted",
      project_id: project.project_id,
      project_name: project.name,
      user_id: actor?.id ?? "",
      deleted_at: nowIso(),
      disk_files_deleted: result.diskFilesDeleted,
      root_folder_deleted: result.rootFolderDeleted,
      delete_mode: "folder_contents",
      failed_entries: result.failedEntries,
    };

    window.localStorage.setItem(
      APP_DELETION_LOG_KEY,
      JSON.stringify([event, ...rows].slice(0, 100)),
    );
  } catch {
    // App-level deletion audit is best-effort local metadata.
  }
}
