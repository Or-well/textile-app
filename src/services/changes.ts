import type {
  ChangePackageManifest,
  ChangePackageSignature,
  Comment,
  Entry,
  Member,
  ProjectConfig,
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
import { getSigningPrivateKeyForMember } from "./auth";
import {
  CHANGE_PACKAGE_SIGNATURE_ALGORITHM,
  sha256Hex,
  shortHash,
  signTextWithPrivateKey,
  stableStringify,
  verifyTextSignature,
} from "./crypto";
import { canDangerousImportChangePackage } from "./permissions";

export interface ExportedChangePackage {
  fileName: string;
  blob: Blob;
  manifest: ChangePackageManifest;
  signature?: ChangePackageSignature;
}

export interface ReadChangePackage {
  manifest: ChangePackageManifest;
  signature?: ChangePackageSignature;
  files: Record<string, string>;
  entries: Record<string, Entry[]>;
  comments: Record<string, Comment[]>;
  events: ProjectEvent[];
  validation?: ChangePackageValidation;
}

export interface ChangePackagePreview {
  manifest: ChangePackageManifest;
  changedEntries: number;
  commentCount: number;
  logCount: number;
  entryPaths: string[];
  validation: ChangePackageValidation;
  contentHashShort: string;
  isLegacyPackage: boolean;
}

export type ProjectMatchStatus = "matched" | "mismatched" | "unknown";
export type ContentIntegrityStatus =
  | "passed"
  | "failed"
  | "legacy_unchecked";
export type SignatureStatus =
  | "valid"
  | "invalid"
  | "unsigned"
  | "missing_public_key";

export interface ChangePackageValidation {
  projectMatch: ProjectMatchStatus;
  expectedProjectId?: string;
  packageProjectId?: string;
  contentIntegrity: ContentIntegrityStatus;
  declaredContentHash?: string;
  calculatedContentHash?: string;
  signatureStatus: SignatureStatus;
  signerName?: string;
  riskMessages: string[];
  canImportNormally: boolean;
  requiresDangerousImport: boolean;
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

export interface ApplyChangePackageOptions {
  allowDangerous?: boolean;
  actor?: Member | null;
}

const CHANGE_PACKAGE_APP_VERSION = "0.2.0";

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

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function getStableRowKey(row: {
  id?: string;
  entry_id?: string;
  created_at?: string;
  index?: number;
}): string {
  return [
    row.id ?? "",
    row.entry_id ?? "",
    typeof row.index === "number" ? String(row.index).padStart(8, "0") : "",
    row.created_at ?? "",
  ].join("|");
}

function sortRows<T extends { id?: string; entry_id?: string; created_at?: string; index?: number }>(
  rows: T[],
): T[] {
  return [...rows].sort((left, right) =>
    compareText(getStableRowKey(left), getStableRowKey(right)),
  );
}

function normalizeRecordRows<T extends {
  id?: string;
  entry_id?: string;
  created_at?: string;
  index?: number;
}>(rowsByPath: Record<string, T[]>): { path: string; rows: T[] }[] {
  return Object.entries(rowsByPath)
    .sort(([leftPath], [rightPath]) => compareText(leftPath, rightPath))
    .map(([path, rows]) => ({
      path,
      rows: sortRows(rows),
    }));
}

function buildContentHashPayload(
  entries: Record<string, Entry[]>,
  comments: Record<string, Comment[]>,
  events: ProjectEvent[],
) {
  return {
    entries: normalizeRecordRows(entries),
    comments: normalizeRecordRows(comments),
    logs: sortRows(events),
  };
}

async function calculateContentHash(
  entries: Record<string, Entry[]>,
  comments: Record<string, Comment[]>,
  events: ProjectEvent[],
): Promise<string> {
  return sha256Hex(stableStringify(buildContentHashPayload(entries, comments, events)));
}

function buildSignaturePayload(manifest: ChangePackageManifest): string {
  return stableStringify({ manifest });
}

function buildPackageId(userId: string, taskId: string, createdAt: string): string {
  const date = createdAt.slice(0, 10).replace(/-/g, "");

  return createId(`change_${date}_${userId}_${taskId}`);
}

function readSignature(files: Record<string, string>): ChangePackageSignature | undefined {
  const text = files["signature.json"];

  if (!text) {
    return undefined;
  }

  return JSON.parse(text) as ChangePackageSignature;
}

async function loadProjectMembers(root: ProjectDirectoryHandle): Promise<Member[]> {
  const file = await readJson<{ members: Member[] }>(root, "members.json");

  return file.members;
}

function createBaseValidation(
  changePackage: ReadChangePackage,
): ChangePackageValidation {
  const isLegacyPackage = !changePackage.manifest.content_hash;

  return {
    projectMatch: "unknown",
    packageProjectId: changePackage.manifest.project_id,
    contentIntegrity: isLegacyPackage ? "legacy_unchecked" : "failed",
    declaredContentHash: changePackage.manifest.content_hash,
    signatureStatus: changePackage.signature ? "invalid" : "unsigned",
    riskMessages: [],
    canImportNormally: false,
    requiresDangerousImport: false,
  };
}

function buildRiskMessages(
  validation: Omit<ChangePackageValidation, "riskMessages">,
): string[] {
  const messages: string[] = [];

  if (validation.projectMatch === "mismatched") {
    messages.push("修改包不属于当前项目，不能导入。");
  }

  if (validation.contentIntegrity === "failed") {
    messages.push("内容完整性未通过，修改包可能已被改动。默认拒绝导入。");
  }

  if (validation.contentIntegrity === "legacy_unchecked") {
    messages.push("这是旧格式修改包，无法校验内容完整性。");
  }

  if (validation.signatureStatus === "invalid") {
    messages.push("成员签名无效，请联系负责人核对来源。");
  }

  if (validation.signatureStatus === "unsigned") {
    messages.push("修改包未签名，只能依赖内容校验和人工确认来源。");
  }

  if (validation.signatureStatus === "missing_public_key") {
    messages.push("项目成员未配置公钥，无法验证签名。");
  }

  return messages;
}

async function verifySignatureStatus(
  changePackage: ReadChangePackage,
  members: Member[],
): Promise<Pick<ChangePackageValidation, "signatureStatus" | "signerName">> {
  if (!changePackage.signature) {
    return { signatureStatus: "unsigned" };
  }

  const signer = members.find((member) => member.id === changePackage.manifest.user_id);

  if (!signer?.public_key) {
    return {
      signatureStatus: "missing_public_key",
      signerName: signer?.name,
    };
  }

  const isValid =
    changePackage.signature.user_id === changePackage.manifest.user_id &&
    changePackage.signature.algorithm === CHANGE_PACKAGE_SIGNATURE_ALGORITHM &&
    (await verifyTextSignature(
      signer.public_key,
      buildSignaturePayload(changePackage.manifest),
      changePackage.signature.signature,
    ));

  return {
    signatureStatus: isValid ? "valid" : "invalid",
    signerName: signer.name,
  };
}

async function createSignature(
  manifest: ChangePackageManifest,
): Promise<ChangePackageSignature | undefined> {
  const privateKey = getSigningPrivateKeyForMember(manifest.user_id);

  if (!privateKey) {
    return undefined;
  }

  return {
    schema_version: 1,
    package_id: manifest.package_id,
    user_id: manifest.user_id,
    algorithm: CHANGE_PACKAGE_SIGNATURE_ALGORITHM,
    signed_at: nowIso(),
    signature: await signTextWithPrivateKey(privateKey, buildSignaturePayload(manifest)),
  };
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
  validation: ChangePackageValidation,
  options: ApplyChangePackageOptions,
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
      package_id: manifest.package_id ?? "",
      applied_entries: result.appliedEntries,
      imported_comments: result.importedComments,
      imported_events: result.importedEvents,
      content_integrity: validation.contentIntegrity,
      content_hash: manifest.content_hash ?? "",
      signature_status: validation.signatureStatus,
      dangerous_import: Boolean(options.allowDangerous),
      imported_by: options.actor?.id ?? "",
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
  const project = await readJson<ProjectConfig>(root, "project.json");
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

  if (changedEntryCount + newCommentCount + events.length === 0) {
    throw new Error(
      "当前成员在所选任务范围内没有可导出的修改。请确认登录的是完成该任务的成员，或先保存译文后再导出。",
    );
  }

  const createdAt = nowIso();
  const contentHash = await calculateContentHash(changedEntries, comments, events);
  const manifest: ChangePackageManifest = {
    schema_version: 1,
    project_id: project.project_id,
    package_id: buildPackageId(userId, taskId, createdAt),
    user_id: userId,
    user_name: userId,
    task_id: taskId,
    created_at: createdAt,
    changed_entries: changedEntryCount,
    new_comments: newCommentCount,
    content_hash: contentHash,
    app_version: CHANGE_PACKAGE_APP_VERSION,
    source_project_version: String(project.schema_version),
  };
  const signature = await createSignature(manifest);
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

  if (signature) {
    files["signature.json"] = `${JSON.stringify(signature, null, 2)}\n`;
  }

  return {
    fileName: buildFileName(userId, taskId, createdAt),
    blob: await createZip(files),
    manifest,
    signature,
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
    const signature = readSignature(files);
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
      signature,
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
): Promise<ChangePackageValidation> {
  const root = getProjectRoot();
  const project = await readJson<ProjectConfig>(root, "project.json");
  const members = await loadProjectMembers(root);
  const packageProjectId = changePackage.manifest.project_id;
  const calculatedContentHash = await calculateContentHash(
    changePackage.entries,
    changePackage.comments,
    changePackage.events,
  );
  const contentIntegrity: ContentIntegrityStatus = changePackage.manifest.content_hash
    ? changePackage.manifest.content_hash === calculatedContentHash
      ? "passed"
      : "failed"
    : "legacy_unchecked";
  const signatureResult = await verifySignatureStatus(changePackage, members);
  const baseValidation = {
    projectMatch:
      packageProjectId === project.project_id
        ? ("matched" as const)
        : ("mismatched" as const),
    expectedProjectId: project.project_id,
    packageProjectId,
    contentIntegrity,
    declaredContentHash: changePackage.manifest.content_hash,
    calculatedContentHash,
    signatureStatus: signatureResult.signatureStatus,
    signerName: signatureResult.signerName,
    canImportNormally:
      packageProjectId === project.project_id && contentIntegrity !== "failed",
    requiresDangerousImport:
      packageProjectId === project.project_id && contentIntegrity === "failed",
  };
  const validation: ChangePackageValidation = {
    ...baseValidation,
    riskMessages: buildRiskMessages(baseValidation),
  };

  changePackage.validation = validation;

  return validation;
}

export function previewChangePackage(
  changePackage: ReadChangePackage,
): ChangePackagePreview {
  const validation = changePackage.validation ?? createBaseValidation(changePackage);

  return {
    manifest: changePackage.manifest,
    changedEntries: flattenEntries(changePackage.entries).length,
    commentCount: Object.values(changePackage.comments).reduce(
      (total, rows) => total + rows.length,
      0,
    ),
    logCount: changePackage.events.length,
    entryPaths: Object.keys(changePackage.entries),
    validation,
    contentHashShort: shortHash(changePackage.manifest.content_hash),
    isLegacyPackage:
      !changePackage.manifest.package_id || !changePackage.manifest.content_hash,
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
  options: ApplyChangePackageOptions = {},
): Promise<ApplyChangePackageResult> {
  const validation = await validateChangePackage(changePackage);

  if (validation.projectMatch !== "matched") {
    throw new Error("修改包不属于当前项目，无法导入。");
  }

  if (validation.contentIntegrity === "failed") {
    if (!options.allowDangerous) {
      throw new Error("修改包内容完整性未通过，默认拒绝导入。");
    }

    if (!canDangerousImportChangePackage(options.actor)) {
      throw new Error("当前成员没有危险导入权限。");
    }
  }

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

  await appendImportLog(changePackage.manifest, result, validation, options);

  return result;
}
