import type {
  ChangePackageManifest,
  Comment,
  Entry,
  ProjectEvent,
  Task,
} from "../model/types";
import { nowIso } from "../utils/time";
import { createZip } from "../utils/zip";
import { stringifyJsonl } from "../utils/jsonl";
import type { ZipContent } from "../utils/zip";
import {
  fileExists,
  listFiles,
  readJson,
  readJsonl,
  type ProjectDirectoryHandle,
} from "./projectFs";

export interface ExportedChangePackage {
  fileName: string;
  blob: Blob;
  manifest: ChangePackageManifest;
}

let currentProjectRoot: ProjectDirectoryHandle | null = null;

export function setChangesProjectRoot(root: ProjectDirectoryHandle): void {
  currentProjectRoot = root;
}

function getProjectRoot(): ProjectDirectoryHandle {
  if (!currentProjectRoot) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectRoot;
}

function isEntryInTask(entry: Entry, task: Task): boolean {
  if (task.entry_ids.length > 0) {
    return task.entry_ids.includes(entry.id);
  }

  return (
    entry.file_id === task.file_id &&
    entry.index >= task.range_start &&
    entry.index <= task.range_end
  );
}

function commentPathForEntry(entry: Entry): string {
  return `comments/${entry.file_id}/${String(entry.index).padStart(6, "0")}.jsonl`;
}

async function loadTask(root: ProjectDirectoryHandle, taskId: string): Promise<Task> {
  const tasks = await readJsonl<Task>(root, "tasks/tasks.jsonl");
  const task = tasks.find((row) => row.id === taskId);

  if (!task) {
    throw new Error("没有找到要导出的任务。请重新打开项目后再试。");
  }

  return task;
}

async function loadTaskEntries(
  root: ProjectDirectoryHandle,
  task: Task,
): Promise<Entry[]> {
  const entryDirectory = `entries/${task.file_id}`;
  const fileNames = await listFiles(root, entryDirectory);
  const chunkFiles = fileNames
    .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const groups = await Promise.all(
    chunkFiles.map(async (fileName) => {
      const path = `${entryDirectory}/${fileName}`;
      const entries = await readJsonl<Entry>(root, path);

      return {
        path,
        entries: entries.filter((entry) => isEntryInTask(entry, task)),
      };
    }),
  );

  return groups.flatMap((group) => group.entries);
}

async function collectChangedEntries(
  root: ProjectDirectoryHandle,
  task: Task,
  userId: string,
): Promise<Record<string, Entry[]>> {
  const entryDirectory = `entries/${task.file_id}`;
  const fileNames = await listFiles(root, entryDirectory);
  const chunkFiles = fileNames
    .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const changedEntries: Record<string, Entry[]> = {};

  for (const chunkFile of chunkFiles) {
    const path = `${entryDirectory}/${chunkFile}`;
    const entries = await readJsonl<Entry>(root, path);
    const rows = entries.filter(
      (entry) => isEntryInTask(entry, task) && entry.updated_by === userId,
    );

    if (rows.length > 0) {
      changedEntries[path] = rows;
    }
  }

  return changedEntries;
}

async function collectComments(
  root: ProjectDirectoryHandle,
  entries: Entry[],
  userId: string,
): Promise<Record<string, Comment[]>> {
  const comments: Record<string, Comment[]> = {};

  for (const entry of entries) {
    const path = commentPathForEntry(entry);

    if (!(await fileExists(root, path))) {
      continue;
    }

    const rows = (await readJsonl<Comment>(root, path)).filter(
      (comment) => comment.user_id === userId,
    );

    if (rows.length > 0) {
      comments[path] = rows;
    }
  }

  return comments;
}

async function collectEvents(
  root: ProjectDirectoryHandle,
  taskEntries: Entry[],
  userId: string,
): Promise<ProjectEvent[]> {
  if (!(await fileExists(root, "logs/events.jsonl"))) {
    return [];
  }

  const taskEntryIds = new Set(taskEntries.map((entry) => entry.id));

  return (await readJsonl<ProjectEvent>(root, "logs/events.jsonl")).filter(
    (event) =>
      event.user_id === userId &&
      (!event.entry_id || taskEntryIds.has(event.entry_id)),
  );
}

function buildFileName(userId: string, taskId: string, createdAt: string): string {
  const date = createdAt.slice(0, 10).replace(/-/g, "");

  return `changes-${userId}-${taskId}-${date}.zip`;
}

export async function exportChangePackage(
  userId: string,
  taskId: string,
): Promise<ExportedChangePackage> {
  const root = getProjectRoot();
  const project = await readJson<{ project_id: string }>(root, "project.json");
  const task = await loadTask(root, taskId);
  const taskEntries = await loadTaskEntries(root, task);
  const changedEntries = await collectChangedEntries(root, task, userId);
  const comments = await collectComments(root, taskEntries, userId);
  const events = await collectEvents(root, taskEntries, userId);
  const changedEntryCount = Object.values(changedEntries).reduce(
    (total, rows) => total + rows.length,
    0,
  );
  const newCommentCount = Object.values(comments).reduce(
    (total, rows) => total + rows.length,
    0,
  );
  const createdAt = nowIso();
  const manifest: ChangePackageManifest = {
    schema_version: 1,
    project_id: project.project_id,
    user_id: userId,
    user_name: userId,
    task_id: taskId,
    created_at: createdAt,
    changed_entries: changedEntryCount,
    new_comments: newCommentCount,
  };
  const files: ZipContent = {
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "entries/": null,
    "comments/": null,
    "logs/": null,
  };

  for (const [path, rows] of Object.entries(changedEntries)) {
    files[path] = stringifyJsonl(rows);
  }

  for (const [path, rows] of Object.entries(comments)) {
    files[path] = stringifyJsonl(rows);
  }

  if (events.length > 0) {
    files["logs/events.jsonl"] = stringifyJsonl(events);
  }

  return {
    fileName: buildFileName(userId, taskId, createdAt),
    blob: await createZip(files),
    manifest,
  };
}
