import { PERMISSION_ACTIONS, type PermissionAction } from "../model/permissions";
import type {
  Member,
  ProjectConfig,
  ProjectEvent,
  ProjectFile,
} from "../model/types";
import { createId } from "../utils/id";
import { normalizeFileGroupName } from "../utils/fileGroups";
import { nowIso } from "../utils/time";
import { clearCachedEntriesForFile } from "./entries";
import { assertCan, setPermissionProject } from "./permissions";
import type { ProjectDirectoryHandle } from "./projectFs";
import {
  createProjectStorage,
  type ProjectStorage,
} from "./projectStorage";
import { createProjectWritePlan } from "./projectWritePlan";

export type FileBatchOperation =
  | "hide"
  | "unhide"
  | "lock"
  | "unlock"
  | "move_folder"
  | "clear_folder"
  | "delete";

export interface FileBatchRequest {
  fileIds: string[];
  operation: FileBatchOperation;
  actor: Member | null | undefined;
  project: ProjectConfig;
  folder?: string;
}

export interface FileBatchSkippedItem {
  fileId: string;
  reason: string;
}

export interface FileBatchPreview {
  operation: FileBatchOperation;
  selectedCount: number;
  applicableFileIds: string[];
  skipped: FileBatchSkippedItem[];
  skippedReasonCounts: Array<{ reason: string; count: number }>;
  affectedEntryCount: number;
}

export interface FileBatchResult extends FileBatchPreview {
  project: ProjectConfig;
}

interface PreparedFileBatch {
  preview: FileBatchPreview;
  nextProject: ProjectConfig;
  applicableFiles: ProjectFile[];
  updatedFiles: Map<string, ProjectFile>;
  actor: Member;
  batchId: string;
  updatedAt: string;
}

const FILE_BATCH_OPERATIONS = new Set<FileBatchOperation>([
  "hide",
  "unhide",
  "lock",
  "unlock",
  "move_folder",
  "clear_folder",
  "delete",
]);

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

function countSkippedReasons(
  skipped: FileBatchSkippedItem[],
): FileBatchPreview["skippedReasonCounts"] {
  const counts = new Map<string, number>();

  for (const item of skipped) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }

  return Array.from(counts, ([reason, count]) => ({ reason, count })).sort(
    (left, right) => right.count - left.count,
  );
}

function resolveActor(actor: Member | null | undefined): Member {
  if (!actor?.id || !actor.active) {
    throw new Error("请先登录项目成员账号。");
  }

  return actor;
}

function getRequiredAction(operation: FileBatchOperation): PermissionAction {
  if (operation === "hide" || operation === "unhide") {
    return PERMISSION_ACTIONS.FILE_HIDE;
  }

  if (operation === "lock" || operation === "unlock") {
    return PERMISSION_ACTIONS.FILE_LOCK;
  }

  if (operation === "move_folder" || operation === "clear_folder") {
    return PERMISSION_ACTIONS.FILE_MANAGE_FOLDER;
  }

  return PERMISSION_ACTIONS.FILE_DELETE;
}

function getSkipReason(
  file: ProjectFile,
  operation: FileBatchOperation,
  folder: string,
): string {
  if (operation === "hide" && file.hidden) {
    return "文件已经隐藏";
  }

  if (operation === "unhide" && !file.hidden) {
    return "文件已经显示";
  }

  if (operation === "lock" && file.locked) {
    return "文件已经锁定";
  }

  if (operation === "unlock" && !file.locked) {
    return "文件已经解锁";
  }

  if (
    operation === "move_folder" &&
    normalizeFileGroupName(file.folder) === folder
  ) {
    return "文件已经在指定分组";
  }

  if (
    operation === "clear_folder" &&
    !normalizeFileGroupName(file.folder)
  ) {
    return "文件当前没有分组";
  }

  return "";
}

function updateFile(
  file: ProjectFile,
  operation: FileBatchOperation,
  folder: string,
  updatedAt: string,
): ProjectFile {
  return {
    ...file,
    hidden:
      operation === "hide"
        ? true
        : operation === "unhide"
          ? false
          : file.hidden,
    locked:
      operation === "lock"
        ? true
        : operation === "unlock"
          ? false
          : file.locked,
    folder:
      operation === "move_folder"
        ? folder
        : operation === "clear_folder"
          ? undefined
          : file.folder,
    updated_at: updatedAt,
  };
}

async function countEntriesPath(
  storage: ProjectStorage,
  entriesPath: string,
): Promise<number> {
  if (!(await storage.fileExists(entriesPath))) {
    return 0;
  }

  const fileNames = await storage.listFiles(entriesPath);
  const counts = await Promise.all(
    fileNames
      .filter((name) => name.endsWith(".jsonl"))
      .map(async (name) => {
        try {
          return (await storage.readJsonl<unknown>(`${entriesPath}/${name}`))
            .length;
        } catch {
          return 0;
        }
      }),
  );

  return counts.reduce((total, count) => total + count, 0);
}

async function prepareFileBatch(
  storage: ProjectStorage,
  request: FileBatchRequest,
): Promise<PreparedFileBatch> {
  if (!FILE_BATCH_OPERATIONS.has(request.operation)) {
    throw new Error("不支持的文件批量操作。");
  }

  const actor = resolveActor(request.actor);
  const storedProject = await storage.readJson<ProjectConfig>("project.json");

  if (storedProject.project_id !== request.project.project_id) {
    throw new Error("当前项目与批量操作目标不一致，请重新打开项目后再试。");
  }

  assertCan(actor, getRequiredAction(request.operation), storedProject);

  const fileIds = uniqueIds(request.fileIds);
  const filesById = new Map(storedProject.files.map((file) => [file.id, file]));
  const skipped: FileBatchSkippedItem[] = [];
  const applicableFiles: ProjectFile[] = [];
  const updatedFiles = new Map<string, ProjectFile>();
  const folder = request.folder?.trim() ?? "";
  const batchId = createId("file_batch");
  const updatedAt = nowIso();

  if (request.operation === "move_folder" && !folder) {
    throw new Error("请输入目标文件分组。");
  }

  for (const fileId of fileIds) {
    const file = filesById.get(fileId);

    if (!file) {
      skipped.push({ fileId, reason: "文件不存在或已被删除" });
      continue;
    }

    const skipReason = getSkipReason(file, request.operation, folder);

    if (skipReason) {
      skipped.push({ fileId, reason: skipReason });
      continue;
    }

    applicableFiles.push(file);

    if (request.operation !== "delete") {
      updatedFiles.set(
        file.id,
        updateFile(file, request.operation, folder, updatedAt),
      );
    }
  }

  const applicableIds = new Set(applicableFiles.map((file) => file.id));
  const nextProject: ProjectConfig = {
    ...storedProject,
    files:
      request.operation === "delete"
        ? storedProject.files.filter((file) => !applicableIds.has(file.id))
        : storedProject.files.map((file) => updatedFiles.get(file.id) ?? file),
  };
  const remainingEntryPaths = new Set(
    nextProject.files.map((file) => file.entries_path),
  );
  const affectedEntryPaths = Array.from(
    new Set(
      applicableFiles
        .map((file) => file.entries_path)
        .filter(
          (path) =>
            request.operation !== "delete" || !remainingEntryPaths.has(path),
        ),
    ),
  );
  const affectedEntryCount = (
    await Promise.all(
      affectedEntryPaths.map((path) => countEntriesPath(storage, path)),
    )
  ).reduce((total, count) => total + count, 0);
  const preview: FileBatchPreview = {
    operation: request.operation,
    selectedCount: fileIds.length,
    applicableFileIds: applicableFiles.map((file) => file.id),
    skipped,
    skippedReasonCounts: countSkippedReasons(skipped),
    affectedEntryCount,
  };

  return {
    preview,
    nextProject,
    applicableFiles,
    updatedFiles,
    actor,
    batchId,
    updatedAt,
  };
}

function createFileEvent(
  prepared: PreparedFileBatch,
  file: ProjectFile,
): ProjectEvent {
  const updatedFile = prepared.updatedFiles.get(file.id);
  const detail: Record<string, unknown> = {
    file_id: file.id,
    file_name: file.name,
    batch_id: prepared.batchId,
  };
  let type = "file.updated";

  if (prepared.preview.operation === "delete") {
    type = "file.deleted";
    detail.folder = file.folder ?? "";
    detail.source_path = file.source_path;
    detail.entries_path = file.entries_path;
  } else if (prepared.preview.operation === "hide") {
    type = "file.hidden";
    detail.before_hidden = file.hidden;
    detail.after_hidden = true;
  } else if (prepared.preview.operation === "unhide") {
    type = "file.unhidden";
    detail.before_hidden = file.hidden;
    detail.after_hidden = false;
  } else if (prepared.preview.operation === "lock") {
    type = "file.locked";
    detail.before_locked = file.locked;
    detail.after_locked = true;
  } else if (prepared.preview.operation === "unlock") {
    type = "file.unlocked";
    detail.before_locked = file.locked;
    detail.after_locked = false;
  } else {
    type = "file.folder_updated";
    detail.before_folder = file.folder ?? "";
    detail.after_folder = updatedFile?.folder ?? "";
  }

  return {
    id: createId("event"),
    type,
    user_id: prepared.actor.id,
    file_id: file.id,
    created_at: prepared.updatedAt,
    detail,
  };
}

async function executePreparedFileBatch(
  storage: ProjectStorage,
  prepared: PreparedFileBatch,
): Promise<void> {
  const writePlan = createProjectWritePlan(storage);

  if (prepared.preview.operation === "delete") {
    const remainingEntryPaths = new Set(
      prepared.nextProject.files.map((file) => file.entries_path),
    );
    const remainingSourcePaths = new Set(
      prepared.nextProject.files.map((file) => file.source_path),
    );
    const deletedEntryPaths = new Set<string>();
    const deletedSourcePaths = new Set<string>();

    for (const file of prepared.applicableFiles) {
      if (
        !remainingEntryPaths.has(file.entries_path) &&
        !deletedEntryPaths.has(file.entries_path) &&
        (await storage.fileExists(file.entries_path))
      ) {
        for (const name of await storage.listFiles(file.entries_path)) {
          writePlan.deleteFile(`${file.entries_path}/${name}`);
        }
        writePlan.deleteDirectory(file.entries_path);
        deletedEntryPaths.add(file.entries_path);
      }

      if (
        !remainingSourcePaths.has(file.source_path) &&
        !deletedSourcePaths.has(file.source_path) &&
        (await storage.fileExists(file.source_path))
      ) {
        writePlan.deleteFile(file.source_path);
        deletedSourcePaths.add(file.source_path);
      }
    }
  }

  const existingEvents = (await storage.fileExists("logs/events.jsonl"))
    ? await storage.readJsonl<ProjectEvent>("logs/events.jsonl")
    : [];
  const events = prepared.applicableFiles.map((file) =>
    createFileEvent(prepared, file),
  );

  writePlan.writeJson("project.json", prepared.nextProject);
  writePlan.writeJsonl("logs/events.jsonl", [...existingEvents, ...events]);
  await writePlan.execute();
}

export async function previewFileBatch(
  root: ProjectDirectoryHandle,
  request: FileBatchRequest,
): Promise<FileBatchPreview> {
  return previewFileBatchFromStorage(createProjectStorage(root), request);
}

export async function previewFileBatchFromStorage(
  storage: ProjectStorage,
  request: FileBatchRequest,
): Promise<FileBatchPreview> {
  return (await prepareFileBatch(storage, request)).preview;
}

export async function executeFileBatch(
  root: ProjectDirectoryHandle,
  request: FileBatchRequest,
): Promise<FileBatchResult> {
  return executeFileBatchFromStorage(createProjectStorage(root), request);
}

export async function executeFileBatchFromStorage(
  storage: ProjectStorage,
  request: FileBatchRequest,
): Promise<FileBatchResult> {
  const prepared = await prepareFileBatch(storage, request);

  if (prepared.preview.applicableFileIds.length > 0) {
    await executePreparedFileBatch(storage, prepared);
    for (const file of prepared.applicableFiles) {
      clearCachedEntriesForFile(file.id);
    }
    setPermissionProject(prepared.nextProject);
  }

  return {
    ...prepared.preview,
    project: prepared.nextProject,
  };
}
