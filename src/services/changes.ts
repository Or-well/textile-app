import type {
  ChangePackageManifest,
  Comment,
  Entry,
  ProjectEvent,
  Task,
} from "../model/types";
import { normalizeEntries, normalizeEntry } from "../model/status";
import { nowIso } from "../utils/time";
import { createId } from "../utils/id";
import { createZip, readZip } from "../utils/zip";
import { parseJsonl, stringifyJsonl } from "../utils/jsonl";
import type { ZipContent } from "../utils/zip";
import {
  ensureDirectory,
  fileExists,
  listFiles,
  readJson,
  readJsonl,
  writeJsonl,
  type ProjectDirectoryHandle,
} from "./projectFs";

export interface ExportedChangePackage {
  fileName: string;
  blob: Blob;
  manifest: ChangePackageManifest;
}

export interface ReadChangePackage {
  manifest: ChangePackageManifest;
  files: Record<string, string>;
  entries: Record<string, Entry[]>;
  comments: Record<string, Comment[]>;
  events: ProjectEvent[];
}

export interface ChangePackagePreview {
  manifest: ChangePackageManifest;
  changedEntries: number;
  commentCount: number;
  logCount: number;
  entryPaths: string[];
}

export interface ChangeConflict {
  entryId: string;
  path: string;
  mainEntry: Entry;
  packageEntry: Entry;
  reasons: ("target" | "status")[];
}

export type ConflictResolutionAction =
  | "keep_main"
  | "use_package"
  | "manual_merge"
  | "skip";

export interface ConflictResolution {
  entryId: string;
  action: ConflictResolutionAction;
  target?: string;
  status?: Entry["status"];
}

export interface ApplyChangePackageResult {
  appliedEntries: number;
  importedComments: number;
  importedEvents: number;
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
        entries: normalizeEntries(entries).filter((entry) => isEntryInTask(entry, task)),
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
    const entries = normalizeEntries(await readJsonl<Entry>(root, path));
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

function getDirectoryPath(path: string): string {
  const parts = path.split("/");

  parts.pop();

  return parts.join("/");
}

function parsePackageJsonl<T>(files: Record<string, string>, prefix: string): Record<string, T[]> {
  const rows: Record<string, T[]> = {};

  for (const [path, text] of Object.entries(files)) {
    if (path.startsWith(prefix) && path.endsWith(".jsonl")) {
      rows[path] = parseJsonl<T>(text);
    }
  }

  return rows;
}

function flattenEntries(entries: Record<string, Entry[]>): Entry[] {
  return Object.values(entries).flat();
}

function hasEntryConflict(mainEntry: Entry, packageEntry: Entry): ("target" | "status")[] {
  const reasons: ("target" | "status")[] = [];

  if (mainEntry.target !== packageEntry.target) {
    reasons.push("target");
  }

  if (mainEntry.status !== packageEntry.status) {
    reasons.push("status");
  }

  return reasons;
}

function findResolution(
  resolutions: ConflictResolution[],
  entryId: string,
): ConflictResolution | undefined {
  return resolutions.find((resolution) => resolution.entryId === entryId);
}

async function loadCurrentEntries(path: string): Promise<Entry[]> {
  return normalizeEntries(await readJsonl<Entry>(getProjectRoot(), path));
}

async function appendImportLog(
  manifest: ChangePackageManifest,
  result: ApplyChangePackageResult,
): Promise<void> {
  const root = getProjectRoot();
  const events = (await fileExists(root, "logs/events.jsonl"))
    ? await readJsonl<ProjectEvent>(root, "logs/events.jsonl")
    : [];
  const event: ProjectEvent = {
    id: createId("event"),
    type: "change_package.applied",
    user_id: manifest.user_id,
    task_id: manifest.task_id,
    created_at: nowIso(),
    detail: {
      applied_entries: result.appliedEntries,
      imported_comments: result.importedComments,
      imported_events: result.importedEvents,
    },
  };

  await ensureDirectory(root, "logs");
  await writeJsonl(root, "logs/events.jsonl", [...events, event]);
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

export async function readChangePackage(file: Blob): Promise<ReadChangePackage> {
  try {
    const files = await readZip(file);
    const manifestText = files["manifest.json"];

    if (!manifestText) {
      throw new Error("修改包缺少 manifest.json。");
    }

    const manifest = JSON.parse(manifestText) as ChangePackageManifest;
    const entries = Object.fromEntries(
      Object.entries(parsePackageJsonl<Entry>(files, "entries/")).map(
        ([path, rows]) => [path, normalizeEntries(rows)],
      ),
    );
    const comments = parsePackageJsonl<Comment>(files, "comments/");
    const events = files["logs/events.jsonl"]
      ? parseJsonl<ProjectEvent>(files["logs/events.jsonl"])
      : [];

    return {
      manifest,
      files,
      entries,
      comments,
      events,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`修改包无法读取：${error.message}`);
    }

    throw new Error("修改包无法读取。请确认选择的是正确的修改包文件。");
  }
}

export async function validateChangePackage(
  changePackage: ReadChangePackage,
): Promise<void> {
  const project = await readJson<{ project_id: string }>(
    getProjectRoot(),
    "project.json",
  );

  if (changePackage.manifest.project_id !== project.project_id) {
    throw new Error("修改包不属于当前项目，无法导入。");
  }
}

export function previewChangePackage(
  changePackage: ReadChangePackage,
): ChangePackagePreview {
  return {
    manifest: changePackage.manifest,
    changedEntries: flattenEntries(changePackage.entries).length,
    commentCount: Object.values(changePackage.comments).reduce(
      (total, rows) => total + rows.length,
      0,
    ),
    logCount: changePackage.events.length,
    entryPaths: Object.keys(changePackage.entries),
  };
}

export async function detectConflicts(
  changePackage: ReadChangePackage,
): Promise<ChangeConflict[]> {
  const conflicts: ChangeConflict[] = [];

  for (const [path, packageEntries] of Object.entries(changePackage.entries)) {
    const currentEntries = await loadCurrentEntries(path);

    for (const packageEntry of packageEntries) {
      const mainEntry = currentEntries.find((entry) => entry.id === packageEntry.id);

      if (!mainEntry) {
        continue;
      }

      const reasons = hasEntryConflict(mainEntry, packageEntry);

      if (reasons.length > 0) {
        conflicts.push({
          entryId: packageEntry.id,
          path,
          mainEntry,
          packageEntry,
          reasons,
        });
      }
    }
  }

  return conflicts;
}

export async function applyChangePackage(
  changePackage: ReadChangePackage,
  resolutions: ConflictResolution[] = [],
): Promise<ApplyChangePackageResult> {
  await validateChangePackage(changePackage);

  const root = getProjectRoot();
  const conflicts = await detectConflicts(changePackage);
  const unresolvedConflicts = conflicts.filter(
    (conflict) => !findResolution(resolutions, conflict.entryId),
  );

  if (unresolvedConflicts.length > 0) {
    throw new Error("仍有冲突未处理，不能应用修改包。");
  }

  let appliedEntries = 0;
  let importedComments = 0;
  let importedEvents = 0;

  for (const [path, packageEntries] of Object.entries(changePackage.entries)) {
    const currentEntries = await loadCurrentEntries(path);
    let changed = false;

    for (const packageEntry of packageEntries) {
      const entryIndex = currentEntries.findIndex(
        (entry) => entry.id === packageEntry.id,
      );

      if (entryIndex < 0) {
        continue;
      }

      const conflict = conflicts.find(
        (item) => item.entryId === packageEntry.id,
      );
      const resolution = conflict
        ? findResolution(resolutions, packageEntry.id)
        : undefined;

      if (resolution?.action === "keep_main" || resolution?.action === "skip") {
        continue;
      }

      if (resolution?.action === "manual_merge") {
        currentEntries[entryIndex] = {
          ...currentEntries[entryIndex],
          target: resolution.target ?? currentEntries[entryIndex].target,
          status: resolution.status ?? currentEntries[entryIndex].status,
          updated_at: nowIso(),
          updated_by: changePackage.manifest.user_id,
        };
      } else {
        currentEntries[entryIndex] = normalizeEntry(packageEntry);
      }

      changed = true;
      appliedEntries += 1;
    }

    if (changed) {
      await writeJsonl(root, path, currentEntries);
    }
  }

  for (const [path, packageComments] of Object.entries(changePackage.comments)) {
    const existingComments = (await fileExists(root, path))
      ? await readJsonl<Comment>(root, path)
      : [];
    const existingIds = new Set(existingComments.map((comment) => comment.id));
    const newComments = packageComments.filter(
      (comment) => !existingIds.has(comment.id),
    );

    if (newComments.length > 0) {
      await ensureDirectory(root, getDirectoryPath(path));
      await writeJsonl(root, path, [...existingComments, ...newComments]);
      importedComments += newComments.length;
    }
  }

  if (changePackage.events.length > 0) {
    const existingEvents = (await fileExists(root, "logs/events.jsonl"))
      ? await readJsonl<ProjectEvent>(root, "logs/events.jsonl")
      : [];
    const existingIds = new Set(existingEvents.map((event) => event.id));
    const newEvents = changePackage.events.filter(
      (event) => !existingIds.has(event.id),
    );

    if (newEvents.length > 0) {
      await ensureDirectory(root, "logs");
      await writeJsonl(root, "logs/events.jsonl", [
        ...existingEvents,
        ...newEvents,
      ]);
      importedEvents += newEvents.length;
    }
  }

  const result: ApplyChangePackageResult = {
    appliedEntries,
    importedComments,
    importedEvents,
  };

  await appendImportLog(changePackage.manifest, result);

  return result;
}
