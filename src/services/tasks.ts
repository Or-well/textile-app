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
import {
  compareInstants,
  isValidTimeZone,
  normalizeInstant,
  nowIso,
} from "../utils/time";
import { calculateEntryProgress, type ProgressWeights } from "./stats";
import {
  canAssignTask,
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
import type { ProjectDirectoryHandle } from "./projectFs";
import {
  createProjectStorage,
  type ProjectStorage,
} from "./projectStorage";

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
  file_id?: string;
  file_ids?: string[];
  range_start: number;
  range_end: number;
  entry_ids?: string[];
  assignee?: string;
  status?: TaskStatus;
  target?: string;
  proofread_round?: ProofreadRequired;
  submit_method?: TaskSubmitMethod;
  due_at?: string;
  due_time_zone?: string;
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
  "custom",
];
const SUBMIT_METHODS: readonly TaskSubmitMethod[] = [
  "change_package",
  "owner_manual",
];
const TASK_STATUS_TRANSITIONS: Record<string, Partial<Record<TaskStatus, readonly TaskStatus[]>>> = {
  assign: {
    unassigned: ["assigned"],
    assigned: ["assigned", "unassigned"],
    in_progress: ["assigned", "unassigned"],
    submitted: ["assigned", "unassigned"],
  },
  claim: {
    unassigned: ["in_progress"],
  },
  submit: {
    assigned: ["submitted"],
    in_progress: ["submitted"],
  },
  complete: {
    submitted: ["completed"],
  },
  reclaim: {
    assigned: ["unassigned"],
    in_progress: ["unassigned"],
    submitted: ["unassigned"],
  },
  reopen: {
    submitted: ["assigned", "in_progress", "unassigned"],
    completed: ["assigned", "in_progress", "unassigned"],
  },
  cancel_submit: {
    submitted: ["assigned", "in_progress"],
  },
};

let currentProjectStorage: ProjectStorage | null = null;
let cachedTasks: Task[] | null = null;

export function setTasksProjectRoot(root: ProjectDirectoryHandle): void {
  setTasksProjectStorage(createProjectStorage(root));
}

export function setTasksProjectStorage(storage: ProjectStorage): void {
  currentProjectStorage = storage;
  cachedTasks = null;
}

function getProjectStorage(): ProjectStorage {
  if (!currentProjectStorage) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectStorage;
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

async function loadProjectConfig(): Promise<ProjectConfig> {
  return getProjectStorage().readJson<ProjectConfig>("project.json");
}

async function assertTasksEnabled(): Promise<ProjectConfig> {
  const project = await loadProjectConfig();

  if (project.settings.workflow?.enable_tasks === false) {
    throw new Error("当前项目未启用任务，不能新增或更新任务。");
  }

  return project;
}

function assertTaskStatusTransition(
  action: keyof typeof TASK_STATUS_TRANSITIONS,
  from: TaskStatus,
  to: TaskStatus,
): void {
  if (from === to) {
    return;
  }

  const allowed = TASK_STATUS_TRANSITIONS[action]?.[from] ?? [];

  if (!allowed.includes(to)) {
    throw new Error(`任务状态不能从 ${from} 直接变为 ${to}。`);
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

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(value.map(String).map((item) => item.trim()).filter(Boolean)),
    );
  }

  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(/[\n,，\s]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
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
  const fileIds = normalizeStringList(row.file_ids);
  const fileId = row.file_id?.trim() ?? fileIds[0] ?? "";

  return {
    id: row.id?.trim() || createId("task"),
    title: row.title?.trim() || "未命名任务",
    description: row.description ?? "",
    type,
    file_id: fileId,
    file_ids: fileIds.length > 0 ? fileIds : undefined,
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
    due_time_zone: row.due_time_zone?.trim() || undefined,
  };
}

function normalizeTaskDuePatch<T extends Pick<TaskDraft, "due_at" | "due_time_zone">>(
  patch: T,
): T {
  if (patch.due_at === undefined && patch.due_time_zone === undefined) {
    return patch;
  }

  const dueAt = patch.due_at?.trim() ?? "";
  const dueTimeZone = patch.due_time_zone?.trim() ?? "";

  if (!dueAt) {
    return {
      ...patch,
      due_at: "",
      due_time_zone: undefined,
    };
  }

  const normalizedDueAt = normalizeInstant(dueAt);

  if (!normalizedDueAt) {
    throw new Error("任务截止时间必须包含明确时区并以 UTC ISO 格式保存。");
  }

  if (!isValidTimeZone(dueTimeZone)) {
    throw new Error("任务截止时间必须记录有效的 IANA 时区。");
  }

  return {
    ...patch,
    due_at: normalizedDueAt,
    due_time_zone: dueTimeZone,
  };
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const statusOrder =
      TASK_STATUSES.indexOf(a.status) - TASK_STATUSES.indexOf(b.status);

    if (statusOrder !== 0) {
      return statusOrder;
    }

    return (
      compareInstants(b.updated_at, a.updated_at) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id)
    );
  });
}

async function saveTasks(tasks: Task[]): Promise<Task[]> {
  const nextTasks = sortTasks(tasks.map(normalizeTask));

  const storage = getProjectStorage();

  await storage.ensureDirectory("tasks");
  await storage.writeJsonl(TASKS_PATH, nextTasks);
  cachedTasks = nextTasks;

  return nextTasks;
}

async function loadEntriesForFile(fileId: string): Promise<Entry[]> {
  const storage = getProjectStorage();
  const entryDirectory = `entries/${fileId}`;
  const fileNames = await storage.listFiles(entryDirectory);
  const chunkFiles = fileNames
    .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const chunks = await Promise.all(
    chunkFiles.map((fileName) =>
      storage.readJsonl<Entry>(`${entryDirectory}/${fileName}`),
    ),
  );

  return normalizeEntries(chunks.flat()).sort(
    (a, b) => a.index - b.index || a.id.localeCompare(b.id),
  );
}

async function loadAllEntries(): Promise<Entry[]> {
  const storage = getProjectStorage();
  let fileIds: string[];

  try {
    fileIds = await storage.listFiles("entries");
  } catch {
    return [];
  }

  const entryGroups = await Promise.all(
    fileIds.map(async (fileId) => {
      try {
        return await loadEntriesForFile(fileId);
      } catch {
        return [];
      }
    }),
  );

  return entryGroups.flat();
}

async function loadEntriesForTask(task: Task): Promise<Entry[]> {
  if (task.entry_ids.length > 0) {
    const ids = new Set(task.entry_ids);

    return (await loadAllEntries()).filter((entry) => ids.has(entry.id));
  }

  if (task.file_ids?.length) {
    const entryGroups = await Promise.all(
      task.file_ids.map((fileId) => loadEntriesForFile(fileId)),
    );

    return entryGroups.flat();
  }

  if (task.file_id) {
    return (await loadEntriesForFile(task.file_id)).filter((entry) =>
      isEntryInTask(entry, task),
    );
  }

  return [];
}

async function validateTaskScope(task: Task): Promise<void> {
  if (task.entry_ids.length > 0) {
    const entries = await loadAllEntries();
    const ids = new Set(entries.map((entry) => entry.id));
    const missingIds = task.entry_ids.filter((entryId) => !ids.has(entryId));

    if (missingIds.length > 0) {
      throw new Error(`Task entries do not exist: ${missingIds.join(", ")}`);
    }

    return;
  }

  if (task.file_ids?.length) {
    for (const fileId of task.file_ids) {
      await loadEntriesForFile(fileId);
    }

    return;
  }

  if (task.file_id) {
    const entries = await loadEntriesForFile(task.file_id);

    if (!entries.some((entry) => isEntryInTask(entry, task))) {
      throw new Error("Task range does not match any entries.");
    }

    return;
  }
}

export async function loadTasks(): Promise<Task[]> {
  if (cachedTasks) {
    return cachedTasks;
  }

  const storage = getProjectStorage();

  if (!(await storage.fileExists(TASKS_PATH))) {
    cachedTasks = [];
    return cachedTasks;
  }

  try {
    cachedTasks = sortTasks(
      (await storage.readJsonl<Partial<Task>>(TASKS_PATH)).map(
        normalizeTask,
      ),
    );
    return cachedTasks;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误。";

    throw new Error(
      `任务数据无法读取。为避免覆盖原任务，当前项目已停止任务写入。原因：${reason}`,
    );
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

export async function getTaskEntries(task: Task): Promise<Entry[]> {
  return loadEntriesForTask(task);
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

  if (task.file_ids?.length) {
    return task.file_ids.includes(entry.file_id);
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

  const project = await getProjectStorage().readJson<ProjectConfig>("project.json");
  const entries = await loadEntriesForTask(task);
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
  updater: (task: Task) => Task | Promise<Task>,
): Promise<Task> {
  const tasks = await loadTasks();
  const taskIndex = tasks.findIndex((task) => task.id === taskId);

  if (taskIndex < 0) {
    throw new Error("没有找到要更新的任务。请重新打开项目后再试。");
  }

  const updatedTask = normalizeTask(await updater(tasks[taskIndex]));
  await validateTaskScope(updatedTask);

  const nextTasks = [...tasks];
  nextTasks[taskIndex] = updatedTask;

  await saveTasks(nextTasks);

  return updatedTask;
}

export async function createTask(draft: TaskDraft, userId: string): Promise<Task> {
  const actor = getTaskActor();

  assertTaskWritePermission(canCreateTask(actor));
  await assertTasksEnabled();

  const now = nowIso();
  const task = normalizeTask({
    ...normalizeTaskDuePatch(draft),
    id: createId("task"),
    status: draft.status ?? (draft.assignee ? "assigned" : "unassigned"),
    created_by: actor.id || userId,
    created_at: now,
    updated_at: now,
  });
  await validateTaskScope(task);

  const tasks = await loadTasks();

  await saveTasks([...tasks, task]);

  return task;
}

export async function updateTask(
  taskId: string,
  patch: TaskPatch,
): Promise<Task> {
  assertTaskWritePermission(canUpdateTask(getTaskActor()));
  await assertTasksEnabled();

  return updateTaskById(taskId, (task) => {
    if (patch.status && patch.status !== task.status) {
      throw new Error("Task status must be changed through task workflow actions.");
    }

    return mergeTaskPatch(task, {
      ...normalizeTaskDuePatch(patch),
      status: task.status,
    });
  });
}

export async function deleteTask(taskId: string): Promise<void> {
  assertTaskWritePermission(canDeleteTask(getTaskActor()));
  await assertTasksEnabled();

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
  await assertTasksEnabled();

  return updateTaskById(taskId, (task) => {
    const status = assignee ? "assigned" : "unassigned";
    assertTaskStatusTransition("assign", task.status, status);

    return mergeTaskPatch(task, {
      assignee,
      status,
    });
  });
}

export async function claimTask(taskId: string, userId: string): Promise<Task> {
  const actor = getTaskActor();

  assertTaskWritePermission(canAssignTask(actor) || canManageTask(actor));
  await assertTasksEnabled();

  return updateTaskById(taskId, (task) =>
    {
      if (task.assignee) {
        throw new Error("Task already assigned.");
      }

      assertTaskStatusTransition("claim", task.status, "in_progress");

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
  await assertTasksEnabled();

  return updateTaskById(taskId, (task) =>
    {
      if (task.assignee !== actor.id && !canManageTask(actor)) {
        throw new Error("Only assignee can submit this task.");
      }

      assertTaskStatusTransition("submit", task.status, "submitted");

      return mergeTaskPatch(task, {
        status: "submitted",
      });
    },
  );
}

export async function cancelTaskSubmission(taskId: string): Promise<Task> {
  const actor = getTaskActor();

  assertTaskWritePermission(canSubmitTask(actor));
  await assertTasksEnabled();

  return updateTaskById(taskId, (task) =>
    {
      if (task.assignee !== actor.id && !canManageTask(actor)) {
        throw new Error("Only assignee can cancel this task submission.");
      }

      const status = task.assignee ? "in_progress" : "assigned";

      assertTaskStatusTransition("cancel_submit", task.status, status);

      return mergeTaskPatch(task, {
        status,
      });
    },
  );
}

export async function completeTask(taskId: string): Promise<Task> {
  assertTaskWritePermission(canCompleteTask(getTaskActor()));
  await assertTasksEnabled();

  return updateTaskById(taskId, (task) => {
    assertTaskStatusTransition("complete", task.status, "completed");

    return mergeTaskPatch(task, {
      status: "completed",
    });
  });
}

export async function reclaimTask(taskId: string): Promise<Task> {
  assertTaskWritePermission(canReclaimTask(getTaskActor()));
  await assertTasksEnabled();

  return updateTaskById(taskId, (task) => {
    assertTaskStatusTransition("reclaim", task.status, "unassigned");

    return mergeTaskPatch(task, {
      assignee: "",
      status: "unassigned",
    });
  });
}

export async function reopenTask(taskId: string): Promise<Task> {
  assertTaskWritePermission(canReopenTask(getTaskActor()));
  await assertTasksEnabled();

  return updateTaskById(taskId, (task) => {
    const status = task.assignee ? "in_progress" : "unassigned";
    assertTaskStatusTransition("reopen", task.status, status);

    return mergeTaskPatch(task, {
      status,
    });
  });
}
