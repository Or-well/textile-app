import type {
  Comment,
  Entry,
  Member,
  ProjectConfig,
  ProjectEvent,
  Task,
} from "../model/types";
import {
  applyEntryWorkflowOperation,
  type EntryWorkflowOperation,
  getEntryProofreadCount,
  hasWorkflowTarget,
  normalizeEntry,
} from "../model/status";
import { createId } from "../utils/id";
import { nowIso } from "../utils/time";
import {
  cacheEntriesForFile,
  loadAllEntries,
  prepareEntriesWrite,
} from "./entries";
import {
  createEntryVersionEvent,
  deriveEntryWorkflowAudit,
} from "./history";
import {
  canCreateComment,
  canManageTask,
  canMarkDisputed,
  canResolveDispute,
  canRollbackEntry,
  canTranslateEntry,
  getProofreadBlockMessage,
  getProofreadBlockReason,
  getReviewBlockMessage,
  getReviewBlockReason,
} from "./permissions";
import type { ProjectDirectoryHandle } from "./projectFs";
import {
  createProjectStorage,
  type ProjectStorage,
} from "./projectStorage";
import { createProjectWritePlan } from "./projectWritePlan";
import { isEntryInTask, loadTasks } from "./tasks";

export type EntryBatchOperation =
  | "set_reviewed"
  | "set_proofread"
  | "set_translated"
  | "set_disputed"
  | "clear_disputed";

type EntryBatchWorkflowOperation = EntryWorkflowOperation;

const ENTRY_BATCH_OPERATIONS = new Set<string>([
  "set_reviewed",
  "set_proofread",
  "set_translated",
  "set_disputed",
  "clear_disputed",
]);

export interface EntryBatchRequest {
  entryIds: string[];
  operation: EntryBatchOperation;
  actor: Member | null | undefined;
  project: ProjectConfig;
  note?: string;
}

export interface EntryBatchSkippedItem {
  entryId: string;
  reason: string;
}

export interface EntryBatchPreview {
  operation: EntryBatchOperation;
  selectedCount: number;
  applicableEntryIds: string[];
  skipped: EntryBatchSkippedItem[];
  skippedReasonCounts: Array<{
    reason: string;
    count: number;
  }>;
}

export interface EntryBatchResult extends EntryBatchPreview {
  batchId: string;
  updatedEntries: Entry[];
}

interface PreparedBatch {
  preview: EntryBatchPreview;
  project: ProjectConfig;
  allEntries: Entry[];
  updatedEntries: Entry[];
  versionEvents: ProjectEvent[];
  otherEvents: ProjectEvent[];
  commentsByPath: Map<string, Comment[]>;
  batchId: string;
}

let currentProjectStorage: ProjectStorage | null = null;

export function setEntryBatchProjectRoot(root: ProjectDirectoryHandle): void {
  setEntryBatchProjectStorage(createProjectStorage(root));
}

export function setEntryBatchProjectStorage(storage: ProjectStorage): void {
  currentProjectStorage = storage;
}

function getProjectStorage(): ProjectStorage {
  if (!currentProjectStorage) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectStorage;
}

function resolveActor(actor: Member | null | undefined): Member {
  if (!actor?.id || !actor.active) {
    throw new Error("请先登录项目成员账号。");
  }

  return actor;
}

function assertEntryBatchOperation(operation: string): asserts operation is EntryBatchOperation {
  if (!ENTRY_BATCH_OPERATIONS.has(operation)) {
    throw new Error("不支持的批量操作。");
  }
}

function uniqueEntryIds(entryIds: string[]): string[] {
  return Array.from(
    new Set(entryIds.map((entryId) => entryId.trim()).filter(Boolean)),
  );
}

function getCommentPath(entry: Entry): string {
  return `comments/${entry.file_id}/${String(entry.index).padStart(6, "0")}.jsonl`;
}

function countSkippedReasons(
  skipped: EntryBatchSkippedItem[],
): EntryBatchPreview["skippedReasonCounts"] {
  const counts = new Map<string, number>();

  for (const item of skipped) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }

  return Array.from(counts, ([reason, count]) => ({ reason, count })).sort(
    (left, right) => right.count - left.count || left.reason.localeCompare(right.reason),
  );
}

function getTaskScopeBlockReason(
  entry: Entry,
  actor: Member,
  project: ProjectConfig,
  tasks: Task[],
): string {
  if (
    project.settings.workflow?.enable_tasks === false ||
    canManageTask(actor)
  ) {
    return "";
  }

  const isInEditableOwnTask = tasks.some(
    (task) =>
      task.assignee === actor.id &&
      (task.status === "assigned" || task.status === "in_progress") &&
      isEntryInTask(entry, task),
  );

  return isInEditableOwnTask
    ? ""
    : "不在当前成员可编辑的已分配任务范围内";
}

function resolveWorkflowOperation(
  operation: EntryBatchOperation,
  entry: Entry,
): EntryBatchWorkflowOperation | null {
  if (operation === "set_reviewed") {
    return "review";
  }

  if (operation === "set_proofread") {
    return entry.status === "reviewed" ? "rollback_to_proofread" : "proofread";
  }

  if (operation === "set_translated") {
    if (entry.status === "untranslated") {
      return "translation_edit";
    }

    if (entry.status === "translated" && getEntryProofreadCount(entry) === 0) {
      return null;
    }

    return "rollback_to_translated";
  }

  return null;
}

function getOperationBlockReason(
  operation: EntryBatchOperation,
  workflowOperation: EntryBatchWorkflowOperation | null,
  entry: Entry,
  actor: Member,
  project: ProjectConfig,
  note: string,
): string {
  const file = project.files.find((item) => item.id === entry.file_id);

  if (file?.locked || entry.locked) {
    return "词条或所属文件已锁定";
  }

  if (file?.hidden || entry.hidden) {
    return "词条或所属文件已隐藏";
  }

  if (
    note &&
    (operation === "set_disputed" || operation === "clear_disputed") &&
    !canCreateComment(actor)
  ) {
    return "当前成员没有发表批注的权限";
  }

  if (workflowOperation === "proofread") {
    const reason = getProofreadBlockReason(
      actor,
      entry,
      project.settings.workflow,
    );

    return reason
      ? getProofreadBlockMessage(reason) || "当前词条不能校对"
      : "";
  }

  if (workflowOperation === "review") {
    const reason = getReviewBlockReason(
      actor,
      entry,
      project.settings.workflow,
    );

    return reason
      ? getReviewBlockMessage(reason) || "当前词条不能审核"
      : "";
  }

  if (operation === "set_translated") {
    if (!hasWorkflowTarget(entry)) {
      return "词条没有译文，不能设为已翻译";
    }

    if (!workflowOperation) {
      return "词条已经是已翻译";
    }

    if (workflowOperation === "translation_edit") {
      return canTranslateEntry(actor, entry)
        ? ""
        : "当前成员没有设置该词条为已翻译的权限";
    }
  }

  if (workflowOperation === "rollback_to_translated") {
    if (
      entry.status !== "proofread" &&
      entry.status !== "reviewed" &&
      getEntryProofreadCount(entry) === 0
    ) {
      return entry.status === "translated"
        ? "词条已经是已翻译"
        : "词条尚未翻译";
    }

    return canRollbackEntry(actor, entry)
      ? ""
      : "当前成员没有设置该词条为已翻译的权限";
  }

  if (workflowOperation === "rollback_to_proofread") {
    if (entry.status !== "reviewed") {
      return "词条尚未进入已审核阶段";
    }

    return canRollbackEntry(actor, entry)
      ? ""
      : "当前成员没有设置该词条为已校对的权限";
  }

  if (operation === "set_disputed") {
    return canMarkDisputed(actor, entry)
      ? ""
      : entry.disputed
        ? "词条已经是有争议"
        : "当前成员没有设置有争议的权限";
  }

  return canResolveDispute(actor, entry)
    ? ""
    : !entry.disputed
      ? "词条当前没有争议"
      : "当前成员没有设置无争议的权限";
}

function applyOperation(
  operation: EntryBatchOperation,
  workflowOperation: EntryBatchWorkflowOperation | null,
  entry: Entry,
  actor: Member,
  project: ProjectConfig,
  updatedAt: string,
  note: string,
): Entry {
  if (workflowOperation) {
    return applyEntryWorkflowOperation(entry, {
      userId: actor.id,
      target: entry.target,
      operation: workflowOperation,
      workflow: project.settings.workflow,
      updatedAt,
    });
  }

  if (operation === "set_disputed") {
    return normalizeEntry({
      ...entry,
      disputed: true,
      dispute_reason: note || entry.dispute_reason,
      dispute_resolved_at: "",
      dispute_resolved_by: "",
      updated_at: updatedAt,
      updated_by: actor.id,
    });
  }

  return normalizeEntry({
    ...entry,
    disputed: false,
    dispute_resolved_at: updatedAt,
    dispute_resolved_by: actor.id,
    updated_at: updatedAt,
    updated_by: actor.id,
  });
}

async function loadEvents(storage: ProjectStorage): Promise<ProjectEvent[]> {
  return (await storage.fileExists("logs/events.jsonl"))
    ? storage.readJsonl<ProjectEvent>("logs/events.jsonl")
    : [];
}

async function appendBatchComment(
  storage: ProjectStorage,
  entry: Entry,
  actor: Member,
  note: string,
  disputed: boolean,
  updatedAt: string,
  commentsByPath: Map<string, Comment[]>,
  otherEvents: ProjectEvent[],
  batchId: string,
): Promise<void> {
  if (!note) {
    return;
  }

  const path = getCommentPath(entry);
  let comments = commentsByPath.get(path);

  if (!comments) {
    comments = (await storage.fileExists(path))
      ? await storage.readJsonl<Comment>(path)
      : [];
  }

  const comment: Comment = {
    id: createId("comment"),
    entry_id: entry.id,
    file_id: entry.file_id,
    user_id: actor.id,
    body: note,
    reply_to: null,
    status: "open",
    disputed: disputed || undefined,
    resolved: false,
    created_at: updatedAt,
    updated_at: updatedAt,
  };

  commentsByPath.set(path, [...comments, comment]);
  otherEvents.push({
    id: createId("event"),
    type: "comment.added",
    user_id: actor.id,
    entry_id: entry.id,
    file_id: entry.file_id,
    created_at: updatedAt,
    detail: {
      comment_id: comment.id,
      reply_to: null,
      batch_id: batchId,
    },
  });
}

async function prepareBatch(request: EntryBatchRequest): Promise<PreparedBatch> {
  const storage = getProjectStorage();
  const actor = resolveActor(request.actor);
  assertEntryBatchOperation(request.operation);
  const entryIds = uniqueEntryIds(request.entryIds);
  const note = request.note?.trim() ?? "";
  const storedProject = await storage.readJson<ProjectConfig>("project.json");

  if (storedProject.project_id !== request.project.project_id) {
    throw new Error("当前项目与批量操作目标不一致，请重新打开项目后再试。");
  }

  const [allEntries, tasks, existingEvents] = await Promise.all([
    loadAllEntries(),
    storedProject.settings.workflow?.enable_tasks === false
      ? Promise.resolve([])
      : loadTasks(),
    loadEvents(storage),
  ]);
  const entriesById = new Map(allEntries.map((entry) => [entry.id, entry]));
  const skipped: EntryBatchSkippedItem[] = [];
  const updatedEntries: Entry[] = [];
  const versionEvents: ProjectEvent[] = [];
  const otherEvents: ProjectEvent[] = [];
  const commentsByPath = new Map<string, Comment[]>();
  const batchId = createId("entry_batch");
  const updatedAt = nowIso();

  for (const entryId of entryIds) {
    const storedEntry = entriesById.get(entryId);

    if (!storedEntry) {
      skipped.push({ entryId, reason: "词条不存在或已被删除" });
      continue;
    }

    const audit = deriveEntryWorkflowAudit(storedEntry, existingEvents);
    const entry = normalizeEntry({
      ...storedEntry,
      translated_by: audit.translatedBy,
      proofread_by: audit.proofreadBy,
      proofread_count: audit.proofreadCount,
      reviewed_by: audit.reviewedBy,
    });
    const workflowOperation = resolveWorkflowOperation(request.operation, entry);
    const taskReason = getTaskScopeBlockReason(
      entry,
      actor,
      storedProject,
      tasks,
    );
    const operationReason =
      taskReason ||
      getOperationBlockReason(
        request.operation,
        workflowOperation,
        entry,
        actor,
        storedProject,
        note,
      );

    if (operationReason) {
      skipped.push({ entryId, reason: operationReason });
      continue;
    }

    const updatedEntry = applyOperation(
      request.operation,
      workflowOperation,
      entry,
      actor,
      storedProject,
      updatedAt,
      note,
    );

    updatedEntries.push(updatedEntry);

    if (workflowOperation) {
      versionEvents.push(
        createEntryVersionEvent(entry, updatedEntry, actor.id, {
          operation: workflowOperation,
          batchId,
        }),
      );
    } else {
      otherEvents.push({
        id: createId("event"),
        type:
          request.operation === "set_disputed"
            ? "entry.mark_disputed"
            : "entry.resolve_dispute",
        user_id: actor.id,
        entry_id: entry.id,
        file_id: entry.file_id,
        created_at: updatedAt,
        detail: {
          batch_id: batchId,
          note,
          status: updatedEntry.status,
        },
      });
      await appendBatchComment(
        storage,
        updatedEntry,
        actor,
        note,
        request.operation === "set_disputed",
        updatedAt,
        commentsByPath,
        otherEvents,
        batchId,
      );
    }
  }

  const preview: EntryBatchPreview = {
    operation: request.operation,
    selectedCount: entryIds.length,
    applicableEntryIds: updatedEntries.map((entry) => entry.id),
    skipped,
    skippedReasonCounts: countSkippedReasons(skipped),
  };

  return {
    preview,
    project: storedProject,
    allEntries,
    updatedEntries,
    versionEvents,
    otherEvents,
    commentsByPath,
    batchId,
  };
}

export async function previewEntryBatch(
  request: EntryBatchRequest,
): Promise<EntryBatchPreview> {
  return (await prepareBatch(request)).preview;
}

export async function executeEntryBatch(
  request: EntryBatchRequest,
): Promise<EntryBatchResult> {
  const storage = getProjectStorage();
  const prepared = await prepareBatch(request);

  if (prepared.updatedEntries.length === 0) {
    return {
      ...prepared.preview,
      batchId: prepared.batchId,
      updatedEntries: [],
    };
  }

  const updatedById = new Map(
    prepared.updatedEntries.map((entry) => [entry.id, entry]),
  );
  const affectedFileIds = Array.from(
    new Set(prepared.updatedEntries.map((entry) => entry.file_id)),
  );
  const entriesByFile = new Map<string, Entry[]>();

  for (const entry of prepared.allEntries) {
    const fileEntries = entriesByFile.get(entry.file_id) ?? [];

    fileEntries.push(updatedById.get(entry.id) ?? entry);
    entriesByFile.set(entry.file_id, fileEntries);
  }

  const writes = await Promise.all(
    affectedFileIds.map((fileId) =>
      prepareEntriesWrite(
        storage,
        fileId,
        entriesByFile.get(fileId) ?? [],
        { chunkSize: prepared.project.settings.chunk_size },
      ),
    ),
  );
  const existingEvents = await loadEvents(storage);
  const writePlan = createProjectWritePlan(storage);

  for (const preparedWrite of writes) {
    for (const write of preparedWrite.writes) {
      writePlan.writeJsonl(write.path, write.rows);
    }

    for (const path of preparedWrite.deletes) {
      writePlan.deleteFile(path);
    }
  }

  for (const [path, comments] of prepared.commentsByPath) {
    writePlan.writeJsonl(path, comments);
  }

  writePlan.writeJsonl("logs/events.jsonl", [
    ...existingEvents,
    ...prepared.versionEvents,
    ...prepared.otherEvents,
  ]);

  await writePlan.execute();

  for (const fileId of affectedFileIds) {
    cacheEntriesForFile(fileId, entriesByFile.get(fileId) ?? []);
  }

  return {
    ...prepared.preview,
    batchId: prepared.batchId,
    updatedEntries: prepared.updatedEntries,
  };
}
