import type {
  Entry,
  ProjectConfig,
  ProofreadRequired,
  Task,
  TaskStatus,
  TaskSubmitMethod,
  TaskType,
} from "../model/types";
import { normalizeEntries } from "../model/status";
import { createId } from "../utils/id";
import { nowIso } from "../utils/time";
import { calculateEntryProgress, type ProgressWeights } from "./stats";
import {
  canAssignTask,
  canClaimTask,
  canCompleteTask,
  canCreateTask,
  canDeleteTask,
  canManageTask,
  canReclaimTask,
  canReopenTask,
  canSubmitTask,
  canUpdateTask,
  getCurrentUser,
} from "./permissions";
import {
  ensureDirectory,
  listFiles,
  readJson,
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
  translationProgress: number;
  proofreadProgress: number;
  reviewProgress: number;
  progressPercent: number;
  progressWeights: ProgressWeights;
  proofreadRequired: number;
  reviewRequired: boolean;
}

export interface TaskFileEntryBounds {
  fileId: string;
  totalEntries: number;
  firstIndex: number;
  lastIndex: number;
}

export interface TaskDraft {
  title: string;
  description?: string;
  type: TaskType;
  file_id: string;
  range_start: number;
  range_end: number;
  entry_ids?: string[];
  assignee?: string;
  status?: TaskStatus;
  target?: string;
  proofread_round?: ProofreadRequired;
  submit_method?: TaskSubmitMethod;
  due_at?: string;
}

export type TaskPatch = Partial<TaskDraft>;

const TASKS_PATH = "tasks/tasks.jsonl";
const TASK_STATUSES: readonly TaskStatus[] = [
  "unassigned",
  "assigned",
  "in_progress",
  "submitted",
  "completed",
];
const TASK_TYPES: readonly TaskType[] = [
  "translate",
  "proofread",
  "review",
  "term",
  "export",
  "custom",
];
const SUBMIT_METHODS: readonly TaskSubmitMethod[] = [
  "change_package",
  "owner_manual",
];

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

function getTaskActor(): NonNullable<ReturnType<typeof getCurrentUser>> {
  const user = getCurrentUser();

  if (!user?.id) {
    throw new Error("Login required.");
  }

  return user;
}

function assertTaskWritePermission(canWrite: boolean): void {
  if (!canWrite) {
    throw new Error("Permission denied.");
  }
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

function normalizeTaskStatus(
  status: unknown,
  assignee: string,
): TaskStatus {
  if (isTaskStatus(status)) {
    return status;
  }

  if (status === "reclaimed") {
    return "unassigned";
  }

  if (status === "blocked") {
    return assignee ? "in_progress" : "unassigned";
  }

  return assignee ? "assigned" : "unassigned";
}

function isTaskType(value: unknown): value is TaskType {
  return TASK_TYPES.includes(value as TaskType);
}

function isSubmitMethod(value: unknown): value is TaskSubmitMethod {
  return SUBMIT_METHODS.includes(value as TaskSubmitMethod);
}

function normalizeSubmitMethod(value: unknown): TaskSubmitMethod {
  if (value === "git_manual") {
    return "owner_manual";
  }

  if (value === "git_hidden") {
    return "change_package";
  }

  return isSubmitMethod(value) ? value : "change_package";
}

function normalizeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function normalizeEntryIds(entryIds: unknown): string[] {
  if (Array.isArray(entryIds)) {
    return entryIds.map(String).map((id) => id.trim()).filter(Boolean);
  }

  if (typeof entryIds === "string") {
    return entryIds
      .split(/[\n,，\s]+/)
      .map((id) => id.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeProofreadRound(value: unknown): ProofreadRequired | undefined {
  const parsed = Number(value);

  if (parsed === 1 || parsed === 2 || parsed === 3) {
    return parsed;
  }

  return undefined;
}

function normalizeTask(row: Partial<Task>): Task {
  const now = nowIso();
  const rangeStart = normalizeNumber(row.range_start, 1) || 1;
  const rangeEnd = Math.max(rangeStart, normalizeNumber(row.range_end, rangeStart));
  const assignee = row.assignee?.trim() ?? "";
  const status = normalizeTaskStatus(row.status, assignee);
  const type = isTaskType(row.type) ? row.type : "custom";

  return {
    id: row.id?.trim() || createId("task"),
    title: row.title?.trim() || "未命名任务",
    description: row.description ?? "",
    type,
    file_id: row.file_id?.trim() ?? "",
    range_start: rangeStart,
    range_end: rangeEnd,
    entry_ids: normalizeEntryIds(row.entry_ids),
    assignee,
    status,
    target: row.target ?? "",
    submit_method: normalizeSubmitMethod(row.submit_method),
    proofread_round:
      type === "proofread" ? normalizeProofreadRound(row.proofread_round) : undefined,
    created_by: row.created_by?.trim() ?? "",
    created_at: row.created_at || now,
    updated_at: row.updated_at || row.created_at || now,
    due_at: row.due_at ?? "",
  };
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const statusOrder =
      TASK_STATUSES.indexOf(a.status) - TASK_STATUSES.indexOf(b.status);

    if (statusOrder !== 0) {
      return statusOrder;
    }

    return b.updated_at.localeCompare(a.updated_at) || a.title.localeCompare(b.title);
  });
}

async function saveTasks(tasks: Task[]): Promise<Task[]> {
  const nextTasks = sortTasks(tasks.map(normalizeTask));

  await ensureDirectory(getProjectRoot(), "tasks");
  await writeJsonl(getProjectRoot(), TASKS_PATH, nextTasks);
  cachedTasks = nextTasks;

  return nextTasks;
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

  return normalizeEntries(chunks.flat()).sort(
    (a, b) => a.index - b.index || a.id.localeCompare(b.id),
  );
}

export async function loadTasks(): Promise<Task[]> {
  if (cachedTasks) {
    return cachedTasks;
  }

  try {
    cachedTasks = sortTasks(
      (await readJsonl<Partial<Task>>(getProjectRoot(), TASKS_PATH)).map(
        normalizeTask,
      ),
    );
    return cachedTasks;
  } catch {
    cachedTasks = [];
    return cachedTasks;
  }
}

export async function getTaskById(taskId: string): Promise<Task | undefined> {
  const tasks = await loadTasks();

  return tasks.find((task) => task.id === taskId);
}

export async function getTasksByUser(userId: string): Promise<Task[]> {
  const tasks = await loadTasks();

  return tasks.filter((task) => task.assignee === userId);
}

export async function getTaskFileEntryBounds(
  fileId: string,
): Promise<TaskFileEntryBounds> {
  if (!fileId) {
    return {
      fileId,
      totalEntries: 0,
      firstIndex: 0,
      lastIndex: 0,
    };
  }

  const entries = await loadEntriesForFile(fileId);
  const indexes = entries.map((entry) => entry.index);

  return {
    fileId,
    totalEntries: entries.length,
    firstIndex: indexes.length > 0 ? Math.min(...indexes) : 0,
    lastIndex: indexes.length > 0 ? Math.max(...indexes) : 0,
  };
}

export function isEntryInTask(entry: Entry, task: Task): boolean {
  if (task.entry_ids.length > 0) {
    return task.entry_ids.includes(entry.id);
  }

  return (
    Boolean(task.file_id) &&
    entry.file_id === task.file_id &&
    entry.index >= task.range_start &&
    entry.index <= task.range_end
  );
}

function getTaskWorkflow(
  project: ProjectConfig,
  task: Task,
): ProjectConfig["settings"]["workflow"] {
  if (task.type !== "proofread" || !task.proofread_round) {
    return project.settings.workflow;
  }

  return {
    ...project.settings.workflow,
    proofread_required: task.proofread_round,
  };
}

export async function getTaskProgress(taskId: string): Promise<TaskProgress> {
  const task = await getTaskById(taskId);

  if (!task) {
    throw new Error("没有找到这个任务。请重新打开项目后再试。");
  }

  const project = await readJson<ProjectConfig>(getProjectRoot(), "project.json");
  const entries = task.file_id
    ? (await loadEntriesForFile(task.file_id)).filter((entry) =>
        isEntryInTask(entry, task),
      )
    : [];
  const progress = calculateEntryProgress(
    entries,
    project.settings?.progress_weights,
    getTaskWorkflow(project, task),
  );

  return {
    taskId,
    ...progress,
  };
}

function mergeTaskPatch(task: Task, patch: TaskPatch): Task {
  return normalizeTask({
    ...task,
    ...patch,
    updated_at: nowIso(),
  });
}

async function updateTaskById(
  taskId: string,
  updater: (task: Task) => Task,
): Promise<Task> {
  const tasks = await loadTasks();
  const taskIndex = tasks.findIndex((task) => task.id === taskId);

  if (taskIndex < 0) {
    throw new Error("没有找到要更新的任务。请重新打开项目后再试。");
  }

  const updatedTask = normalizeTask(updater(tasks[taskIndex]));
  const nextTasks = [...tasks];
  nextTasks[taskIndex] = updatedTask;

  await saveTasks(nextTasks);

  return updatedTask;
}

export async function createTask(draft: TaskDraft, userId: string): Promise<Task> {
  const actor = getTaskActor();

  assertTaskWritePermission(canCreateTask(actor));

  const now = nowIso();
  const task = normalizeTask({
    ...draft,
    id: createId("task"),
    status: draft.status ?? (draft.assignee ? "assigned" : "unassigned"),
    created_by: actor.id || userId,
    created_at: now,
    updated_at: now,
  });
  const tasks = await loadTasks();

  await saveTasks([...tasks, task]);

  return task;
}

export async function updateTask(
  taskId: string,
  patch: TaskPatch,
): Promise<Task> {
  assertTaskWritePermission(canUpdateTask(getTaskActor()));

  return updateTaskById(taskId, (task) => mergeTaskPatch(task, patch));
}

export async function deleteTask(taskId: string): Promise<void> {
  assertTaskWritePermission(canDeleteTask(getTaskActor()));

  const tasks = await loadTasks();
  const nextTasks = tasks.filter((task) => task.id !== taskId);

  if (nextTasks.length === tasks.length) {
    throw new Error("没有找到要删除的任务。请重新打开项目后再试。");
  }

  await saveTasks(nextTasks);
}

export async function assignTask(
  taskId: string,
  assignee: string,
): Promise<Task> {
  assertTaskWritePermission(canAssignTask(getTaskActor()));

  return updateTaskById(taskId, (task) =>
    mergeTaskPatch(task, {
      assignee,
      status: assignee ? "assigned" : "unassigned",
    }),
  );
}

export async function claimTask(taskId: string, userId: string): Promise<Task> {
  const actor = getTaskActor();

  assertTaskWritePermission(canClaimTask(actor));

  return updateTaskById(taskId, (task) =>
    {
      if (task.assignee) {
        throw new Error("Task already assigned.");
      }

      return mergeTaskPatch(task, {
        assignee: actor.id || userId,
        status: "in_progress",
      });
    },
  );
}

export async function submitTask(taskId: string): Promise<Task> {
  const actor = getTaskActor();

  assertTaskWritePermission(canSubmitTask(actor));

  return updateTaskById(taskId, (task) =>
    {
      if (task.assignee !== actor.id && !canManageTask(actor)) {
        throw new Error("Only assignee can submit this task.");
      }

      return mergeTaskPatch(task, {
        status: "submitted",
      });
    },
  );
}

export async function completeTask(taskId: string): Promise<Task> {
  assertTaskWritePermission(canCompleteTask(getTaskActor()));

  return updateTaskById(taskId, (task) =>
    mergeTaskPatch(task, {
      status: "completed",
    }),
  );
}

export async function reclaimTask(taskId: string): Promise<Task> {
  assertTaskWritePermission(canReclaimTask(getTaskActor()));

  return updateTaskById(taskId, (task) =>
    mergeTaskPatch(task, {
      assignee: "",
      status: "unassigned",
    }),
  );
}

export async function reopenTask(taskId: string): Promise<Task> {
  assertTaskWritePermission(canReopenTask(getTaskActor()));

  return updateTaskById(taskId, (task) =>
    mergeTaskPatch(task, {
      status: task.assignee ? "in_progress" : "unassigned",
    }),
  );
}
