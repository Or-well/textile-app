import type {
  Entry,
  Member,
  ProjectConfig,
  ProjectEvent,
  Task,
} from "../model/types";
import { PERMISSION_ACTIONS } from "../model/permissions";
import { normalizeEntry } from "../model/status";
import { createId } from "../utils/id";
import { nowIso } from "../utils/time";
import {
  cacheEntriesForFile,
  loadAllEntries,
  prepareEntriesWrite,
} from "./entries";
import { can, canManageTask } from "./permissions";
import type { ProjectDirectoryHandle } from "./projectFs";
import {
  createProjectStorage,
  type ProjectStorage,
} from "./projectStorage";
import { createProjectWritePlan } from "./projectWritePlan";
import { isEntryInTask, loadTasks } from "./tasks";

export interface EntryReplaceRequest {
  entryIds: string[];
  findText: string;
  replaceText: string;
  actor: Member | null | undefined;
  project: ProjectConfig;
  caseSensitive?: boolean;
  skipReviewedAndProofread?: boolean;
}

export interface EntryReplaceItem {
  entryId: string;
  fileId: string;
  index: number;
  key: string;
  status: Entry["status"];
  beforeTarget: string;
  afterTarget: string;
  matchCount: number;
}

export interface EntryReplaceSkippedItem {
  entryId: string;
  reason: string;
}

export interface EntryReplacePreview {
  selectedCount: number;
  replacements: EntryReplaceItem[];
  skipped: EntryReplaceSkippedItem[];
  skippedReasonCounts: Array<{
    reason: string;
    count: number;
  }>;
  totalMatches: number;
  proofreadCount: number;
  reviewedCount: number;
}

export interface EntryReplaceResult extends EntryReplacePreview {
  batchId: string;
  updatedEntries: Entry[];
}

interface PreparedReplace {
  preview: EntryReplacePreview;
  project: ProjectConfig;
  allEntries: Entry[];
  updatedEntries: Entry[];
  events: ProjectEvent[];
  batchId: string;
}

let currentProjectStorage: ProjectStorage | null = null;

export function setEntryReplaceProjectRoot(root: ProjectDirectoryHandle): void {
  setEntryReplaceProjectStorage(createProjectStorage(root));
}

export function setEntryReplaceProjectStorage(storage: ProjectStorage): void {
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

function uniqueEntryIds(entryIds: string[]): string[] {
  return Array.from(
    new Set(entryIds.map((entryId) => entryId.trim()).filter(Boolean)),
  );
}

function countSkippedReasons(
  skipped: EntryReplaceSkippedItem[],
): EntryReplacePreview["skippedReasonCounts"] {
  const counts = new Map<string, number>();

  for (const item of skipped) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }

  return Array.from(counts, ([reason, count]) => ({ reason, count })).sort(
    (left, right) => right.count - left.count,
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceLiteral(
  text: string,
  findText: string,
  replaceText: string,
  caseSensitive: boolean,
): { text: string; count: number } {
  const pattern = new RegExp(
    escapeRegExp(findText),
    caseSensitive ? "g" : "gi",
  );
  let count = 0;
  const replaced = text.replace(pattern, () => {
    count += 1;
    return replaceText;
  });

  return { text: replaced, count };
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

function getReplaceBlockReason(
  entry: Entry,
  actor: Member,
  project: ProjectConfig,
  skipReviewedAndProofread: boolean,
): string {
  const file = project.files.find((item) => item.id === entry.file_id);

  if (file?.locked || entry.locked) {
    return "词条或所属文件已锁定";
  }

  if (file?.hidden || entry.hidden) {
    return "词条或所属文件已隐藏";
  }

  if (
    skipReviewedAndProofread &&
    (entry.status === "proofread" || entry.status === "reviewed")
  ) {
    return "已校对或已审核词条已按选项跳过";
  }

  if (
    !can(actor, PERMISSION_ACTIONS.ENTRY_EDIT, project) &&
    !can(actor, PERMISSION_ACTIONS.ENTRY_TRANSLATE, project)
  ) {
    return "当前成员没有替换译文的权限";
  }

  return "";
}

async function loadEvents(storage: ProjectStorage): Promise<ProjectEvent[]> {
  return (await storage.fileExists("logs/events.jsonl"))
    ? storage.readJsonl<ProjectEvent>("logs/events.jsonl")
    : [];
}

function createReplaceEvent(
  before: Entry,
  after: Entry,
  actor: Member,
  request: EntryReplaceRequest,
  batchId: string,
  matchCount: number,
): ProjectEvent {
  return {
    id: createId("event"),
    type: "entry.target_replaced",
    user_id: actor.id,
    entry_id: after.id,
    file_id: after.file_id,
    created_at: after.updated_at || nowIso(),
    detail: {
      batch_id: batchId,
      find_text: request.findText,
      replace_text: request.replaceText,
      before_target: before.target,
      after_target: after.target,
      before_status: before.status,
      after_status: after.status,
      match_count: matchCount,
      case_sensitive: Boolean(request.caseSensitive),
      preserve_workflow: true,
    },
  };
}

async function prepareReplace(request: EntryReplaceRequest): Promise<PreparedReplace> {
  const storage = getProjectStorage();
  const actor = resolveActor(request.actor);
  const entryIds = uniqueEntryIds(request.entryIds);
  const findText = request.findText;

  if (!findText) {
    throw new Error("请输入要查找的内容。");
  }

  const storedProject = await storage.readJson<ProjectConfig>("project.json");

  if (storedProject.project_id !== request.project.project_id) {
    throw new Error("当前项目与替换目标不一致，请重新打开项目后再试。");
  }

  const [allEntries, tasks] = await Promise.all([
    loadAllEntries(),
    storedProject.settings.workflow?.enable_tasks === false
      ? Promise.resolve([])
      : loadTasks(),
  ]);
  const entriesById = new Map(allEntries.map((entry) => [entry.id, entry]));
  const skipped: EntryReplaceSkippedItem[] = [];
  const replacements: EntryReplaceItem[] = [];
  const updatedEntries: Entry[] = [];
  const events: ProjectEvent[] = [];
  const batchId = createId("entry_replace");
  const updatedAt = nowIso();

  for (const entryId of entryIds) {
    const storedEntry = entriesById.get(entryId);

    if (!storedEntry) {
      skipped.push({ entryId, reason: "词条不存在或已被删除" });
      continue;
    }

    const entry = normalizeEntry(storedEntry);
    const taskReason = getTaskScopeBlockReason(
      entry,
      actor,
      storedProject,
      tasks,
    );
    const replaceReason =
      taskReason ||
      getReplaceBlockReason(
        entry,
        actor,
        storedProject,
        Boolean(request.skipReviewedAndProofread),
      );

    if (replaceReason) {
      skipped.push({ entryId, reason: replaceReason });
      continue;
    }

    const result = replaceLiteral(
      entry.target,
      findText,
      request.replaceText,
      Boolean(request.caseSensitive),
    );

    if (result.count === 0) {
      skipped.push({ entryId, reason: "未命中查找内容" });
      continue;
    }

    const updatedEntry = normalizeEntry({
      ...entry,
      target: result.text,
      updated_at: updatedAt,
      updated_by: actor.id,
    });

    replacements.push({
      entryId: entry.id,
      fileId: entry.file_id,
      index: entry.index,
      key: entry.key,
      status: entry.status,
      beforeTarget: entry.target,
      afterTarget: updatedEntry.target,
      matchCount: result.count,
    });
    updatedEntries.push(updatedEntry);
    events.push(
      createReplaceEvent(
        entry,
        updatedEntry,
        actor,
        request,
        batchId,
        result.count,
      ),
    );
  }

  const preview: EntryReplacePreview = {
    selectedCount: entryIds.length,
    replacements,
    skipped,
    skippedReasonCounts: countSkippedReasons(skipped),
    totalMatches: replacements.reduce(
      (count, item) => count + item.matchCount,
      0,
    ),
    proofreadCount: replacements.filter((item) => item.status === "proofread")
      .length,
    reviewedCount: replacements.filter((item) => item.status === "reviewed")
      .length,
  };

  return {
    preview,
    project: storedProject,
    allEntries,
    updatedEntries,
    events,
    batchId,
  };
}

export async function previewEntryReplace(
  request: EntryReplaceRequest,
): Promise<EntryReplacePreview> {
  return (await prepareReplace(request)).preview;
}

export async function executeEntryReplace(
  request: EntryReplaceRequest,
): Promise<EntryReplaceResult> {
  const storage = getProjectStorage();
  const prepared = await prepareReplace(request);

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

  writePlan.writeJsonl("logs/events.jsonl", [
    ...existingEvents,
    ...prepared.events,
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
