import type { Entry, Task } from "../model/types";
import {
  listFiles,
  readJsonl,
  writeJsonl,
  type ProjectDirectoryHandle,
} from "./projectFs";

export interface TaskProgress {
  taskId: string;
  totalEntries: number;
  completedEntries: number;
  untranslatedEntries: number;
  translatedEntries: number;
  proofreadEntries: number;
  reviewedEntries: number;
  disputedEntries: number;
  progressPercent: number;
}

let currentProjectRoot: ProjectDirectoryHandle | null = null;
let cachedTasks: Task[] | null = null;

export function setTasksProjectRoot(root: ProjectDirectoryHandle): void {
  currentProjectRoot = root;
  cachedTasks = null;
}

function getProjectRoot(): ProjectDirectoryHandle {
  if (!currentProjectRoot) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectRoot;
}

async function loadEntriesForFile(fileId: string): Promise<Entry[]> {
  const root = getProjectRoot();
  const entryDirectory = `entries/${fileId}`;
  const fileNames = await listFiles(root, entryDirectory);
  const chunkFiles = fileNames
    .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const chunks = await Promise.all(
    chunkFiles.map((fileName) =>
      readJsonl<Entry>(root, `${entryDirectory}/${fileName}`),
    ),
  );

  return chunks.flat().sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
}

function countEntries(entries: Entry[], status: Entry["status"]): number {
  return entries.filter((entry) => entry.status === status).length;
}

export async function loadTasks(): Promise<Task[]> {
  if (cachedTasks) {
    return cachedTasks;
  }

  try {
    cachedTasks = await readJsonl<Task>(getProjectRoot(), "tasks/tasks.jsonl");
    return cachedTasks;
  } catch {
    throw new Error("任务列表无法读取。请确认项目里包含任务数据文件。");
  }
}

export async function getTasksByUser(userId: string): Promise<Task[]> {
  const tasks = await loadTasks();

  return tasks.filter((task) => task.assignee === userId);
}

export function isEntryInTask(entry: Entry, task: Task): boolean {
  if (task.entry_ids.length > 0) {
    return task.entry_ids.includes(entry.id);
  }

  return (
    entry.file_id === task.file_id &&
    entry.index >= task.range_start &&
    entry.index <= task.range_end
  );
}

export async function getTaskProgress(taskId: string): Promise<TaskProgress> {
  const tasks = await loadTasks();
  const task = tasks.find((row) => row.id === taskId);

  if (!task) {
    throw new Error("没有找到这个任务。请重新打开项目后再试。");
  }

  const entries = (await loadEntriesForFile(task.file_id)).filter((entry) =>
    isEntryInTask(entry, task),
  );
  const totalEntries = entries.length;
  const untranslatedEntries = countEntries(entries, "untranslated");
  const translatedEntries = countEntries(entries, "translated");
  const proofreadEntries = countEntries(entries, "proofread");
  const reviewedEntries = countEntries(entries, "reviewed");
  const disputedEntries = countEntries(entries, "disputed");
  const completedEntries = totalEntries - untranslatedEntries;
  const progressPercent =
    totalEntries === 0 ? 0 : Math.round((completedEntries / totalEntries) * 100);

  return {
    taskId,
    totalEntries,
    completedEntries,
    untranslatedEntries,
    translatedEntries,
    proofreadEntries,
    reviewedEntries,
    disputedEntries,
    progressPercent,
  };
}

export async function submitTask(taskId: string): Promise<Task> {
  const tasks = await loadTasks();
  const taskIndex = tasks.findIndex((task) => task.id === taskId);

  if (taskIndex < 0) {
    throw new Error("没有找到要提交的任务。请重新打开项目后再试。");
  }

  const submittedTask: Task = {
    ...tasks[taskIndex],
    status: "submitted",
  };

  const nextTasks = [...tasks];
  nextTasks[taskIndex] = submittedTask;

  await writeJsonl(getProjectRoot(), "tasks/tasks.jsonl", nextTasks);
  cachedTasks = nextTasks;

  return submittedTask;
}
