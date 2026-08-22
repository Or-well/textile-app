import type { Member, ProjectConfig } from "../model/types";
import { formatNativePathForDisplay } from "../utils/nativePath";
import { isTauriRuntime } from "../utils/tauriRuntime";
import { withAppOperation } from "./appOperation";
import {
  fileExists,
  readJson,
  type ProjectDirectoryHandle,
} from "./projectFs";

export type ProjectDeletionMode = "local_record_only" | "native_project_folder";

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

interface NativeProjectDirectoryDeletionResult {
  deletedPath: string;
  fileCount: number;
  directoryCount: number;
}

async function invokeTauriCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");

  return invoke<T>(command, args);
}

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
    throw new Error("当前项目来源与正在打开的项目不一致，已阻止继续。");
  }
}

async function countProjectEntries(
  directory: ProjectDirectoryHandle,
): Promise<{ files: number; directories: number }> {
  let files = 0;
  let directories = 0;

  for await (const name of directory.keys()) {
    try {
      const childDirectory = await directory.getDirectoryHandle(name);
      const childCounts = await countProjectEntries(childDirectory);

      directories += 1 + childCounts.directories;
      files += childCounts.files;
    } catch {
      files += 1;
    }
  }

  return { files, directories };
}

export async function scanProjectDeletion(
  root: ProjectDirectoryHandle,
  project: ProjectConfig,
  mode: ProjectDeletionMode = "local_record_only",
): Promise<ProjectDeletionScan> {
  await assertCurrentProjectSource(root, project);

  if (mode === "native_project_folder") {
    const counts = await countProjectEntries(root);
    const nativePath = root.nativePath;
    const canDelete =
      Boolean(nativePath) && isTauriRuntime() && root.storageKind !== "packed";

    return {
      canDelete,
      mode,
      fileCount: counts.files,
      directoryCount: counts.directories,
      rootName: root.name,
      deleteTarget: nativePath ? formatNativePathForDisplay(nativePath) : root.name,
      entries: canDelete
        ? [
            "删除本地项目文件夹及其中所有文件",
            "从最近项目移除",
            "清除当前项目会话",
            "返回项目启动页",
          ]
        : [
            "当前项目没有可删除的 Tauri native 路径",
            "Web/PWA 或 .hproj 项目请在系统文件管理器中手动删除",
          ],
      warnings: canDelete
        ? [
            "此操作会删除磁盘上的项目文件夹，Textile 无法恢复。请先导出 .hproj 备份。",
            "删除过程中如果系统拒绝访问，可能需要在文件管理器中手动检查残留。",
          ]
        : [
            "只有 Tauri 桌面版通过 native path 打开的本地项目文件夹支持此操作。",
          ],
    };
  }

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
      "此操作不会删除磁盘上的项目文件。如需彻底删除，请使用单独的“删除本地项目文件夹”危险操作。",
    ],
  };
}

export async function deleteCurrentProjectSource(
  root: ProjectDirectoryHandle,
  project: ProjectConfig,
  _actor: Member | null | undefined,
  mode: ProjectDeletionMode = "local_record_only",
): Promise<ProjectDeletionResult> {
  await assertCurrentProjectSource(root, project);

  if (mode === "native_project_folder") {
    if (!root.nativePath || !isTauriRuntime() || root.storageKind === "packed") {
      throw new Error("当前项目没有可删除的 Tauri native 项目文件夹。");
    }

    const result = await withAppOperation("删除项目文件夹", () =>
      invokeTauriCommand<NativeProjectDirectoryDeletionResult>(
        "delete_project_directory_path",
        {
          rootPath: root.nativePath,
          projectId: project.project_id,
        },
      ),
    );

    return {
      diskFilesDeleted: true,
      rootFolderDeleted: true,
      deletedEntries: [formatNativePathForDisplay(result.deletedPath)],
      failedEntries: [],
      message: `已删除本地项目文件夹，并清除当前项目会话。删除范围：${result.fileCount} 个文件、${result.directoryCount} 个目录。`,
    };
  }

  return {
    diskFilesDeleted: false,
    rootFolderDeleted: false,
    deletedEntries: [],
    failedEntries: [],
    message:
      "已从最近项目移除并清除当前项目会话。当前版本不会自动删除磁盘上的项目文件。",
  };
}
