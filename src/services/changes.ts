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
import {
  applyEntryWorkflowOperation,
  applyEntryTargetChange,
  normalizeEntries,
  normalizeEntry,
  type EntryWorkflowOperation,
} from "../model/status";
import { cacheEntriesForFile } from "./entries";
import {
  isValidTimeZone,
  normalizeInstant,
  nowIso,
  utcDateKey,
} from "../utils/time";
import { createId } from "../utils/id";
import { createZip, readZip } from "../utils/zip";
import { parseJsonl, stringifyJsonl } from "../utils/jsonl";
import { APP_VERSION } from "../utils/appVersion";
import {
  readLocalStorageItem,
  writeLocalStorageItem,
} from "../utils/browserStorage";
import type { ZipContent } from "../utils/zip";
import type { ProjectDirectoryHandle } from "./projectFs";
import {
  createProjectStorage,
  type ProjectStorage,
} from "./projectStorage";
import { createProjectWritePlan } from "./projectWritePlan";
import {
  createEntryVersionEvent,
  isEntryVersionEvent,
  type EntryVersionEvent,
} from "./history";
import { getSigningPrivateKeyForMember } from "./keyManager";
import {
  CHANGE_PACKAGE_SIGNATURE_ALGORITHM,
  shortHash,
  signTextWithPrivateKey,
  stableStringify,
  verifyTextSignature,
} from "./crypto";
import {
  calculateChangePackageContentHash,
  type ChangePackagePayload,
} from "./changePackageHash";
import {
  PERMISSION_ACTIONS,
} from "../model/permissions";
import {
  assertCan,
  canDangerousImportChangePackage,
  canExportMemberChangePackage,
  canExportProjectUpdatePackage,
  canImportMemberChangePackage,
  canImportMaintenanceChangePackage,
  canImportProjectUpdatePackage,
  setPermissionProject,
} from "./permissions";

export type ExportChangePackageMode =
  | "member_changes"
  | "task_changes"
  | "maintenance_changes"
  | "project_update";

export interface ExportChangePackageOptions {
  mode: ExportChangePackageMode;
  taskId?: string;
  sign?: boolean;
  actor?: Member | null;
}

export interface ExportedChangePackage {
  fileName: string;
  blob: Blob;
  manifest: ChangePackageManifest;
  signature?: ChangePackageSignature;
  completion:
    | { kind: "none" }
    | {
        kind: "member_changes";
        projectId: string;
        userId: string;
        baseRevision: string;
        contentHash: string;
      }
    | {
        kind: "project_update";
        projectId: string;
        baseRevision: string;
        targetRevision: string;
        projectJson: string;
      };
}

export interface ReadChangePackage {
  manifest: ChangePackageManifest;
  signature?: ChangePackageSignature;
  files: Record<string, string>;
  entries: Record<string, Entry[]>;
  comments: Record<string, Comment[]>;
  terms: Record<string, Term[]>;
  contexts: Record<string, string>;
  sourceFiles: Record<string, string>;
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
  sourceFileCount: number;
  taskCount: number;
  memberChangeCount: number;
  credentialChangeCount: number;
  hasProjectSettingsChange: boolean;
  logCount: number;
  entryPaths: string[];
  validation: ChangePackageValidation;
  contentHashShort: string;
  signatureKeyId: string;
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
  reasons: EntryConflictReason[];
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
  importedSourceFiles: number;
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

const SUPPORTED_CHANGE_PACKAGE_SCHEMA_VERSION = 1;
type EntryConflictReason =
  | "target"
  | "status"
  | "translated_by"
  | "proofread_by"
  | "proofread_count"
  | "reviewed_by";
type EntryProtectedField =
  | "id"
  | "file_id"
  | "index"
  | "key"
  | "speaker"
  | "source"
  | "context"
  | "disputed"
  | "dispute_reason"
  | "dispute_resolved_at"
  | "dispute_resolved_by"
  | "assignee"
  | "word_count"
  | "hidden"
  | "locked";
type TaskProtectedField =
  | "type"
  | "title"
  | "description"
  | "file_id"
  | "range_start"
  | "range_end"
  | "entry_ids"
  | "assignee"
  | "target"
  | "submit_method"
  | "proofread_round"
  | "created_by"
  | "created_at"
  | "due_at"
  | "due_time_zone";

const ENTRY_CONFLICT_FIELDS = [
  "target",
  "status",
  "translated_by",
  "proofread_by",
  "proofread_count",
  "reviewed_by",
] as const satisfies readonly EntryConflictReason[];
const ENTRY_PROTECTED_FIELDS = [
  "id",
  "file_id",
  "index",
  "key",
  "speaker",
  "source",
  "context",
  "disputed",
  "dispute_reason",
  "dispute_resolved_at",
  "dispute_resolved_by",
  "assignee",
  "word_count",
  "hidden",
  "locked",
] as const satisfies readonly EntryProtectedField[];
const TASK_PROTECTED_FIELDS = [
  "type",
  "title",
  "description",
  "file_id",
  "range_start",
  "range_end",
  "entry_ids",
  "assignee",
  "target",
  "submit_method",
  "proofread_round",
  "created_by",
  "created_at",
  "due_at",
  "due_time_zone",
] as const satisfies readonly TaskProtectedField[];
const EMPTY_SUMMARY: ChangePackageSummary = {
  changed_entries: 0,
  changed_comments: 0,
  changed_terms: 0,
  changed_contexts: 0,
  changed_tasks: 0,
  changed_source_files: 0,
  changed_members: 0,
  changed_project_settings: 0,
  changed_credentials: 0,
  log_events: 0,
};

let currentProjectStorage: ProjectStorage | null = null;
const MEMBER_CHANGE_MARKER_PREFIX = "textile.memberChangeExport";

export function setChangesProjectRoot(root: ProjectDirectoryHandle): void {
  setChangesProjectStorage(createProjectStorage(root));
}

export function setChangesProjectStorage(storage: ProjectStorage): void {
  currentProjectStorage = storage;
}

function getProjectStorage(): ProjectStorage {
  if (!currentProjectStorage) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectStorage;
}

function createEmptySummary(): ChangePackageSummary {
  return { ...EMPTY_SUMMARY };
}

function getPackageType(manifest: ChangePackageManifest): ChangePackageType {
  return manifest.package_type ?? "legacy";
}

function getExportMarkerKey(projectId: string, userId: string, revision: string): string {
  return `${MEMBER_CHANGE_MARKER_PREFIX}.${projectId}.${userId}.${revision}`;
}

function readExportedMemberChangeHash(
  projectId: string,
  userId: string,
  revision: string,
): string | null {
  return readLocalStorageItem(getExportMarkerKey(projectId, userId, revision));
}

function storeExportedMemberChangeHash(
  projectId: string,
  userId: string,
  revision: string,
  contentHash: string,
): void {
  writeLocalStorageItem(getExportMarkerKey(projectId, userId, revision), contentHash);
}

function isMemberChangePackage(packageType: ChangePackageType): boolean {
  return (
    packageType === "member_changes" ||
    packageType === "user_changes" ||
    packageType === "task_changes" ||
    packageType === "legacy"
  );
}

function isProjectUpdatePackage(packageType: ChangePackageType): boolean {
  return packageType === "project_update";
}

function getProjectRevision(project: ProjectConfig): string {
  return project.revision || project.revision_hash || `schema-${project.schema_version}`;
}

function createNextProjectRevision(projectId: string, createdAt = nowIso()): string {
  return createId(`rev_${projectId}_${utcDateKey(createdAt).replace(/-/g, "")}`);
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
    changed_source_files: countRecordFiles(payload.sourceFiles),
    changed_members: countRecordFiles(payload.memberFiles),
    changed_project_settings: countRecordFiles(payload.projectFiles),
    changed_credentials: countPackageCredentials(payload.memberFiles),
    log_events: payload.events.length,
  };
}

function hasPackageContent(summary: ChangePackageSummary): boolean {
  return Object.values(summary).some((count) => count > 0);
}

function buildSignaturePayload(
  manifest: ChangePackageManifest,
  contentHash: string,
): string {
  return stableStringify({ manifest, content_hash: contentHash });
}

function buildPackageId(
  userId: string,
  packageType: ChangePackageType,
  createdAt: string,
  taskId?: string,
): string {
  const date = utcDateKey(createdAt).replace(/-/g, "");
  const scope = taskId ? taskId : packageType;

  return createId(`change_${date}_${userId}_${scope}`);
}

function readSignature(files: Record<string, string>): ChangePackageSignature | undefined {
  const text = files["signature.json"];

  if (!text) {
    return undefined;
  }

  return JSON.parse(text) as ChangePackageSignature;
}

async function loadProjectMembers(storage: ProjectStorage): Promise<Member[]> {
  const file = await storage.readJson<{ members: Member[] }>("members.json");

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

function sanitizeMemberForProjectUpdate(member: Member): Member {
  const publicMember = { ...member };

  delete publicMember.password_hash;
  delete publicMember.password_salt;
  delete publicMember.password_updated_at;

  return publicMember;
}

function mergePublicMembersWithLocalCredentials(
  currentMembers: Member[],
  packageMembers: Member[],
): Member[] {
  return packageMembers.map((packageMember) => {
    const currentMember = currentMembers.find((member) => member.id === packageMember.id);

    if (!currentMember) {
      return sanitizeMemberForProjectUpdate(packageMember);
    }

    return {
      ...sanitizeMemberForProjectUpdate(packageMember),
      password_hash: currentMember.password_hash,
      password_salt: currentMember.password_salt,
      password_updated_at: currentMember.password_updated_at,
    };
  });
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
  if (!hasCredentialFields(packageMember)) {
    return false;
  }

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

  if (validation.packageType === "project_update") {
    messages.push("这是负责人发布的项目更新包，会同步项目进度、成员公开信息和合并后的内容，不会覆盖本机密码或私钥。");
  }

  if (validation.summary.changed_project_settings > 0) {
    messages.push("修改包包含项目设置变更，导入前请确认来源可靠。");
  }

  if (validation.summary.changed_members > 0 && validation.packageType !== "project_update") {
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
    changePackage.signature.content_hash === changePackage.manifest.content_hash &&
    (!changePackage.signature.key_id ||
      changePackage.signature.key_id === signer.key_id) &&
    !signer.key_revoked_at &&
    changePackage.signature.algorithm === CHANGE_PACKAGE_SIGNATURE_ALGORITHM &&
    (await verifyTextSignature(
      signer.public_key,
      buildSignaturePayload(
        changePackage.manifest,
        changePackage.manifest.content_hash ?? "",
      ),
      changePackage.signature.signature,
    ));

  return {
    signatureStatus: isValid ? "valid" : "invalid",
    signerName: signer.name,
  };
}

async function createSignature(
  manifest: ChangePackageManifest,
  signer?: Member,
): Promise<ChangePackageSignature | undefined> {
  const privateKey = getSigningPrivateKeyForMember(manifest.user_id);

  if (!privateKey || !manifest.content_hash) {
    return undefined;
  }

  return {
    schema_version: 1,
    package_id: manifest.package_id,
    user_id: manifest.user_id,
    content_hash: manifest.content_hash,
    algorithm: CHANGE_PACKAGE_SIGNATURE_ALGORITHM,
    signed_at: nowIso(),
    signature: await signTextWithPrivateKey(
      privateKey,
      buildSignaturePayload(manifest, manifest.content_hash),
    ),
    key_id: signer?.key_id,
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

async function loadTask(storage: ProjectStorage, taskId: string): Promise<Task> {
  const tasks = await storage.readJsonl<Task>("tasks/tasks.jsonl");
  const task = tasks.find((row) => row.id === taskId);

  if (!task) {
    throw new Error("没有找到要导出的任务。请重新打开项目后再试。");
  }

  return task;
}

async function loadTaskEntries(
  storage: ProjectStorage,
  task: Task,
): Promise<Entry[]> {
  const entryDirectory = `entries/${task.file_id}`;
  const fileNames = await storage.listFiles(entryDirectory);
  const chunkFiles = fileNames
    .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const groups = await Promise.all(
    chunkFiles.map(async (fileName) => {
      const path = `${entryDirectory}/${fileName}`;
      const entries = await storage.readJsonl<Entry>(path);

      return {
        path,
        entries: normalizeEntries(entries).filter((entry) => isEntryInTask(entry, task)),
      };
    }),
  );

  return groups.flatMap((group) => group.entries);
}

async function collectProjectEntryGroups(
  storage: ProjectStorage,
  project: ProjectConfig,
): Promise<{ path: string; entries: Entry[] }[]> {
  const groups: { path: string; entries: Entry[] }[] = [];

  for (const file of project.files) {
    if (!(await storage.fileExists(file.entries_path))) {
      continue;
    }

    const fileNames = await storage.listFiles(file.entries_path);
    const chunkFiles = fileNames
      .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
      .sort((a, b) => a.localeCompare(b));

    for (const chunkFile of chunkFiles) {
      const path = `${file.entries_path}/${chunkFile}`;

      groups.push({
        path,
        entries: normalizeEntries(await storage.readJsonl<Entry>(path)),
      });
    }
  }

  return groups;
}

async function collectUserChangedEntries(
  storage: ProjectStorage,
  project: ProjectConfig,
  userId: string,
): Promise<Record<string, Entry[]>> {
  const changedEntries: Record<string, Entry[]> = {};
  const groups = await collectProjectEntryGroups(storage, project);

  for (const group of groups) {
    const rows = group.entries.filter((entry) => entry.updated_by === userId);

    if (rows.length > 0) {
      changedEntries[group.path] = rows;
    }
  }

  return changedEntries;
}

async function collectAllEntries(
  storage: ProjectStorage,
  project: ProjectConfig,
): Promise<Record<string, Entry[]>> {
  const entries: Record<string, Entry[]> = {};
  const groups = await collectProjectEntryGroups(storage, project);

  for (const group of groups) {
    entries[group.path] = group.entries;
  }

  return entries;
}

async function collectTaskChangedEntries(
  storage: ProjectStorage,
  task: Task,
  userId: string,
): Promise<Record<string, Entry[]>> {
  const entryDirectory = `entries/${task.file_id}`;
  const fileNames = await storage.listFiles(entryDirectory);
  const chunkFiles = fileNames
    .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const changedEntries: Record<string, Entry[]> = {};

  for (const chunkFile of chunkFiles) {
    const path = `${entryDirectory}/${chunkFile}`;
    const entries = normalizeEntries(await storage.readJsonl<Entry>(path));
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
  storage: ProjectStorage,
  entries: Entry[],
  userId: string,
): Promise<Record<string, Comment[]>> {
  const comments: Record<string, Comment[]> = {};

  for (const entry of entries) {
    const path = commentPathForEntry(entry);

    if (!(await storage.fileExists(path))) {
      continue;
    }

    const rows = (await storage.readJsonl<Comment>(path)).filter(
      (comment) => comment.user_id === userId,
    );

    if (rows.length > 0) {
      comments[path] = rows;
    }
  }

  return comments;
}

async function collectUserComments(
  storage: ProjectStorage,
  userId: string,
): Promise<Record<string, Comment[]>> {
  const comments: Record<string, Comment[]> = {};

  if (!(await storage.fileExists("comments"))) {
    return comments;
  }

  const fileIds = await storage.listFiles("comments");

  for (const fileId of fileIds) {
    const directory = `comments/${fileId}`;
    const fileNames = await storage.listFiles(directory);

    for (const fileName of fileNames.filter((name) => name.endsWith(".jsonl"))) {
      const path = `${directory}/${fileName}`;
      const rows = (await storage.readJsonl<Comment>(path)).filter(
        (comment) => comment.user_id === userId,
      );

      if (rows.length > 0) {
        comments[path] = rows;
      }
    }
  }

  return comments;
}

async function collectAllComments(storage: ProjectStorage): Promise<Record<string, Comment[]>> {
  const comments: Record<string, Comment[]> = {};

  if (!(await storage.fileExists("comments"))) {
    return comments;
  }

  const fileIds = await storage.listFiles("comments");

  for (const fileId of fileIds) {
    const directory = `comments/${fileId}`;
    const fileNames = await storage.listFiles(directory);

    for (const fileName of fileNames.filter((name) => name.endsWith(".jsonl"))) {
      const path = `${directory}/${fileName}`;
      comments[path] = await storage.readJsonl<Comment>(path);
    }
  }

  return comments;
}

async function collectUserTerms(
  storage: ProjectStorage,
  userId: string,
): Promise<Record<string, Term[]>> {
  if (!(await storage.fileExists("terms/terms.jsonl"))) {
    return {};
  }

  const rows = (await storage.readJsonl<Term>("terms/terms.jsonl")).filter(
    (term) => term.created_by === userId,
  );

  return rows.length > 0 ? { "terms/terms.jsonl": rows } : {};
}

async function collectAllTerms(storage: ProjectStorage): Promise<Record<string, Term[]>> {
  if (!(await storage.fileExists("terms/terms.jsonl"))) {
    return {};
  }

  return { "terms/terms.jsonl": await storage.readJsonl<Term>("terms/terms.jsonl") };
}

async function collectUserTasks(
  storage: ProjectStorage,
  userId: string,
): Promise<Record<string, Task[]>> {
  if (!(await storage.fileExists("tasks/tasks.jsonl"))) {
    return {};
  }

  const rows = (await storage.readJsonl<Task>("tasks/tasks.jsonl")).filter(
    (task) => task.created_by === userId || task.assignee === userId,
  );

  return rows.length > 0 ? { "tasks/tasks.jsonl": rows } : {};
}

async function collectUserCreatedTasks(
  storage: ProjectStorage,
  userId: string,
): Promise<Record<string, Task[]>> {
  if (!(await storage.fileExists("tasks/tasks.jsonl"))) {
    return {};
  }

  const rows = (await storage.readJsonl<Task>("tasks/tasks.jsonl")).filter(
    (task) => task.created_by === userId,
  );

  return rows.length > 0 ? { "tasks/tasks.jsonl": rows } : {};
}

async function collectAllTasks(storage: ProjectStorage): Promise<Record<string, Task[]>> {
  if (!(await storage.fileExists("tasks/tasks.jsonl"))) {
    return {};
  }

  return { "tasks/tasks.jsonl": await storage.readJsonl<Task>("tasks/tasks.jsonl") };
}

async function collectTaskRows(storage: ProjectStorage, task: Task): Promise<Record<string, Task[]>> {
  return (await storage.fileExists("tasks/tasks.jsonl"))
    ? { "tasks/tasks.jsonl": [task] }
    : {};
}

async function collectEvents(
  storage: ProjectStorage,
  taskEntries: Entry[],
  userId: string,
): Promise<ProjectEvent[]> {
  if (!(await storage.fileExists("logs/events.jsonl"))) {
    return [];
  }

  const taskEntryIds = new Set(taskEntries.map((entry) => entry.id));

  return (await storage.readJsonl<ProjectEvent>("logs/events.jsonl")).filter(
    (event) =>
      event.user_id === userId &&
      (!event.entry_id || taskEntryIds.has(event.entry_id)),
  );
}

async function collectUserEvents(
  storage: ProjectStorage,
  userId: string,
): Promise<ProjectEvent[]> {
  if (!(await storage.fileExists("logs/events.jsonl"))) {
    return [];
  }

  return (await storage.readJsonl<ProjectEvent>("logs/events.jsonl")).filter(
    (event) => event.user_id === userId,
  );
}

async function collectAllEvents(storage: ProjectStorage): Promise<ProjectEvent[]> {
  if (!(await storage.fileExists("logs/events.jsonl"))) {
    return [];
  }

  return storage.readJsonl<ProjectEvent>("logs/events.jsonl");
}

async function collectTextFiles(
  storage: ProjectStorage,
  directoryPath: string,
): Promise<Record<string, string>> {
  if (!(await storage.fileExists(directoryPath))) {
    return {};
  }

  const files: Record<string, string> = {};
  const names = await storage.listFiles(directoryPath);

  for (const name of names) {
    const path = `${directoryPath}/${name}`;

    try {
      Object.assign(files, await collectTextFiles(storage, path));
    } catch {
      files[path] = await storage.readText(path);
    }
  }

  return files;
}

async function collectProjectFiles(storage: ProjectStorage): Promise<Record<string, string>> {
  return {
    "project/project.json": await storage.readText("project.json"),
  };
}

function collectProjectUpdateProjectFile(
  project: ProjectConfig,
  targetRevision: string,
  updatedAt: string,
): Record<string, string> {
  return {
    "project/project.json": `${JSON.stringify(
      {
        ...project,
        revision: targetRevision,
        revision_hash: targetRevision,
        updated_at: updatedAt,
      },
      null,
      2,
    )}\n`,
  };
}

async function collectMemberFiles(storage: ProjectStorage): Promise<Record<string, string>> {
  return {
    "members/members.json": await storage.readText("members.json"),
  };
}

async function collectPublicMemberFiles(storage: ProjectStorage): Promise<Record<string, string>> {
  const membersFile = await storage.readJson<{
    schema_version?: number;
    members?: Member[];
  }>("members.json");

  return {
    "members/members.json": `${JSON.stringify(
      {
        schema_version: membersFile.schema_version ?? 1,
        members: (membersFile.members ?? []).map(sanitizeMemberForProjectUpdate),
      },
      null,
      2,
    )}\n`,
  };
}

function buildFileName(
  userId: string,
  packageType: ChangePackageType,
  createdAt: string,
  taskId?: string,
): string {
  const date = utcDateKey(createdAt).replace(/-/g, "");

  const scope = taskId ? taskId : packageType;

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

function samePackageValue(left: unknown, right: unknown): boolean {
  return stableStringify(left ?? null) === stableStringify(right ?? null);
}

function assertOrdinaryEntryPackageFields(
  mainEntry: Entry,
  packageEntry: Entry,
): void {
  const normalizedPackageEntry = normalizeEntry(packageEntry);

  for (const field of ENTRY_PROTECTED_FIELDS) {
    if (!samePackageValue(mainEntry[field], normalizedPackageEntry[field])) {
      throw new Error(`普通修改包不能修改词条受保护字段：${field}。`);
    }
  }
}

function assertOrdinaryTaskPackageFields(
  mainTask: Task,
  packageTask: Task,
): void {
  for (const field of TASK_PROTECTED_FIELDS) {
    if (!samePackageValue(mainTask[field], packageTask[field])) {
      throw new Error(`普通修改包不能修改任务受保护字段：${field}。`);
    }
  }
}

function hasEntryConflict(
  mainEntry: Entry,
  packageEntry: Entry,
  useOrdinarySafeguards: boolean,
): EntryConflictReason[] {
  if (useOrdinarySafeguards) {
    assertOrdinaryEntryPackageFields(mainEntry, packageEntry);
  }

  const normalizedPackageEntry = normalizeEntry(packageEntry);

  return ENTRY_CONFLICT_FIELDS.filter(
    (field) => !samePackageValue(mainEntry[field], normalizedPackageEntry[field]),
  );
}

function mergeOrdinaryPackageEntry(
  currentEntry: Entry,
  packageEntry: Entry,
  userId: string,
  operation: EntryWorkflowOperation,
  updatedAt = nowIso(),
): Entry {
  const normalizedPackageEntry = normalizeEntry(packageEntry);

  assertOrdinaryEntryPackageFields(currentEntry, packageEntry);

  if (normalizedPackageEntry.target !== currentEntry.target) {
    if (operation === "translation_edit") {
      return applyEntryWorkflowOperation(currentEntry, {
        userId,
        target: normalizedPackageEntry.target,
        operation,
        updatedAt,
      });
    }

    if (!normalizedPackageEntry.target.trim()) {
      throw new Error("校对或审核记录不能把空译文标记为流程通过。");
    }

    return normalizeEntry({
      ...currentEntry,
      target: normalizedPackageEntry.target,
      status: normalizedPackageEntry.status,
      translated_by: normalizedPackageEntry.translated_by || userId,
      proofread_by: normalizedPackageEntry.proofread_by,
      proofread_count: normalizedPackageEntry.proofread_count,
      reviewed_by: normalizedPackageEntry.reviewed_by,
      updated_at: updatedAt,
      updated_by: userId,
    });
  }

  return normalizeEntry({
    ...currentEntry,
    status: normalizedPackageEntry.status,
    translated_by: normalizedPackageEntry.translated_by,
    proofread_by: normalizedPackageEntry.proofread_by,
    proofread_count: normalizedPackageEntry.proofread_count,
    reviewed_by: normalizedPackageEntry.reviewed_by,
    updated_at: updatedAt,
    updated_by: userId,
  });
}

function inferEntryOperationFromEvent(
  event: EntryVersionEvent | undefined,
): EntryWorkflowOperation {
  if (!event) {
    return "translation_edit";
  }

  const operation = event.detail.operation;

  if (
    operation === "proofread" ||
    operation === "review" ||
    operation === "rollback_to_translated" ||
    operation === "rollback_to_proofread" ||
    operation === "translation_edit"
  ) {
    return operation;
  }

  const beforeProofreadCount = event.detail.before_proofread_count ?? 0;
  const afterProofreadCount = event.detail.after_proofread_count ?? 0;

  if (
    event.detail.after_status === "reviewed" &&
    (event.detail.before_status !== "reviewed" ||
      event.detail.after_reviewed_by !== event.detail.before_reviewed_by)
  ) {
    return "review";
  }

  if (
    afterProofreadCount > beforeProofreadCount ||
    (event.detail.after_status === "proofread" &&
      event.detail.before_status !== "proofread")
  ) {
    return "proofread";
  }

  if (
    event.detail.before_status === "reviewed" &&
    event.detail.after_status === "proofread"
  ) {
    return "rollback_to_proofread";
  }

  if (
    event.detail.before_status === "proofread" &&
    event.detail.after_status === "translated"
  ) {
    return "rollback_to_translated";
  }

  return "translation_edit";
}

function findPackageEntryVersionEvent(
  events: ProjectEvent[],
  packageEntry: Entry,
): EntryVersionEvent | undefined {
  return [...events].reverse().find(
    (event): event is EntryVersionEvent =>
      isEntryVersionEvent(event) &&
      event.entry_id === packageEntry.id &&
      event.detail.after_target === packageEntry.target &&
      event.detail.after_status === packageEntry.status &&
      (event.detail.after_translated_by === undefined ||
        event.detail.after_translated_by === packageEntry.translated_by) &&
      (event.detail.after_proofread_by === undefined ||
        samePackageValue(
          event.detail.after_proofread_by,
          packageEntry.proofread_by,
        )) &&
      (event.detail.after_proofread_count === undefined ||
        event.detail.after_proofread_count === packageEntry.proofread_count) &&
      (event.detail.after_reviewed_by === undefined ||
        event.detail.after_reviewed_by === packageEntry.reviewed_by),
  );
}

function entryWorkflowChanged(before: Entry, after: Entry): boolean {
  return (
    before.target !== after.target ||
    before.status !== after.status ||
    before.translated_by !== after.translated_by ||
    before.proofread_count !== after.proofread_count ||
    before.reviewed_by !== after.reviewed_by ||
    stableStringify(before.proofread_by ?? []) !==
      stableStringify(after.proofread_by ?? [])
  );
}

function mergeOrdinaryPackageTasks(
  existingTasks: Task[],
  packageTasks: Task[],
): { rows: Task[]; imported: number } {
  const nextRows = [...existingTasks];
  let imported = 0;
  const updatedAt = nowIso();

  for (const packageTask of packageTasks) {
    const index = nextRows.findIndex((task) => task.id === packageTask.id);

    if (index < 0) {
      throw new Error("普通修改包不能新增任务，只能更新已有任务的执行状态。");
    }

    const currentTask = nextRows[index]!;

    assertOrdinaryTaskPackageFields(currentTask, packageTask);

    if (currentTask.status !== packageTask.status) {
      nextRows[index] = {
        ...currentTask,
        status: packageTask.status,
        updated_at: updatedAt,
      };
      imported += 1;
    }
  }

  return { rows: nextRows, imported };
}

function normalizeImportedTaskDeadline(
  currentTask: Task | undefined,
  packageTask: Task,
): Task {
  if (
    currentTask &&
    samePackageValue(currentTask.due_at, packageTask.due_at) &&
    samePackageValue(currentTask.due_time_zone, packageTask.due_time_zone)
  ) {
    return packageTask;
  }

  if (!packageTask.due_at) {
    return {
      ...packageTask,
      due_at: "",
      due_time_zone: undefined,
    };
  }

  const dueAt = normalizeInstant(packageTask.due_at);

  if (!dueAt) {
    throw new Error(
      `任务 ${packageTask.id} 的截止时间未记录明确时区，不能导入。请先在来源项目中确认时区。`,
    );
  }

  if (!isValidTimeZone(packageTask.due_time_zone ?? "")) {
    throw new Error(
      `任务 ${packageTask.id} 的截止时间缺少有效 IANA 时区，不能导入。`,
    );
  }

  return {
    ...packageTask,
    due_at: dueAt,
    due_time_zone: packageTask.due_time_zone,
  };
}

function findResolution(
  resolutions: ConflictResolution[],
  entryId: string,
): ConflictResolution | undefined {
  return resolutions.find((resolution) => resolution.entryId === entryId);
}

async function loadCurrentEntries(path: string): Promise<Entry[]> {
  return normalizeEntries(await getProjectStorage().readJsonl<Entry>(path));
}

function getSupportedManifestSchemaVersion(
  manifest: ChangePackageManifest,
): number {
  const version = Number(manifest.schema_version ?? 1);

  return Number.isInteger(version) ? version : 0;
}

function assertChangePackageManifestForImport(
  changePackage: ReadChangePackage,
): void {
  const manifest = changePackage.manifest;

  if (!manifest || typeof manifest !== "object") {
    throw new Error("修改包缺少 manifest，无法导入。");
  }

  if (!manifest.project_id) {
    throw new Error("修改包 manifest 缺少 project_id，无法导入。");
  }

  if (!manifest.user_id) {
    throw new Error("修改包 manifest 缺少 user_id，无法导入。");
  }

  const schemaVersion = getSupportedManifestSchemaVersion(manifest);

  if (
    schemaVersion < 1 ||
    schemaVersion > SUPPORTED_CHANGE_PACKAGE_SCHEMA_VERSION
  ) {
    throw new Error(
      `修改包 schema_version ${manifest.schema_version} 暂不支持，无法导入。`,
    );
  }
}

function assertPackagePath(
  path: string,
  prefix: string,
  label: string,
  extension?: string,
): void {
  if (!path.startsWith(prefix) || path.endsWith("/")) {
    throw new Error(`${label}目标路径不正确：${path}`);
  }

  if (extension && !path.endsWith(extension)) {
    throw new Error(`${label}目标路径格式不正确：${path}`);
  }
}

async function assertJsonlTargetReadable<T>(
  storage: ProjectStorage,
  path: string,
  label: string,
  options: { mustExist?: boolean } = {},
): Promise<void> {
  try {
    const exists = await storage.fileExists(path);

    if (!exists) {
      if (options.mustExist) {
        throw new Error("目标文件不存在。");
      }

      await storage.fileExists(getDirectoryPath(path));
      return;
    }

    await storage.readJsonl<T>(path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "无法读取。";

    throw new Error(`${label}目标路径不可访问：${path}。${reason}`);
  }
}

async function assertTextTargetReadable(
  storage: ProjectStorage,
  path: string,
  label: string,
): Promise<void> {
  try {
    const exists = await storage.fileExists(path);

    if (exists) {
      await storage.readText(path);
    } else {
      await storage.fileExists(getDirectoryPath(path));
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "无法读取。";

    throw new Error(`${label}目标路径不可访问：${path}。${reason}`);
  }
}

async function precheckChangePackageImport(
  changePackage: ReadChangePackage,
  validation: ChangePackageValidation,
  conflicts: ChangeConflict[],
): Promise<void> {
  assertChangePackageManifestForImport(changePackage);

  if (validation.projectMatch !== "matched") {
    throw new Error("修改包不属于当前项目，无法导入。");
  }

  if (
    changePackage.manifest.content_hash &&
    !validation.calculatedContentHash
  ) {
    throw new Error("修改包内容校验尚未完成，无法导入。");
  }

  if (changePackage.signature && !validation.signatureStatus) {
    throw new Error("修改包签名状态尚未计算，无法导入。");
  }

  if (!Array.isArray(conflicts)) {
    throw new Error("修改包冲突列表尚未生成，无法导入。");
  }

  const storage = getProjectStorage();
  const isProjectUpdate = isProjectUpdatePackage(validation.packageType);

  for (const path of Object.keys(changePackage.entries)) {
    assertPackagePath(path, "entries/", "词条", ".jsonl");
    await assertJsonlTargetReadable<Entry>(storage, path, "词条", {
      mustExist: !isProjectUpdate,
    });
  }

  for (const path of Object.keys(changePackage.comments)) {
    assertPackagePath(path, "comments/", "评论", ".jsonl");
    await assertJsonlTargetReadable<Comment>(storage, path, "评论");
  }

  for (const path of Object.keys(changePackage.terms)) {
    assertPackagePath(path, "terms/", "术语", ".jsonl");
    await assertJsonlTargetReadable<Term>(storage, path, "术语");
  }

  for (const path of Object.keys(changePackage.tasks)) {
    assertPackagePath(path, "tasks/", "任务", ".jsonl");
    await assertJsonlTargetReadable<Task>(storage, path, "任务");
  }

  for (const path of Object.keys(changePackage.contexts)) {
    assertPackagePath(path, "contexts/", "上下文");
    await assertTextTargetReadable(storage, path, "上下文");
  }

  for (const path of Object.keys(changePackage.sourceFiles)) {
    assertPackagePath(path, "source/", "source");
    await assertTextTargetReadable(storage, path, "source");
  }

  for (const path of Object.keys(changePackage.projectFiles)) {
    if (path !== "project/project.json") {
      throw new Error(`项目设置目标路径不正确：${path}`);
    }

    JSON.parse(changePackage.projectFiles[path]);
    await assertTextTargetReadable(storage, "project.json", "项目设置");
  }

  for (const path of Object.keys(changePackage.memberFiles)) {
    if (path !== "members/members.json") {
      throw new Error(`成员目标路径不正确：${path}`);
    }

    JSON.parse(changePackage.memberFiles[path]);
    await assertTextTargetReadable(storage, "members.json", "成员");
  }

  if (changePackage.events.length > 0) {
    await assertJsonlTargetReadable<ProjectEvent>(
      storage,
      "logs/events.jsonl",
      "日志",
    );
  }
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

function createImportLogEvent(
  manifest: ChangePackageManifest,
  result: ApplyChangePackageResult,
  validation: ChangePackageValidation,
  options: ApplyChangePackageOptions,
): ProjectEvent {
  return {
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
      imported_source_files: result.importedSourceFiles,
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
}

export async function exportChangePackage(
  userId: string,
  options: ExportChangePackageOptions,
): Promise<ExportedChangePackage> {
  const storage = getProjectStorage();
  const project = await storage.readJson<ProjectConfig>("project.json");
  const actor = options.actor;
  const createdAt = nowIso();
  const baseRevision = getProjectRevision(project);
  const targetRevision =
    options.mode === "project_update"
      ? createNextProjectRevision(project.project_id, createdAt)
      : undefined;
  const manifestPackageType: ChangePackageType =
    options.mode === "task_changes" ? "member_changes" : options.mode;
  const payload: ChangePackagePayload = {
    entries: {},
    comments: {},
    terms: {},
    contexts: {},
    sourceFiles: {},
    tasks: {},
    projectFiles: {},
    memberFiles: {},
    events: [],
  };

  if (!actor?.id || actor.id !== userId) {
    throw new Error("Login required.");
  }

  if (options.mode === "task_changes") {
    if (!canExportMemberChangePackage(actor)) {
      throw new Error("当前成员没有导出普通修改包的权限。");
    }

    if (!options.taskId) {
      throw new Error("请选择要导出的任务。");
    }

    const task = await loadTask(storage, options.taskId);

    payload.entries = await collectTaskChangedEntries(storage, task, userId);
    payload.comments = await collectComments(storage, await loadTaskEntries(storage, task), userId);
    payload.tasks = await collectTaskRows(storage, task);
    payload.events = await collectEvents(storage, getPackageEntries(payload.entries), userId);
  }

  if (options.mode === "member_changes") {
    if (!canExportMemberChangePackage(actor)) {
      throw new Error("当前成员没有导出普通修改包的权限。");
    }

    payload.entries = await collectUserChangedEntries(storage, project, userId);
    payload.comments = await collectUserComments(storage, userId);
    payload.terms = await collectUserTerms(storage, userId);
    payload.tasks = await collectUserTasks(storage, userId);
    payload.events = await collectUserEvents(storage, userId);
  }

  if (options.mode === "maintenance_changes") {
    assertCan(
      actor,
      PERMISSION_ACTIONS.CHANGE_PACKAGE_EXPORT_MAINTENANCE,
      project,
      "当前成员没有导出维护修改包的权限。",
    );

    payload.terms = await collectAllTerms(storage);
    payload.contexts = await collectTextFiles(storage, "contexts");
    payload.tasks = await collectAllTasks(storage);
    payload.projectFiles = await collectProjectFiles(storage);
    payload.memberFiles = await collectMemberFiles(storage);
    payload.events = await collectAllEvents(storage);
  }

  if (options.mode === "project_update") {
    if (!canExportProjectUpdatePackage(actor)) {
      throw new Error("当前成员没有发布项目更新包的权限。");
    }

    if (!options.sign) {
      throw new Error("项目更新包必须使用负责人签名后才能导出。");
    }

    payload.entries = await collectAllEntries(storage, project);
    payload.comments = await collectAllComments(storage);
    payload.terms = await collectAllTerms(storage);
    payload.contexts = await collectTextFiles(storage, "contexts");
    payload.sourceFiles = await collectTextFiles(storage, "source");
    payload.tasks = await collectAllTasks(storage);
    payload.projectFiles = collectProjectUpdateProjectFile(
      project,
      targetRevision ?? baseRevision,
      createdAt,
    );
    payload.memberFiles = await collectPublicMemberFiles(storage);
    payload.events = await collectAllEvents(storage);
  }

  const summary = getPackageSummary(payload);

  if (!hasPackageContent(summary)) {
    throw new Error("当前范围内没有可导出的修改。");
  }

  const contentHash = await calculateChangePackageContentHash(payload);
  const manifest: ChangePackageManifest = {
    schema_version: 1,
    project_id: project.project_id,
    package_id: buildPackageId(userId, manifestPackageType, createdAt, options.taskId),
    package_type: manifestPackageType,
    user_id: userId,
    user_name: actor.name || userId,
    task_id: options.mode === "task_changes" ? options.taskId : undefined,
    created_at: createdAt,
    changed_entries: summary.changed_entries,
    new_comments: summary.changed_comments,
    content_hash: contentHash,
    app_version: APP_VERSION,
    source_project_version: String(project.schema_version),
    base_revision: baseRevision,
    target_revision: targetRevision,
    exported_by: actor.id,
    exported_at: createdAt,
    scopes:
      options.mode === "task_changes" && options.taskId
        ? [`task:${options.taskId}`]
        : [options.mode],
    summary,
  };
  const members = options.sign ? await loadProjectMembers(storage) : [];
  const signer = members.find((member) => member.id === userId);
  const signature = options.sign ? await createSignature(manifest, signer) : undefined;

  if (options.mode === "project_update" && !signature) {
    throw new Error("项目更新包签名失败。请先配置当前负责人的签名私钥。");
  }

  const files: ZipContent = {
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "entries/": null,
    "comments/": null,
    "terms/": null,
    "contexts/": null,
    "source/": null,
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

  for (const [path, content] of Object.entries(payload.sourceFiles)) {
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

  const blob = await createZip(files);

  const projectUpdateJson = payload.projectFiles["project/project.json"];

  return {
    fileName: buildFileName(userId, manifestPackageType, createdAt, options.taskId),
    blob,
    manifest,
    signature,
    completion:
      options.mode === "member_changes"
        ? {
            kind: "member_changes",
            projectId: project.project_id,
            userId,
            baseRevision,
            contentHash,
          }
        : options.mode === "project_update" && projectUpdateJson && targetRevision
          ? {
              kind: "project_update",
              projectId: project.project_id,
              baseRevision,
              targetRevision,
              projectJson: projectUpdateJson,
            }
          : { kind: "none" },
  };
}

export async function completeChangePackageExport(
  exported: ExportedChangePackage,
): Promise<ProjectConfig | undefined> {
  if (exported.completion.kind === "none") {
    return undefined;
  }

  const storage = getProjectStorage();
  const project = await storage.readJson<ProjectConfig>("project.json");
  const completion = exported.completion;

  if (project.project_id !== completion.projectId) {
    throw new Error("当前打开的项目与刚才导出的修改包不一致，未提交导出状态。");
  }

  const currentRevision = getProjectRevision(project);

  if (completion.kind === "member_changes") {
    if (currentRevision !== completion.baseRevision) {
      throw new Error("项目版本已变化，未提交刚才的个人修改导出状态。请重新导出。");
    }

    storeExportedMemberChangeHash(
      completion.projectId,
      completion.userId,
      completion.baseRevision,
      completion.contentHash,
    );
    return undefined;
  }

  if (currentRevision === completion.targetRevision) {
    return project;
  }

  if (currentRevision !== completion.baseRevision) {
    throw new Error("项目版本已变化，未发布刚才生成的项目更新包。请重新导出。");
  }

  const nextProject = JSON.parse(completion.projectJson) as ProjectConfig;

  await storage.writeText("project.json", completion.projectJson);
  setPermissionProject(nextProject);
  return nextProject;
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
    const sourceFiles = Object.fromEntries(
      Object.entries(files).filter(
        ([path]) => path.startsWith("source/") && !path.endsWith("/"),
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
      sourceFiles,
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
  assertChangePackageManifestForImport(changePackage);

  const storage = getProjectStorage();
  const project = await storage.readJson<ProjectConfig>("project.json");
  const members = await loadProjectMembers(storage);
  const packageProjectId = changePackage.manifest.project_id;
  const packageType = getPackageType(changePackage.manifest);
  const payload: ChangePackagePayload = {
    entries: changePackage.entries,
    comments: changePackage.comments,
    terms: changePackage.terms,
    contexts: changePackage.contexts,
    sourceFiles: changePackage.sourceFiles,
    tasks: changePackage.tasks,
    projectFiles: changePackage.projectFiles,
    memberFiles: changePackage.memberFiles,
    events: changePackage.events,
  };
  const calculatedContentHash = await calculateChangePackageContentHash(payload);
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
  const isProjectUpdate = isProjectUpdatePackage(packageType);
  const projectUpdateSignerAllowed =
    !isProjectUpdate ||
    canExportProjectUpdatePackage(
      members.find((member) => member.id === changePackage.manifest.user_id),
    );
  const signatureStatus: SignatureStatus =
    isProjectUpdate &&
    signatureResult.signatureStatus === "valid" &&
    !projectUpdateSignerAllowed
      ? "invalid"
      : signatureResult.signatureStatus;
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
    !isProjectUpdate &&
    (packageType === "maintenance_changes" ||
      normalizedSummary.changed_members > 0 ||
      normalizedSummary.changed_project_settings > 0 ||
      normalizedSummary.changed_credentials > 0);
  const requiresOwnerCredentialConfirmation =
    !isProjectUpdate && (hasOwnerCredentialChange || hasOwnerPromotion);
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
    signatureStatus,
    signerName: signatureResult.signerName,
    packageType,
    summary: normalizedSummary,
    riskLevel,
    canImportNormally:
      packageProjectId === project.project_id &&
      contentIntegrity !== "failed" &&
      (!isProjectUpdate || signatureStatus === "valid"),
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
    sourceFileCount: countRecordFiles(changePackage.sourceFiles),
    taskCount: countRecordRows(changePackage.tasks),
    memberChangeCount: validation.summary.changed_members,
    credentialChangeCount: validation.summary.changed_credentials,
    hasProjectSettingsChange: validation.summary.changed_project_settings > 0,
    logCount: changePackage.events.length,
    entryPaths: Object.keys(changePackage.entries),
    validation,
    contentHashShort: shortHash(changePackage.manifest.content_hash),
    signatureKeyId: changePackage.signature?.key_id ?? "",
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
  if (isProjectUpdatePackage(getPackageType(changePackage.manifest))) {
    return [];
  }

  const conflicts: ChangeConflict[] = [];
  const useOrdinarySafeguards = isMemberChangePackage(
    getPackageType(changePackage.manifest),
  );

  for (const [path, packageEntries] of Object.entries(changePackage.entries)) {
    const currentEntries = await loadCurrentEntries(path);

    for (const packageEntry of packageEntries) {
      const mainEntry = currentEntries.find((entry) => entry.id === packageEntry.id);

      if (!mainEntry) {
        continue;
      }

      const reasons = hasEntryConflict(
        mainEntry,
        packageEntry,
        useOrdinarySafeguards,
      );

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

async function buildMemberChangePayload(
  storage: ProjectStorage,
  project: ProjectConfig,
  userId: string,
): Promise<ChangePackagePayload> {
  return {
    entries: await collectUserChangedEntries(storage, project, userId),
    comments: await collectUserComments(storage, userId),
    terms: await collectUserTerms(storage, userId),
    contexts: {},
    sourceFiles: {},
    tasks: await collectUserCreatedTasks(storage, userId),
    projectFiles: {},
    memberFiles: {},
    events: await collectUserEvents(storage, userId),
  };
}

async function assertNoUnexportedMemberChanges(
  storage: ProjectStorage,
  project: ProjectConfig,
  actor: Member | null | undefined,
): Promise<void> {
  if (!actor?.id) {
    throw new Error("请先登录后再接收项目更新包。");
  }

  const revision = getProjectRevision(project);
  const payload = await buildMemberChangePayload(storage, project, actor.id);
  const summary = getPackageSummary(payload);

  if (!hasPackageContent(summary)) {
    return;
  }

  const currentHash = await calculateChangePackageContentHash(payload);
  const exportedHash = readExportedMemberChangeHash(
    project.project_id,
    actor.id,
    revision,
  );

  if (currentHash !== exportedHash) {
    throw new Error("本地仍有未导出的个人修改。请先导出我的修改包，再接收项目更新包。");
  }
}

function assertProjectUpdateCanApply(
  changePackage: ReadChangePackage,
  validation: ChangePackageValidation,
  currentProject: ProjectConfig,
  currentMembers: Member[],
  actor: Member | null | undefined,
): ProjectConfig {
  if (!canImportProjectUpdatePackage(actor)) {
    throw new Error("当前成员没有接收项目更新包的权限。");
  }

  if (validation.contentIntegrity !== "passed") {
    throw new Error("项目更新包内容完整性未通过，不能导入。");
  }

  if (validation.signatureStatus !== "valid") {
    throw new Error("项目更新包必须带有有效负责人签名。");
  }

  const signer = currentMembers.find(
    (member) => member.id === changePackage.manifest.user_id,
  );

  if (!canExportProjectUpdatePackage(signer)) {
    throw new Error("项目更新包签名人不是当前项目允许发布更新的成员。");
  }

  const currentRevision = getProjectRevision(currentProject);

  if (!changePackage.manifest.base_revision) {
    throw new Error("项目更新包缺少 base_revision，不能导入。");
  }

  if (changePackage.manifest.base_revision !== currentRevision) {
    throw new Error(
      `项目更新包基线不匹配。当前项目版本：${currentRevision}，更新包基线：${changePackage.manifest.base_revision}。`,
    );
  }

  if (!changePackage.manifest.target_revision) {
    throw new Error("项目更新包缺少 target_revision，不能导入。");
  }

  const nextProject = parseProjectFromPackage(changePackage.projectFiles);

  if (!nextProject) {
    throw new Error("项目更新包缺少 project.json，不能导入。");
  }

  if (
    nextProject.project_id !== currentProject.project_id ||
    nextProject.project_id !== changePackage.manifest.project_id
  ) {
    throw new Error("项目更新包中的 project.json 与当前项目不匹配，不能导入。");
  }

  if (getProjectRevision(nextProject) !== changePackage.manifest.target_revision) {
    throw new Error("项目更新包目标版本与 project.json 不一致，不能导入。");
  }

  return nextProject;
}

async function listExistingFiles(
  storage: ProjectStorage,
  directory: string,
  prefix = directory,
): Promise<string[]> {
  if (!(await storage.fileExists(directory))) {
    return [];
  }

  const names = await storage.listFiles(directory);
  const paths: string[] = [];

  for (const name of names) {
    const path = `${prefix}/${name}`;

    try {
      await storage.readBinary(path);
      paths.push(path);
    } catch {
      paths.push(
        ...(await listExistingFiles(storage, path, path)),
      );
    }
  }

  return paths;
}

async function collectProjectUpdateStaleFiles(
  storage: ProjectStorage,
  currentProject: ProjectConfig,
  nextProject: ProjectConfig,
  changePackage: ReadChangePackage,
): Promise<string[]> {
  const nextSourcePaths = new Set(nextProject.files.map((file) => file.source_path));
  const nextEntryDirectories = new Set(nextProject.files.map((file) => file.entries_path));
  const packageEntryPaths = new Set(Object.keys(changePackage.entries));
  const packageSourcePaths = new Set(Object.keys(changePackage.sourceFiles));
  const writePaths = new Set([
    ...packageEntryPaths,
    ...packageSourcePaths,
    ...Object.keys(changePackage.comments),
    ...Object.keys(changePackage.terms),
    ...Object.keys(changePackage.tasks),
    ...Object.keys(changePackage.contexts),
    "members.json",
    "logs/events.jsonl",
    "project.json",
  ]);
  const staleFiles = new Set<string>();

  for (const file of currentProject.files) {
    if (!nextSourcePaths.has(file.source_path)) {
      staleFiles.add(file.source_path);
    }

    if (!nextEntryDirectories.has(file.entries_path)) {
      for (const path of await listExistingFiles(storage, file.entries_path)) {
        staleFiles.add(path);
      }
    }

    if (!nextProject.files.some((nextFile) => nextFile.id === file.id)) {
      for (const path of await listExistingFiles(storage, `comments/${file.id}`)) {
        staleFiles.add(path);
      }
    }
  }

  for (const directory of nextEntryDirectories) {
    const packageHasDirectory = Array.from(packageEntryPaths).some((path) =>
      path.startsWith(`${directory}/`),
    );

    if (!packageHasDirectory) {
      continue;
    }

    for (const path of await listExistingFiles(storage, directory)) {
      if (!packageEntryPaths.has(path)) {
        staleFiles.add(path);
      }
    }
  }

  return Array.from(staleFiles)
    .filter((path) => !writePaths.has(path))
    .sort((left, right) => right.split("/").length - left.split("/").length || left.localeCompare(right));
}

async function applyProjectUpdatePackage(
  changePackage: ReadChangePackage,
  validation: ChangePackageValidation,
  options: ApplyChangePackageOptions,
): Promise<ApplyChangePackageResult> {
  const storage = getProjectStorage();
  const currentProject = await storage.readJson<ProjectConfig>("project.json");
  const currentMembers = await loadProjectMembers(storage);
  const nextProject = assertProjectUpdateCanApply(
    changePackage,
    validation,
    currentProject,
    currentMembers,
    options.actor,
  );

  await assertNoUnexportedMemberChanges(storage, currentProject, options.actor);
  await precheckChangePackageImport(changePackage, validation, []);

  let appliedEntries = 0;
  let importedComments = 0;
  let importedTerms = 0;
  let importedContexts = 0;
  let importedSourceFiles = 0;
  let importedTasks = 0;
  let importedMembers = 0;
  let importedProjectSettings = 0;
  let importedEvents = 0;

  const writePlan = createProjectWritePlan(storage);

  for (const [path, packageEntries] of Object.entries(changePackage.entries)) {
    writePlan.writeJsonl(path, packageEntries.map(normalizeEntry));
    appliedEntries += packageEntries.length;
  }

  for (const [path, packageComments] of Object.entries(changePackage.comments)) {
    writePlan.writeJsonl(path, packageComments);
    importedComments += packageComments.length;
  }

  for (const [path, packageTerms] of Object.entries(changePackage.terms)) {
    writePlan.writeJsonl(path, packageTerms);
    importedTerms += packageTerms.length;
  }

  for (const [path, content] of Object.entries(changePackage.contexts)) {
    writePlan.writeText(path, content);
    importedContexts += 1;
  }

  for (const [path, content] of Object.entries(changePackage.sourceFiles)) {
    writePlan.writeText(path, content);
    importedSourceFiles += 1;
  }

  for (const [path, packageTasks] of Object.entries(changePackage.tasks)) {
    writePlan.writeJsonl(path, packageTasks);
    importedTasks += packageTasks.length;
  }

  importedProjectSettings = changePackage.projectFiles["project/project.json"] ? 1 : 0;

  const packageMembers = parseMembersFromPackage(changePackage.memberFiles);

  if (packageMembers.length > 0) {
    writePlan.writeJson("members.json", {
      schema_version: 1,
      members: mergePublicMembersWithLocalCredentials(currentMembers, packageMembers),
    });
    importedMembers = packageMembers.length;
  }

  importedEvents = changePackage.events.length;

  const result: ApplyChangePackageResult = {
    appliedEntries,
    importedComments,
    importedTerms,
    importedContexts,
    importedSourceFiles,
    importedTasks,
    importedMembers,
    importedProjectSettings,
    importedEvents,
  };
  const importEvent = createImportLogEvent(
    changePackage.manifest,
    result,
    validation,
    options,
  );
  const staleFiles = await collectProjectUpdateStaleFiles(
    storage,
    currentProject,
    nextProject,
    changePackage,
  );

  for (const path of staleFiles) {
    writePlan.deleteFile(path);
  }

  writePlan.writeJsonl("logs/events.jsonl", [
    ...changePackage.events,
    importEvent,
  ]);
  writePlan.writeText(
    "project.json",
    changePackage.projectFiles["project/project.json"],
  );

  await writePlan.execute();
  setPermissionProject(nextProject);

  if (options.actor?.id) {
    const postUpdatePayload = await buildMemberChangePayload(
      storage,
      nextProject,
      options.actor.id,
    );

    storeExportedMemberChangeHash(
      nextProject.project_id,
      options.actor.id,
      getProjectRevision(nextProject),
      await calculateChangePackageContentHash(postUpdatePayload),
    );
  }

  return result;
}

export async function applyChangePackage(
  changePackage: ReadChangePackage,
  resolutions: ConflictResolution[] = [],
  options: ApplyChangePackageOptions = {},
): Promise<ApplyChangePackageResult> {
  const validation = await validateChangePackage(changePackage);
  assertChangePackageManifestForImport(changePackage);

  if (validation.projectMatch !== "matched") {
    throw new Error("修改包不属于当前项目，无法导入。");
  }

  if (isProjectUpdatePackage(validation.packageType)) {
    return applyProjectUpdatePackage(changePackage, validation, options);
  }

  if (!isMemberChangePackage(validation.packageType)) {
    try {
      assertCan(options.actor, PERMISSION_ACTIONS.CHANGE_PACKAGE_IMPORT);
    } catch {
      throw new Error("当前成员没有导入修改包的权限。");
    }
  }

  if (
    isMemberChangePackage(validation.packageType) &&
    !canImportMemberChangePackage(options.actor)
  ) {
    throw new Error("当前成员没有导入普通修改包的权限。");
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

  const storage = getProjectStorage();
  const conflicts = await detectConflicts(changePackage);
  const useOrdinarySafeguards = isMemberChangePackage(validation.packageType);

  await precheckChangePackageImport(changePackage, validation, conflicts);

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
  let importedSourceFiles = 0;
  let importedTasks = 0;
  let importedMembers = 0;
  let importedProjectSettings = 0;
  let importedEvents = 0;
  const writePlan = createProjectWritePlan(storage);
  const changedEntryGroups: Array<{
    fileId: string;
    entries: Entry[];
  }> = [];
  const localEntryEvents: ProjectEvent[] = [];

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

      const sourceEvent = findPackageEntryVersionEvent(
        changePackage.events,
        normalizeEntry(packageEntry),
      );
      const operation = inferEntryOperationFromEvent(sourceEvent);
      const currentEntry = currentEntries[entryIndex];
      let nextEntry: Entry;

      if (resolution?.action === "manual_merge") {
        const target = resolution.target ?? currentEntry.target;
        const updatedAt = nowIso();

        nextEntry = target !== currentEntry.target
          ? applyEntryTargetChange(currentEntry, target, {
              userId: changePackage.manifest.user_id,
              updatedAt,
            })
          : normalizeEntry({
              ...currentEntry,
              status: resolution.status ?? currentEntry.status,
              updated_at: updatedAt,
              updated_by: changePackage.manifest.user_id,
            });
      } else {
        nextEntry = useOrdinarySafeguards
          ? mergeOrdinaryPackageEntry(
              currentEntry,
              packageEntry,
              changePackage.manifest.user_id,
              operation,
            )
          : normalizeEntry(packageEntry);
      }

      currentEntries[entryIndex] = nextEntry;

      if (
        useOrdinarySafeguards &&
        entryWorkflowChanged(currentEntry, nextEntry)
      ) {
        localEntryEvents.push(
          createEntryVersionEvent(
            currentEntry,
            nextEntry,
            changePackage.manifest.user_id,
            {
              operation:
                resolution?.action === "manual_merge"
                  ? "package_merge"
                  : operation,
              sourceEventId: sourceEvent?.id,
              packageId: changePackage.manifest.package_id,
            },
          ),
        );
      }

      changed = true;
      appliedEntries += 1;
    }

    if (changed) {
      writePlan.writeJsonl(path, currentEntries);
      const fileId = currentEntries[0]?.file_id;

      if (fileId) {
        changedEntryGroups.push({ fileId, entries: currentEntries });
      }
    }
  }

  for (const [path, packageComments] of Object.entries(changePackage.comments)) {
    const existingComments = (await storage.fileExists(path))
      ? await storage.readJsonl<Comment>(path)
      : [];
    const existingIds = new Set(existingComments.map((comment) => comment.id));
    const newComments = packageComments.filter(
      (comment) => !existingIds.has(comment.id),
    );

    if (newComments.length > 0) {
      writePlan.writeJsonl(path, [...existingComments, ...newComments]);
      importedComments += newComments.length;
    }
  }

  for (const [path, packageTerms] of Object.entries(changePackage.terms)) {
    const existingTerms = (await storage.fileExists(path))
      ? await storage.readJsonl<Term>(path)
      : [];
    const result = mergeRowsById(existingTerms, packageTerms);

    if (result.imported > 0) {
      writePlan.writeJsonl(path, result.rows);
      importedTerms += result.imported;
    }
  }

  for (const [path, packageTasks] of Object.entries(changePackage.tasks)) {
    const existingTasks = (await storage.fileExists(path))
      ? await storage.readJsonl<Task>(path)
      : [];
    const normalizedPackageTasks = useOrdinarySafeguards
      ? packageTasks
      : packageTasks.map((packageTask) =>
          normalizeImportedTaskDeadline(
            existingTasks.find((task) => task.id === packageTask.id),
            packageTask,
          ),
        );

    const result = useOrdinarySafeguards
      ? mergeOrdinaryPackageTasks(existingTasks, normalizedPackageTasks)
      : mergeRowsById(existingTasks, normalizedPackageTasks);

    if (result.imported > 0) {
      writePlan.writeJsonl(path, result.rows);
      importedTasks += result.imported;
    }
  }

  for (const [path, content] of Object.entries(changePackage.contexts)) {
    writePlan.writeText(path, content);
    importedContexts += 1;
  }

  for (const [path, content] of Object.entries(changePackage.projectFiles)) {
    if (path === "project/project.json") {
      writePlan.writeText("project.json", content);
      importedProjectSettings += 1;
    }
  }

  for (const [path, content] of Object.entries(changePackage.memberFiles)) {
    if (path === "members/members.json") {
      writePlan.writeText("members.json", content);
      importedMembers += 1;
    }
  }

  const existingEvents = (await storage.fileExists("logs/events.jsonl"))
    ? await storage.readJsonl<ProjectEvent>("logs/events.jsonl")
    : [];
  const existingIds = new Set(existingEvents.map((event) => event.id));
  const sourceEvents = useOrdinarySafeguards
    ? changePackage.events.filter((event) => !isEntryVersionEvent(event))
    : changePackage.events;
  const newEvents = sourceEvents.filter((event) => !existingIds.has(event.id));

  importedEvents = newEvents.length;

  const result: ApplyChangePackageResult = {
    appliedEntries,
    importedComments,
    importedTerms,
    importedContexts,
    importedSourceFiles,
    importedTasks,
    importedMembers,
    importedProjectSettings,
    importedEvents,
  };
  const importEvent = createImportLogEvent(
    changePackage.manifest,
    result,
    validation,
    options,
  );

  writePlan.writeJsonl("logs/events.jsonl", [
    ...existingEvents,
    ...newEvents,
    ...localEntryEvents,
    importEvent,
  ]);

  await writePlan.execute();

  for (const group of changedEntryGroups) {
    cacheEntriesForFile(group.fileId, group.entries);
  }

  return result;
}
