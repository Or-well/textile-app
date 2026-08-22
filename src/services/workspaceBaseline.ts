import type {
  Comment,
  Entry,
  ProjectConfig,
  ProjectEvent,
  Task,
  Term,
  TermDeletion,
} from "../model/types";
import { stableStringify } from "./crypto";
import type { ProjectStorage } from "./projectStorage";

export const WORKSPACE_BASELINE_PATH = "changes/workspace/baseline.json";
const LOCAL_TERM_DELETIONS_PATH = "changes/term-deletions.jsonl";

export interface WorkspaceSnapshot {
  schema_version: 1;
  project_id: string;
  revision: string;
  captured_at: string;
  /** 负责人权威快照的发布时间；旧基线缺失时由 project.updated_at 兼容。 */
  authority_updated_at?: string;
  entries: Record<string, Entry[]>;
  comments: Record<string, Comment[]>;
  terms: Term[];
  term_deletions: TermDeletion[];
  tasks: Task[];
  event_ids: string[];
  /**
   * 旧项目第一次由新版本打开时，没有可供三方合并使用的历史快照。
   * 该字段只用于第一次项目更新的保守迁移，成功更新后不会继续写入。
   */
  legacy_user_id?: string;
}

export interface WorkspaceRecordChange<T> {
  path: string;
  id: string;
  before?: T;
  after?: T;
}

export interface WorkspaceDiff {
  entries: WorkspaceRecordChange<Entry>[];
  comments: WorkspaceRecordChange<Comment>[];
  terms: WorkspaceRecordChange<Term>[];
  termDeletions: WorkspaceRecordChange<TermDeletion>[];
  tasks: WorkspaceRecordChange<Task>[];
}

function getRevision(project: ProjectConfig): string {
  return project.revision || project.revision_hash || "";
}

async function readEntries(
  storage: ProjectStorage,
  project: ProjectConfig,
): Promise<Record<string, Entry[]>> {
  const result: Record<string, Entry[]> = {};

  for (const file of project.files) {
    if (!(await storage.fileExists(file.entries_path))) {
      continue;
    }

    const names = (await storage.listFiles(file.entries_path))
      .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
      .sort((left, right) => left.localeCompare(right));

    for (const name of names) {
      const path = `${file.entries_path}/${name}`;
      result[path] = await storage.readJsonl<Entry>(path);
    }
  }

  return result;
}

async function readComments(
  storage: ProjectStorage,
): Promise<Record<string, Comment[]>> {
  const result: Record<string, Comment[]> = {};

  if (!(await storage.fileExists("comments"))) {
    return result;
  }

  for (const fileId of await storage.listFiles("comments")) {
    const directory = `comments/${fileId}`;

    for (const name of await storage.listFiles(directory)) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }

      const path = `${directory}/${name}`;
      result[path] = await storage.readJsonl<Comment>(path);
    }
  }

  return result;
}

export async function captureWorkspaceSnapshot(
  storage: ProjectStorage,
  project: ProjectConfig,
): Promise<WorkspaceSnapshot> {
  const [entries, comments, terms, termDeletions, tasks, events] =
    await Promise.all([
      readEntries(storage, project),
      readComments(storage),
      storage.fileExists("terms/terms.jsonl").then((exists) =>
        exists ? storage.readJsonl<Term>("terms/terms.jsonl") : [],
      ),
      storage.fileExists(LOCAL_TERM_DELETIONS_PATH).then((exists) =>
        exists
          ? storage.readJsonl<TermDeletion>(LOCAL_TERM_DELETIONS_PATH)
          : [],
      ),
      storage.fileExists("tasks/tasks.jsonl").then((exists) =>
        exists ? storage.readJsonl<Task>("tasks/tasks.jsonl") : [],
      ),
      storage.fileExists("logs/events.jsonl").then((exists) =>
        exists ? storage.readJsonl<ProjectEvent>("logs/events.jsonl") : [],
      ),
    ]);

  return {
    schema_version: 1,
    project_id: project.project_id,
    revision: getRevision(project),
    captured_at: new Date().toISOString(),
    entries,
    comments,
    terms,
    term_deletions: termDeletions,
    tasks,
    event_ids: events.map((event) => event.id),
  };
}

export async function readWorkspaceBaseline(
  storage: ProjectStorage,
  project: ProjectConfig,
): Promise<WorkspaceSnapshot | null> {
  if (!(await storage.fileExists(WORKSPACE_BASELINE_PATH))) {
    return null;
  }

  const baseline = await storage.readJson<WorkspaceSnapshot>(
    WORKSPACE_BASELINE_PATH,
  );

  if (
    baseline.schema_version !== 1 ||
    baseline.project_id !== project.project_id ||
    baseline.revision !== getRevision(project)
  ) {
    return null;
  }

  return baseline;
}

export async function writeWorkspaceBaseline(
  storage: ProjectStorage,
  snapshot: WorkspaceSnapshot,
): Promise<void> {
  await storage.ensureDirectory("changes/workspace");
  await storage.writeJson(WORKSPACE_BASELINE_PATH, snapshot);
}

export async function ensureWorkspaceBaseline(
  storage: ProjectStorage,
  project: ProjectConfig,
  legacyUserId?: string,
): Promise<WorkspaceSnapshot> {
  const existing = await readWorkspaceBaseline(storage, project);

  if (existing) {
    return existing;
  }

  const snapshot = await captureWorkspaceSnapshot(storage, project);
  if (legacyUserId) {
    snapshot.legacy_user_id = legacyUserId;
  }
  await writeWorkspaceBaseline(storage, snapshot);
  return snapshot;
}

function flattenRecords<T extends { id: string }>(
  rowsByPath: Record<string, T[]>,
): Map<string, { path: string; row: T }> {
  const result = new Map<string, { path: string; row: T }>();

  for (const [path, rows] of Object.entries(rowsByPath)) {
    for (const row of rows) {
      result.set(row.id, { path, row });
    }
  }

  return result;
}

function diffRecords<T extends { id: string }>(
  beforeByPath: Record<string, T[]>,
  afterByPath: Record<string, T[]>,
): WorkspaceRecordChange<T>[] {
  const before = flattenRecords(beforeByPath);
  const after = flattenRecords(afterByPath);
  const ids = new Set([...before.keys(), ...after.keys()]);
  const changes: WorkspaceRecordChange<T>[] = [];

  for (const id of ids) {
    const previous = before.get(id);
    const current = after.get(id);

    if (
      previous &&
      current &&
      previous.path === current.path &&
      stableStringify(previous.row) === stableStringify(current.row)
    ) {
      continue;
    }

    changes.push({
      path: current?.path ?? previous?.path ?? "",
      id,
      before: previous?.row,
      after: current?.row,
    });
  }

  return changes;
}

function rowsToPath<T extends { id: string }>(
  path: string,
  rows: T[],
): Record<string, T[]> {
  return rows.length > 0 ? { [path]: rows } : {};
}

export function diffWorkspaceSnapshots(
  baseline: WorkspaceSnapshot,
  current: WorkspaceSnapshot,
): WorkspaceDiff {
  return {
    entries: diffRecords(baseline.entries, current.entries),
    comments: diffRecords(baseline.comments, current.comments),
    terms: diffRecords(
      rowsToPath("terms/terms.jsonl", baseline.terms),
      rowsToPath("terms/terms.jsonl", current.terms),
    ),
    termDeletions: diffRecords(
      rowsToPath(LOCAL_TERM_DELETIONS_PATH, baseline.term_deletions),
      rowsToPath(LOCAL_TERM_DELETIONS_PATH, current.term_deletions),
    ),
    tasks: diffRecords(
      rowsToPath("tasks/tasks.jsonl", baseline.tasks),
      rowsToPath("tasks/tasks.jsonl", current.tasks),
    ),
  };
}

export function groupChangedRows<T extends { id: string }>(
  changes: WorkspaceRecordChange<T>[],
  predicate: (change: WorkspaceRecordChange<T>) => boolean = () => true,
): Record<string, T[]> {
  const result: Record<string, T[]> = {};

  for (const change of changes) {
    if (!change.after || !predicate(change)) {
      continue;
    }

    (result[change.path] ??= []).push(change.after);
  }

  return result;
}
