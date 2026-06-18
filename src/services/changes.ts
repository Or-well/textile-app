import type {
  ChangePackageManifest,
  ChangePackageSignature,
  ChangePackageSummary,
  ChangePackageType,
  Comment,
  Entry,
  Member,
  ProjectConfig,
  ProjectEvent,
  Task,
  Term,
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
  readTextFile,
  writeTextFile,
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
import {
  canDangerousImportChangePackage,
  canImportChangePackage,
  canImportMaintenanceChangePackage,
} from "./permissions";

export type ExportChangePackageMode =
  | "user_changes"
  | "task_changes"
  | "maintenance_changes";

export interface ExportChangePackageOptions {
  mode: ExportChangePackageMode;
  taskId?: string;
}

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
  terms: Record<string, Term[]>;
  contexts: Record<string, string>;
  tasks: Record<string, Task[]>;
  projectFiles: Record<string, string>;
  memberFiles: Record<string, string>;
  events: ProjectEvent[];
  validation?: ChangePackageValidation;
}

export interface ChangePackagePreview {
  manifest: ChangePackageManifest;
  changedEntries: number;
  commentCount: number;
  termCount: number;
  contextCount: number;
  taskCount: number;
  memberChangeCount: number;
  credentialChangeCount: number;
  hasProjectSettingsChange: boolean;
  logCount: number;
  entryPaths: string[];
  validation: ChangePackageValidation;
  contentHashShort: string;
  isLegacyPackage: boolean;
  packageType: ChangePackageType;
  riskLevel: ChangePackageRiskLevel;
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
export type ChangePackageRiskLevel = "normal" | "maintenance" | "danger";

export interface ChangePackageValidation {
  projectMatch: ProjectMatchStatus;
  expectedProjectId?: string;
  packageProjectId?: string;
  contentIntegrity: ContentIntegrityStatus;
  declaredContentHash?: string;
  calculatedContentHash?: string;
  signatureStatus: SignatureStatus;
  signerName?: string;
  packageType: ChangePackageType;
  summary: ChangePackageSummary;
  riskLevel: ChangePackageRiskLevel;
  riskMessages: string[];
  canImportNormally: boolean;
  requiresDangerousImport: boolean;
  requiresMaintenanceConfirmation: boolean;
  requiresOwnerCredentialConfirmation: boolean;
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
  importedTerms: number;
  importedContexts: number;
  importedTasks: number;
  importedMembers: number;
  importedProjectSettings: number;
  importedEvents: number;
}

export interface ApplyChangePackageOptions {
  allowDangerous?: boolean;
  confirmMaintenance?: boolean;
  confirmOwnerCredentials?: boolean;
  actor?: Member | null;
}

const CHANGE_PACKAGE_APP_VERSION = "0.2.0";
const EMPTY_SUMMARY: ChangePackageSummary = {
  changed_entries: 0,
  changed_comments: 0,
  changed_terms: 0,
  changed_contexts: 0,
  changed_tasks: 0,
  changed_members: 0,
  changed_project_settings: 0,
  changed_credentials: 0,
  log_events: 0,
};

interface ChangePackagePayload {
  entries: Record<string, Entry[]>;
  comments: Record<string, Comment[]>;
  terms: Record<string, Term[]>;
  contexts: Record<string, string>;
  tasks: Record<string, Task[]>;
  projectFiles: Record<string, string>;
  memberFiles: Record<string, string>;
  events: ProjectEvent[];
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

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function createEmptySummary(): ChangePackageSummary {
  return { ...EMPTY_SUMMARY };
}

function getPackageType(manifest: ChangePackageManifest): ChangePackageType {
  return manifest.package_type ?? "legacy";
}

function countRecordRows<T>(rowsByPath: Record<string, T[]>): number {
  return Object.values(rowsByPath).reduce((total, rows) => total + rows.length, 0);
}

function countRecordFiles(rowsByPath: Record<string, unknown>): number {
  return Object.keys(rowsByPath).length;
}

function getPackageSummary(payload: ChangePackagePayload): ChangePackageSummary {
  return {
    changed_entries: countRecordRows(payload.entries),
    changed_comments: countRecordRows(payload.comments),
    changed_terms: countRecordRows(payload.terms),
    changed_contexts: countRecordFiles(payload.contexts),
    changed_tasks: countRecordRows(payload.tasks),
    changed_members: countRecordFiles(payload.memberFiles),
    changed_project_settings: countRecordFiles(payload.projectFiles),
    changed_credentials: countPackageCredentials(payload.memberFiles),
    log_events: payload.events.length,
  };
}

function hasPackageContent(summary: ChangePackageSummary): boolean {
  return Object.values(summary).some((count) => count > 0);
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

function normalizeTextRecord(rowsByPath: Record<string, string>) {
  return Object.entries(rowsByPath)
    .sort(([leftPath], [rightPath]) => compareText(leftPath, rightPath))
    .map(([path, content]) => ({ path, content }));
}

function buildContentHashPayload(payload: ChangePackagePayload) {
  return {
    entries: normalizeRecordRows(payload.entries),
    comments: normalizeRecordRows(payload.comments),
    terms: normalizeRecordRows(payload.terms),
    contexts: normalizeTextRecord(payload.contexts),
    tasks: normalizeRecordRows(payload.tasks),
    project: normalizeTextRecord(payload.projectFiles),
    members: normalizeTextRecord(payload.memberFiles),
    logs: sortRows(payload.events),
  };
}

async function calculateContentHash(payload: ChangePackagePayload): Promise<string> {
  return sha256Hex(stableStringify(buildContentHashPayload(payload)));
}

function buildSignaturePayload(manifest: ChangePackageManifest): string {
  return stableStringify({ manifest });
}

function buildPackageId(
  userId: string,
  packageType: ChangePackageType,
  createdAt: string,
  taskId?: string,
): string {
  const date = createdAt.slice(0, 10).replace(/-/g, "");
  const scope = packageType === "task_changes" && taskId ? taskId : packageType;

  return createId(`change_${date}_${userId}_${scope}`);
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

function parseMembersFromPackage(memberFiles: Record<string, string>): Member[] {
  const text = memberFiles["members/members.json"];

  if (!text) {
    return [];
  }

  try {
    const file = JSON.parse(text) as { members?: Member[] };

    return file.members ?? [];
  } catch {
    return [];
  }
}

function parseProjectFromPackage(projectFiles: Record<string, string>): ProjectConfig | null {
  const text = projectFiles["project/project.json"];

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as ProjectConfig;
  } catch {
    return null;
  }
}

function hasCredentialFields(member: Member): boolean {
  return Boolean(
    member.password_hash || member.password_salt || member.password_updated_at,
  );
}

function memberCredentialsChanged(
  currentMember: Member | undefined,
  packageMember: Member,
): boolean {
  return (
    currentMember?.password_hash !== packageMember.password_hash ||
    currentMember?.password_salt !== packageMember.password_salt ||
    currentMember?.password_updated_at !== packageMember.password_updated_at
  );
}

function countPackageCredentials(memberFiles: Record<string, string>): number {
  return parseMembersFromPackage(memberFiles).filter(hasCredentialFields).length;
}

function isOwnerMember(member: Member | undefined): boolean {
  return Boolean(member?.roles.includes("owner"));
}

function detectOwnerCredentialChange(
  currentMembers: Member[],
  packageMembers: Member[],
): boolean {
  return packageMembers.some((packageMember) => {
    const currentMember = currentMembers.find((member) => member.id === packageMember.id);

    return (
      (isOwnerMember(currentMember) || isOwnerMember(packageMember)) &&
      memberCredentialsChanged(currentMember, packageMember)
    );
  });
}

function detectOwnerRolePromotion(
  currentMembers: Member[],
  packageMembers: Member[],
): boolean {
  return packageMembers.some((packageMember) => {
    const currentMember = currentMembers.find((member) => member.id === packageMember.id);

    return !isOwnerMember(currentMember) && isOwnerMember(packageMember);
  });
}

function countChangedMemberRecords(
  currentMembers: Member[],
  packageMembers: Member[],
): number {
  return packageMembers.filter((packageMember) => {
    const currentMember = currentMembers.find((member) => member.id === packageMember.id);

    return stableStringify(currentMember ?? null) !== stableStringify(packageMember);
  }).length;
}

function createBaseValidation(
  changePackage: ReadChangePackage,
): ChangePackageValidation {
  const isLegacyPackage = !changePackage.manifest.content_hash;
  const summary = changePackage.manifest.summary ?? createEmptySummary();

  return {
    projectMatch: "unknown",
    packageProjectId: changePackage.manifest.project_id,
    contentIntegrity: isLegacyPackage ? "legacy_unchecked" : "failed",
    declaredContentHash: changePackage.manifest.content_hash,
    signatureStatus: changePackage.signature ? "invalid" : "unsigned",
    packageType: getPackageType(changePackage.manifest),
    summary,
    riskLevel: "normal",
    riskMessages: [],
    canImportNormally: false,
    requiresDangerousImport: false,
    requiresMaintenanceConfirmation: false,
    requiresOwnerCredentialConfirmation: false,
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

  if (validation.packageType === "maintenance_changes") {
    messages.push("这是项目维护修改包，可能更新项目设置、成员、权限或密码凭据。");
  }

  if (validation.summary.changed_project_settings > 0) {
    messages.push("修改包包含项目设置变更，导入前请确认来源可靠。");
  }

  if (validation.summary.changed_members > 0) {
    messages.push("修改包包含成员或权限变更，不会静默导入。");
  }

  if (validation.summary.changed_credentials > 0) {
    messages.push("修改包包含密码凭据变更，界面不会显示具体凭据内容。");
  }

  if (validation.requiresOwnerCredentialConfirmation) {
    messages.push("修改包涉及负责人账号凭据或负责人权限变更，需要额外确认。");
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

async function collectProjectEntryGroups(
  root: ProjectDirectoryHandle,
  project: ProjectConfig,
): Promise<{ path: string; entries: Entry[] }[]> {
  const groups: { path: string; entries: Entry[] }[] = [];

  for (const file of project.files) {
    if (!(await fileExists(root, file.entries_path))) {
      continue;
    }

    const fileNames = await listFiles(root, file.entries_path);
    const chunkFiles = fileNames
      .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
      .sort((a, b) => a.localeCompare(b));

    for (const chunkFile of chunkFiles) {
      const path = `${file.entries_path}/${chunkFile}`;

      groups.push({
        path,
        entries: normalizeEntries(await readJsonl<Entry>(root, path)),
      });
    }
  }

  return groups;
}

async function collectUserChangedEntries(
  root: ProjectDirectoryHandle,
  project: ProjectConfig,
  userId: string,
): Promise<Record<string, Entry[]>> {
  const changedEntries: Record<string, Entry[]> = {};
  const groups = await collectProjectEntryGroups(root, project);

  for (const group of groups) {
    const rows = group.entries.filter((entry) => entry.updated_by === userId);

    if (rows.length > 0) {
      changedEntries[group.path] = rows;
    }
  }

  return changedEntries;
}

async function collectTaskChangedEntries(
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

function getPackageEntries(payloadEntries: Record<string, Entry[]>): Entry[] {
  return Object.values(payloadEntries).flat();
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

async function collectUserTerms(
  root: ProjectDirectoryHandle,
  userId: string,
): Promise<Record<string, Term[]>> {
  if (!(await fileExists(root, "terms/terms.jsonl"))) {
    return {};
  }

  const rows = (await readJsonl<Term>(root, "terms/terms.jsonl")).filter(
    (term) => term.created_by === userId,
  );

  return rows.length > 0 ? { "terms/terms.jsonl": rows } : {};
}

async function collectAllTerms(root: ProjectDirectoryHandle): Promise<Record<string, Term[]>> {
  if (!(await fileExists(root, "terms/terms.jsonl"))) {
    return {};
  }

  return { "terms/terms.jsonl": await readJsonl<Term>(root, "terms/terms.jsonl") };
}

async function collectUserTasks(
  root: ProjectDirectoryHandle,
  userId: string,
): Promise<Record<string, Task[]>> {
  if (!(await fileExists(root, "tasks/tasks.jsonl"))) {
    return {};
  }

  const rows = (await readJsonl<Task>(root, "tasks/tasks.jsonl")).filter(
    (task) => task.created_by === userId || task.assignee === userId,
  );

  return rows.length > 0 ? { "tasks/tasks.jsonl": rows } : {};
}

async function collectAllTasks(root: ProjectDirectoryHandle): Promise<Record<string, Task[]>> {
  if (!(await fileExists(root, "tasks/tasks.jsonl"))) {
    return {};
  }

  return { "tasks/tasks.jsonl": await readJsonl<Task>(root, "tasks/tasks.jsonl") };
}

async function collectTaskRows(root: ProjectDirectoryHandle, task: Task): Promise<Record<string, Task[]>> {
  return (await fileExists(root, "tasks/tasks.jsonl"))
    ? { "tasks/tasks.jsonl": [task] }
    : {};
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

async function collectUserEvents(
  root: ProjectDirectoryHandle,
  userId: string,
): Promise<ProjectEvent[]> {
  if (!(await fileExists(root, "logs/events.jsonl"))) {
    return [];
  }

  return (await readJsonl<ProjectEvent>(root, "logs/events.jsonl")).filter(
    (event) => event.user_id === userId,
  );
}

async function collectAllEvents(root: ProjectDirectoryHandle): Promise<ProjectEvent[]> {
  if (!(await fileExists(root, "logs/events.jsonl"))) {
    return [];
  }

  return readJsonl<ProjectEvent>(root, "logs/events.jsonl");
}

async function collectTextFiles(
  root: ProjectDirectoryHandle,
  directoryPath: string,
): Promise<Record<string, string>> {
  if (!(await fileExists(root, directoryPath))) {
    return {};
  }

  const files: Record<string, string> = {};
  const names = await listFiles(root, directoryPath);

  for (const name of names) {
    const path = `${directoryPath}/${name}`;

    try {
      Object.assign(files, await collectTextFiles(root, path));
    } catch {
      files[path] = await readTextFile(root, path);
    }
  }

  return files;
}

async function collectProjectFiles(root: ProjectDirectoryHandle): Promise<Record<string, string>> {
  return {
    "project/project.json": await readTextFile(root, "project.json"),
  };
}

async function collectMemberFiles(root: ProjectDirectoryHandle): Promise<Record<string, string>> {
  return {
    "members/members.json": await readTextFile(root, "members.json"),
  };
}

function buildFileName(
  userId: string,
  packageType: ChangePackageType,
  createdAt: string,
  taskId?: string,
): string {
  const date = createdAt.slice(0, 10).replace(/-/g, "");

  const scope = packageType === "task_changes" && taskId ? taskId : packageType;

  return `changes-${userId}-${scope}-${date}.zip`;
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

function mergeRowsById<T extends { id: string }>(
  existingRows: T[],
  packageRows: T[],
): { rows: T[]; imported: number } {
  const nextRows = [...existingRows];
  let imported = 0;

  for (const packageRow of packageRows) {
    const index = nextRows.findIndex((row) => row.id === packageRow.id);

    if (index >= 0) {
      if (stableStringify(nextRows[index]) !== stableStringify(packageRow)) {
        nextRows[index] = packageRow;
        imported += 1;
      }
    } else {
      nextRows.push(packageRow);
      imported += 1;
    }
  }

  return { rows: nextRows, imported };
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
      package_type: validation.packageType,
      applied_entries: result.appliedEntries,
      imported_comments: result.importedComments,
      imported_terms: result.importedTerms,
      imported_contexts: result.importedContexts,
      imported_tasks: result.importedTasks,
      imported_members: result.importedMembers,
      imported_project_settings: result.importedProjectSettings,
      imported_events: result.importedEvents,
      content_integrity: validation.contentIntegrity,
      content_hash: manifest.content_hash ?? "",
      signature_status: validation.signatureStatus,
      dangerous_import: Boolean(options.allowDangerous),
      maintenance_confirmed: Boolean(options.confirmMaintenance),
      owner_credentials_confirmed: Boolean(options.confirmOwnerCredentials),
      imported_by: options.actor?.id ?? "",
    },
  };

  await ensureDirectory(root, "logs");
  await writeJsonl(root, "logs/events.jsonl", [...events, event]);
}

export async function exportChangePackage(
  userId: string,
  options: ExportChangePackageOptions,
): Promise<ExportedChangePackage> {
  const root = getProjectRoot();
  const project = await readJson<ProjectConfig>(root, "project.json");
  const payload: ChangePackagePayload = {
    entries: {},
    comments: {},
    terms: {},
    contexts: {},
    tasks: {},
    projectFiles: {},
    memberFiles: {},
    events: [],
  };

  if (options.mode === "task_changes") {
    if (!options.taskId) {
      throw new Error("请选择要导出的任务。");
    }

    const task = await loadTask(root, options.taskId);

    payload.entries = await collectTaskChangedEntries(root, task, userId);
    payload.comments = await collectComments(root, await loadTaskEntries(root, task), userId);
    payload.tasks = await collectTaskRows(root, task);
    payload.events = await collectEvents(root, getPackageEntries(payload.entries), userId);
  }

  if (options.mode === "user_changes") {
    payload.entries = await collectUserChangedEntries(root, project, userId);
    payload.comments = await collectComments(root, getPackageEntries(payload.entries), userId);
    payload.terms = await collectUserTerms(root, userId);
    payload.tasks = await collectUserTasks(root, userId);
    payload.events = await collectUserEvents(root, userId);
  }

  if (options.mode === "maintenance_changes") {
    payload.terms = await collectAllTerms(root);
    payload.contexts = await collectTextFiles(root, "contexts");
    payload.tasks = await collectAllTasks(root);
    payload.projectFiles = await collectProjectFiles(root);
    payload.memberFiles = await collectMemberFiles(root);
    payload.events = await collectAllEvents(root);
  }

  const summary = getPackageSummary(payload);

  if (!hasPackageContent(summary)) {
    throw new Error("当前范围内没有可导出的修改。");
  }

  const createdAt = nowIso();
  const contentHash = await calculateContentHash(payload);
  const manifest: ChangePackageManifest = {
    schema_version: 1,
    project_id: project.project_id,
    package_id: buildPackageId(userId, options.mode, createdAt, options.taskId),
    package_type: options.mode,
    user_id: userId,
    user_name: userId,
    task_id: options.mode === "task_changes" ? options.taskId : undefined,
    created_at: createdAt,
    changed_entries: summary.changed_entries,
    new_comments: summary.changed_comments,
    content_hash: contentHash,
    app_version: CHANGE_PACKAGE_APP_VERSION,
    source_project_version: String(project.schema_version),
    summary,
  };
  const signature = await createSignature(manifest);
  const files: ZipContent = {
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "entries/": null,
    "comments/": null,
    "terms/": null,
    "contexts/": null,
    "tasks/": null,
    "project/": null,
    "members/": null,
    "logs/": null,
  };

  for (const [path, rows] of Object.entries(payload.entries)) {
    files[path] = stringifyJsonl(rows);
  }

  for (const [path, rows] of Object.entries(payload.comments)) {
    files[path] = stringifyJsonl(rows);
  }

  for (const [path, rows] of Object.entries(payload.terms)) {
    files[path] = stringifyJsonl(rows);
  }

  for (const [path, content] of Object.entries(payload.contexts)) {
    files[path] = content;
  }

  for (const [path, rows] of Object.entries(payload.tasks)) {
    files[path] = stringifyJsonl(rows);
  }

  for (const [path, content] of Object.entries(payload.projectFiles)) {
    files[path] = content;
  }

  for (const [path, content] of Object.entries(payload.memberFiles)) {
    files[path] = content;
  }

  if (payload.events.length > 0) {
    files["logs/events.jsonl"] = stringifyJsonl(payload.events);
  }

  if (signature) {
    files["signature.json"] = `${JSON.stringify(signature, null, 2)}\n`;
  }

  return {
    fileName: buildFileName(userId, options.mode, createdAt, options.taskId),
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
    const terms = parsePackageJsonl<Term>(files, "terms/");
    const tasks = parsePackageJsonl<Task>(files, "tasks/");
    const contexts = Object.fromEntries(
      Object.entries(files).filter(
        ([path]) => path.startsWith("contexts/") && !path.endsWith("/"),
      ),
    );
    const projectFiles = Object.fromEntries(
      Object.entries(files).filter(
        ([path]) => path.startsWith("project/") && !path.endsWith("/"),
      ),
    );
    const memberFiles = Object.fromEntries(
      Object.entries(files).filter(
        ([path]) => path.startsWith("members/") && !path.endsWith("/"),
      ),
    );
    const events = files["logs/events.jsonl"]
      ? parseJsonl<ProjectEvent>(files["logs/events.jsonl"])
      : [];

    return {
      manifest,
      signature,
      files,
      entries,
      comments,
      terms,
      contexts,
      tasks,
      projectFiles,
      memberFiles,
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
  const packageType = getPackageType(changePackage.manifest);
  const payload: ChangePackagePayload = {
    entries: changePackage.entries,
    comments: changePackage.comments,
    terms: changePackage.terms,
    contexts: changePackage.contexts,
    tasks: changePackage.tasks,
    projectFiles: changePackage.projectFiles,
    memberFiles: changePackage.memberFiles,
    events: changePackage.events,
  };
  const calculatedContentHash = await calculateContentHash(payload);
  const contentIntegrity: ContentIntegrityStatus = changePackage.manifest.content_hash
    ? changePackage.manifest.content_hash === calculatedContentHash
      ? "passed"
      : "failed"
    : "legacy_unchecked";
  const signatureResult = await verifySignatureStatus(changePackage, members);
  const packageMembers = parseMembersFromPackage(changePackage.memberFiles);
  const packageProject = parseProjectFromPackage(changePackage.projectFiles);
  const summary = getPackageSummary(payload);
  const changedMemberRecords =
    packageMembers.length > 0 ? countChangedMemberRecords(members, packageMembers) : 0;
  const projectChanged =
    packageProject && stableStringify(project) !== stableStringify(packageProject)
      ? 1
      : 0;
  const credentialChanges = packageMembers.filter((member) =>
    memberCredentialsChanged(
      members.find((currentMember) => currentMember.id === member.id),
      member,
    ),
  ).length;
  const hasOwnerCredentialChange = detectOwnerCredentialChange(members, packageMembers);
  const hasOwnerPromotion = detectOwnerRolePromotion(members, packageMembers);
  const normalizedSummary: ChangePackageSummary = {
    ...summary,
    changed_members: Math.max(summary.changed_members, changedMemberRecords),
    changed_project_settings: Math.max(
      summary.changed_project_settings,
      projectChanged,
    ),
    changed_credentials: Math.max(summary.changed_credentials, credentialChanges),
  };
  const requiresMaintenanceConfirmation =
    packageType === "maintenance_changes" ||
    normalizedSummary.changed_members > 0 ||
    normalizedSummary.changed_project_settings > 0 ||
    normalizedSummary.changed_credentials > 0;
  const requiresOwnerCredentialConfirmation =
    hasOwnerCredentialChange || hasOwnerPromotion;
  const riskLevel: ChangePackageRiskLevel =
    contentIntegrity === "failed" || requiresOwnerCredentialConfirmation
      ? "danger"
      : requiresMaintenanceConfirmation
        ? "maintenance"
        : "normal";
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
    packageType,
    summary: normalizedSummary,
    riskLevel,
    canImportNormally:
      packageProjectId === project.project_id && contentIntegrity !== "failed",
    requiresDangerousImport:
      packageProjectId === project.project_id && contentIntegrity === "failed",
    requiresMaintenanceConfirmation,
    requiresOwnerCredentialConfirmation,
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
    termCount: countRecordRows(changePackage.terms),
    contextCount: countRecordFiles(changePackage.contexts),
    taskCount: countRecordRows(changePackage.tasks),
    memberChangeCount: validation.summary.changed_members,
    credentialChangeCount: validation.summary.changed_credentials,
    hasProjectSettingsChange: validation.summary.changed_project_settings > 0,
    logCount: changePackage.events.length,
    entryPaths: Object.keys(changePackage.entries),
    validation,
    contentHashShort: shortHash(changePackage.manifest.content_hash),
    isLegacyPackage:
      getPackageType(changePackage.manifest) === "legacy" ||
      !changePackage.manifest.package_id ||
      !changePackage.manifest.content_hash,
    packageType: validation.packageType,
    riskLevel: validation.riskLevel,
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

  if (!canImportChangePackage(options.actor)) {
    throw new Error("当前成员没有导入修改包的权限。");
  }

  if (
    validation.packageType === "maintenance_changes" &&
    !canImportMaintenanceChangePackage(options.actor)
  ) {
    throw new Error("当前成员没有导入项目维护修改的权限。");
  }

  if (validation.requiresMaintenanceConfirmation && !options.confirmMaintenance) {
    throw new Error("项目维护修改需要确认后才能导入。");
  }

  if (
    validation.requiresOwnerCredentialConfirmation &&
    !options.confirmOwnerCredentials
  ) {
    throw new Error("负责人账号或权限变更需要额外确认。");
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
  let importedTerms = 0;
  let importedContexts = 0;
  let importedTasks = 0;
  let importedMembers = 0;
  let importedProjectSettings = 0;
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

  for (const [path, packageTerms] of Object.entries(changePackage.terms)) {
    const existingTerms = (await fileExists(root, path))
      ? await readJsonl<Term>(root, path)
      : [];
    const result = mergeRowsById(existingTerms, packageTerms);

    if (result.imported > 0) {
      await ensureDirectory(root, getDirectoryPath(path));
      await writeJsonl(root, path, result.rows);
      importedTerms += result.imported;
    }
  }

  for (const [path, packageTasks] of Object.entries(changePackage.tasks)) {
    const existingTasks = (await fileExists(root, path))
      ? await readJsonl<Task>(root, path)
      : [];
    const result = mergeRowsById(existingTasks, packageTasks);

    if (result.imported > 0) {
      await ensureDirectory(root, getDirectoryPath(path));
      await writeJsonl(root, path, result.rows);
      importedTasks += result.imported;
    }
  }

  for (const [path, content] of Object.entries(changePackage.contexts)) {
    await ensureDirectory(root, getDirectoryPath(path));
    await writeTextFile(root, path, content);
    importedContexts += 1;
  }

  for (const [path, content] of Object.entries(changePackage.projectFiles)) {
    if (path === "project/project.json") {
      await writeTextFile(root, "project.json", content);
      importedProjectSettings += 1;
    }
  }

  for (const [path, content] of Object.entries(changePackage.memberFiles)) {
    if (path === "members/members.json") {
      await writeTextFile(root, "members.json", content);
      importedMembers += 1;
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
    importedTerms,
    importedContexts,
    importedTasks,
    importedMembers,
    importedProjectSettings,
    importedEvents,
  };

  await appendImportLog(changePackage.manifest, result, validation, options);

  return result;
}
