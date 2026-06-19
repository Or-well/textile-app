import type { Member, ProjectConfig } from "../model/types";
import {
  fileExists,
  readJson,
  type ProjectDirectoryHandle,
} from "./projectFs";

export type ProjectDeletionMode = "local_record_only";

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

const REQUIRED_PROJECT_MARKERS = [
  "project.json",
  "members.json",
  "entries",
] as const;

async function assertCurrentProjectSource(
  root: ProjectDirectoryHandle,
  project: ProjectConfig,
): Promise<void> {
  for (const marker of REQUIRED_PROJECT_MARKERS) {
    if (!(await fileExists(root, marker))) {
      throw new Error("当前项目来源不像 Textile 项目，已阻止继续。");
    }
  }

  const sourceProject = await readJson<ProjectConfig>(root, "project.json");

  if (sourceProject.project_id !== project.project_id) {
    throw new Error("当前项目来源中的项目 ID 与正在打开的项目不一致，已阻止继续。");
  }
}

export async function scanProjectDeletion(
  root: ProjectDirectoryHandle,
  project: ProjectConfig,
): Promise<ProjectDeletionScan> {
  await assertCurrentProjectSource(root, project);

  return {
    canDelete: true,
    mode: "local_record_only",
    fileCount: 0,
    directoryCount: 0,
    rootName: root.storageKind === "packed"
      ? root.sourceFileName ?? root.name
      : root.name,
    deleteTarget: "本机最近项目记录和当前项目会话",
    entries: [
      "从最近项目移除",
      "清除当前项目会话",
      "返回项目启动页",
      "磁盘文件不会被删除",
    ],
    warnings: [
      "当前版本不会自动删除磁盘上的项目文件。如需彻底删除，请确认备份后手动删除项目文件夹。",
    ],
  };
}

export async function deleteCurrentProjectSource(
  root: ProjectDirectoryHandle,
  project: ProjectConfig,
  _actor: Member | null | undefined,
): Promise<ProjectDeletionResult> {
  await assertCurrentProjectSource(root, project);

  return {
    diskFilesDeleted: false,
    rootFolderDeleted: false,
    deletedEntries: [],
    failedEntries: [],
    message:
      "已从最近项目移除并清除当前项目会话。当前版本不会自动删除磁盘上的项目文件。",
  };
}
