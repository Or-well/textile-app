import type {
  Member,
  ProjectCollaborationSettings,
  ProjectConfig,
  ProjectFile,
  ProofreadRequired,
} from "../model/types";
import type { RolePermissions } from "../model/types";
import { PERMISSION_ACTIONS, type PermissionAction } from "../model/permissions";
import { createId } from "../utils/id";
import { nowIso } from "../utils/time";
import { createPasswordFields } from "./auth";
import { appendEventToStorage } from "./history";
import {
  assertCan,
  can,
  canManageMemberPermissionOverrides,
  getDefaultRolePermissions,
  getCurrentUser,
  setPermissionProject,
  validateRolePermissionChange,
} from "./permissions";
import {
  cacheEntriesForFile,
  clearCachedEntriesForFile,
  importEntryTranslations,
  parseEntriesFromSourceFile,
  prepareUpdatedEntriesFromSourceFile,
  writeEntriesForFileToStorage,
} from "./entries";
import {
  createProjectRootFromPackage,
  importProjectPackageToDirectory,
  inspectProjectPackage,
  type ProjectPackagePreview,
} from "./projectPackage";
import {
  openProjectDirectory,
  type ProjectDirectoryHandle,
} from "./projectFs";
import {
  createProjectStorage,
  type ProjectStorage,
} from "./projectStorage";
import { createProjectWritePlan } from "./projectWritePlan";
import {
  DEFAULT_NEW_PROJECT_COLLABORATION_SETTINGS,
  normalizeProjectCollaborationSettings,
} from "./collaboration";

interface MembersFile {
  schema_version: number;
  members: Member[];
}

const SUPPORTED_PROJECT_SCHEMA_VERSION = 1;

export interface OpenedProject {
  root: ProjectDirectoryHandle;
  storage: ProjectStorage;
  config: ProjectConfig;
  members: Member[];
  storageKind: "folder" | "packed";
  sourceFileName?: string;
}

export interface ProjectStructureResult {
  valid: boolean;
  missing: string[];
}

export interface CreateProjectInput {
  name: string;
  description: string;
  sourceLanguage: string;
  targetLanguage: string;
  enableTasks: boolean;
  enableProofread: boolean;
  enableReview: boolean;
  proofreadRequired: ProofreadRequired;
  allowSelfProofread?: boolean;
  allowSelfReview?: boolean;
  allowSameUserMultiProofread?: boolean;
  progressWeights: {
    translation: number;
    proofread: number;
    review: number;
  };
  requireSignedChangePackages?: boolean;
  ownerName: string;
  ownerPassword: string;
}

export interface CreatedProject {
  project: OpenedProject;
  owner: Member;
}

export interface CreateProjectFileInput {
  name: string;
  sourceText: string;
  type: string;
  folder?: string;
}

export interface UpdateProjectFilePatch {
  name?: string;
  folder?: string;
  hidden?: boolean;
  locked?: boolean;
  updated_at?: string;
}

export interface ProjectFileImportResult {
  config: ProjectConfig;
  file: ProjectFile;
  entryCount: number;
}

export interface ProjectFileUpdateResult {
  config: ProjectConfig;
  entryCount: number;
}

export interface ProjectFileTranslationImportResult {
  config: ProjectConfig;
  matched: number;
  skipped: number;
}

const REQUIRED_PROJECT_PATHS = [
  "project.json",
  "members.json",
  "entries",
  "terms",
  "tasks",
] as const;
const PROJECT_DIRECTORIES = [
  "source",
  "entries",
  "terms",
  "tasks",
  "comments",
  "logs",
  "exports",
  "exports/releases",
  "changes",
] as const;
const CREATION_CONFLICT_PATHS = [
  "project.json",
  "members.json",
  "terms/terms.jsonl",
  "tasks/tasks.jsonl",
  "logs/events.jsonl",
] as const;

function slugifyFileId(name: string): string {
  const baseName = name
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return baseName || createId("file");
}

function uniqueFileId(config: ProjectConfig, name: string): string {
  const baseId = slugifyFileId(name);
  const existingIds = new Set(config.files.map((file) => file.id));

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  let nextId = `${baseId}_${index}`;

  while (existingIds.has(nextId)) {
    index += 1;
    nextId = `${baseId}_${index}`;
  }

  return nextId;
}

function getFileExtension(name: string): string {
  const lastDot = name.lastIndexOf(".");

  return lastDot > 0 ? name.slice(lastDot).toLowerCase() : "";
}

function buildSourcePath(fileId: string, name: string, suffix = 1): string {
  const duplicateSuffix = suffix > 1 ? `_${suffix}` : "";

  return `source/${fileId}${duplicateSuffix}${getFileExtension(name)}`;
}

async function createUniqueSourcePath(
  storage: ProjectStorage,
  config: ProjectConfig,
  fileId: string,
  name: string,
): Promise<string> {
  const configuredPaths = new Set(config.files.map((file) => file.source_path));
  let suffix = 1;
  let path = buildSourcePath(fileId, name, suffix);

  while (configuredPaths.has(path) || await storage.fileExists(path)) {
    suffix += 1;
    path = buildSourcePath(fileId, name, suffix);
  }

  return path;
}

function normalizeProjectFileName(name: string): string {
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("文件名不能为空。");
  }

  if (/[\\/]/.test(trimmedName)) {
    throw new Error("文件名不能包含路径分隔符。");
  }

  return trimmedName;
}

function getFileType(name: string): string {
  return name.split(".").pop()?.toLowerCase() || "txt";
}

function assertSupportedImportFile(name: string): void {
  const type = getFileType(name);

  if (!["txt", "ks", "jsonl", "json", "csv"].includes(type)) {
    throw new Error("当前仅支持导入 .txt、.ks、.jsonl、.json、.csv 文本文件。");
  }
}

function resolveProjectActor(actor?: Member | null): Member {
  const user = actor ?? getCurrentUser();

  if (!user?.id) {
    throw new Error("Login required.");
  }

  return user;
}

function normalizeProjectConfig(config: ProjectConfig): ProjectConfig {
  const schemaVersion = Number(config.schema_version ?? 1);

  if (
    !Number.isInteger(schemaVersion) ||
    schemaVersion < 1 ||
    schemaVersion > SUPPORTED_PROJECT_SCHEMA_VERSION
  ) {
    throw new Error(
      `Project schema_version ${config.schema_version ?? "unknown"} is not supported.`,
    );
  }

  if (!config.project_id || !config.name || !Array.isArray(config.files)) {
    throw new Error("Project configuration is missing required fields.");
  }

  return {
    ...config,
    schema_version: schemaVersion,
    source_language: config.source_language || "ja",
    target_language: config.target_language || "zh-Hans",
    files: config.files.map((file) => {
      const fileId = file.id || createId("file");

      return {
        ...file,
        id: fileId,
        name: file.name || "Untitled",
        source_path: file.source_path || `source/${fileId}`,
        entries_path: file.entries_path || `entries/${fileId}`,
        type: file.type || "txt",
        hidden: file.hidden === true,
        locked: file.locked === true,
      };
    }),
    settings: {
      chunk_size: config.settings?.chunk_size ?? 500,
      auto_save: config.settings?.auto_save ?? true,
      allow_change_package: config.settings?.allow_change_package ?? true,
      workflow: config.settings?.workflow,
      progress_weights: config.settings?.progress_weights,
      export: config.settings?.export,
      collaboration: config.settings?.collaboration
        ? normalizeProjectCollaborationSettings(config.settings.collaboration)
        : undefined,
      role_permissions: config.settings?.role_permissions,
      permission_schema_version:
        config.settings?.permission_schema_version ?? 1,
    },
  };
}

export async function loadProject(
  root: ProjectDirectoryHandle,
): Promise<ProjectConfig> {
  return loadProjectFromStorage(createProjectStorage(root));
}

export async function loadProjectFromStorage(
  storage: ProjectStorage,
): Promise<ProjectConfig> {
  return normalizeProjectConfig(await storage.readJson<ProjectConfig>("project.json"));
}

export async function saveProject(
  root: ProjectDirectoryHandle,
  config: ProjectConfig,
): Promise<void> {
  await saveProjectToStorage(createProjectStorage(root), config);
}

export async function saveProjectToStorage(
  storage: ProjectStorage,
  config: ProjectConfig,
): Promise<void> {
  await storage.writeJson("project.json", config);
  setPermissionProject(config);
}

export async function loadMembers(
  root: ProjectDirectoryHandle,
): Promise<Member[]> {
  return loadMembersFromStorage(createProjectStorage(root));
}

export async function loadMembersFromStorage(
  storage: ProjectStorage,
): Promise<Member[]> {
  const file = await storage.readJson<MembersFile>("members.json");

  return file.members;
}

export async function saveMembers(
  root: ProjectDirectoryHandle,
  members: Member[],
): Promise<void> {
  await saveMembersToStorage(createProjectStorage(root), members);
}

export async function saveMembersToStorage(
  storage: ProjectStorage,
  members: Member[],
): Promise<void> {
  await storage.writeJson<MembersFile>("members.json", {
    schema_version: 1,
    members,
  });
}

function diffPermissions(
  before: readonly string[] = [],
  after: readonly string[] = [],
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);

  return {
    added: after.filter((permission) => !beforeSet.has(permission)),
    removed: before.filter((permission) => !afterSet.has(permission)),
  };
}

export async function saveRolePermissions(
  root: ProjectDirectoryHandle,
  project: ProjectConfig,
  members: Member[],
  actor: Member,
  nextRolePermissions: RolePermissions,
  options: { resetToDefault?: boolean } = {},
): Promise<ProjectConfig> {
  const storage = createProjectStorage(root);

  if (!can(actor, PERMISSION_ACTIONS.ROLE_MANAGE, project)) {
    throw new Error("当前成员没有管理角色权限的权限。");
  }

  validateRolePermissionChange(project, nextRolePermissions, members);

  const previousRolePermissions =
    project.settings.role_permissions ?? getDefaultRolePermissions();
  const nextProject: ProjectConfig = {
    ...project,
    settings: {
      ...project.settings,
      role_permissions: nextRolePermissions,
      permission_schema_version: 2,
    },
  };
  const nextActor = members.find((member) => member.id === actor.id) ?? actor;

  if (
    !can(nextActor, PERMISSION_ACTIONS.PROJECT_MANAGE, nextProject) ||
    !can(nextActor, PERMISSION_ACTIONS.MEMBER_MANAGE, nextProject) ||
    !can(nextActor, PERMISSION_ACTIONS.ROLE_MANAGE, nextProject)
  ) {
    throw new Error("不能保存会让当前成员失去项目、成员或权限管理能力的配置。");
  }

  const changedRoles = Object.entries(nextRolePermissions).map(
    ([role, permissions]) => ({
      role,
      ...diffPermissions(previousRolePermissions[role as keyof RolePermissions], permissions),
    }),
  );

  await saveProjectToStorage(storage, nextProject);
  await appendEventToStorage(storage, {
    type: options.resetToDefault
      ? "role_permissions.reset"
      : "role_permissions.updated",
    user_id: actor.id,
    detail: {
      reset_to_default: Boolean(options.resetToDefault),
      changed_roles: changedRoles,
    },
  });

  return nextProject;
}

export async function saveMemberPermissionOverrides(
  root: ProjectDirectoryHandle,
  project: ProjectConfig,
  members: Member[],
  actor: Member,
  targetId: string,
  allowPermissions: string[],
  denyPermissions: string[],
): Promise<Member[]> {
  const storage = createProjectStorage(root);
  const target = members.find((member) => member.id === targetId);

  if (!target) {
    throw new Error("没有找到要修改权限的成员。");
  }

  if (!canManageMemberPermissionOverrides(actor, target, project)) {
    throw new Error("当前成员不能修改这个成员的个人权限。");
  }

  const nextMembers = members.map((member) =>
    member.id === targetId
      ? {
          ...member,
          allow_permissions: allowPermissions,
          deny_permissions: denyPermissions,
          updated_at: nowIso(),
        }
      : member,
  );
  const activeManagers = nextMembers.filter(
    (member) =>
      member.active &&
      can(member, PERMISSION_ACTIONS.PROJECT_MANAGE, project) &&
      can(member, PERMISSION_ACTIONS.MEMBER_MANAGE, project) &&
      can(member, PERMISSION_ACTIONS.ROLE_MANAGE, project),
  );

  if (activeManagers.length === 0) {
    throw new Error("至少需要保留一名可用成员拥有项目、成员和权限管理能力。");
  }

  const nextActor = nextMembers.find((member) => member.id === actor.id) ?? actor;

  if (
    !can(nextActor, PERMISSION_ACTIONS.PROJECT_MANAGE, project) ||
    !can(nextActor, PERMISSION_ACTIONS.MEMBER_MANAGE, project) ||
    !can(nextActor, PERMISSION_ACTIONS.ROLE_MANAGE, project)
  ) {
    throw new Error("不能保存会让当前成员失去项目、成员或权限管理能力的配置。");
  }

  await saveMembersToStorage(storage, nextMembers);
  await appendEventToStorage(storage, {
    type: "member.permission_overrides.updated",
    user_id: actor.id,
    detail: {
      member_id: targetId,
      allow: diffPermissions(target.allow_permissions, allowPermissions),
      deny: diffPermissions(target.deny_permissions, denyPermissions),
      personal_permissions: true,
    },
  });

  return nextMembers;
}

export async function saveProjectCollaborationSettings(
  root: ProjectDirectoryHandle,
  project: ProjectConfig,
  actor: Member | null | undefined,
  collaboration: ProjectCollaborationSettings,
): Promise<ProjectConfig> {
  const writeActor = resolveProjectActor(actor);

  assertCan(writeActor, PERMISSION_ACTIONS.PROJECT_MANAGE, project);

  const nextCollaboration: ProjectCollaborationSettings = {
    ...normalizeProjectCollaborationSettings(collaboration),
  };
  const nextProject: ProjectConfig = {
    ...project,
    settings: {
      ...project.settings,
      collaboration: nextCollaboration,
    },
    updated_at: nowIso(),
  };
  const storage = createProjectStorage(root);

  await saveProjectToStorage(storage, nextProject);
  await appendEventToStorage(storage, {
    type: "project.collaboration_settings.updated",
    user_id: writeActor.id,
    detail: {
      require_signed_change_packages:
        nextCollaboration.require_signed_change_packages ?? false,
    },
  });

  return nextProject;
}

export function getProjectFiles(config: ProjectConfig): ProjectFile[] {
  return config.files;
}

export async function createProjectFile(
  root: ProjectDirectoryHandle,
  config: ProjectConfig,
  input: CreateProjectFileInput,
): Promise<ProjectConfig> {
  const storage = createProjectStorage(root);
  const name = normalizeProjectFileName(input.name);
  const fileId = uniqueFileId(config, name);
  const now = nowIso();
  const projectFile: ProjectFile = {
    id: fileId,
    name,
    source_path: await createUniqueSourcePath(storage, config, fileId, name),
    entries_path: `entries/${fileId}`,
    type: input.type || getFileType(name),
    folder: input.folder?.trim() || undefined,
    hidden: false,
    locked: false,
    updated_at: now,
  };
  const nextConfig: ProjectConfig = {
    ...config,
    files: [...config.files, projectFile],
  };

  await storage.ensureDirectory("source");
  await storage.ensureDirectory(projectFile.entries_path);
  await storage.writeText(projectFile.source_path, input.sourceText);
  await saveProjectToStorage(storage, nextConfig);

  return nextConfig;
}

export async function addSourceFileToProject(
  root: ProjectDirectoryHandle,
  config: ProjectConfig,
  file: File,
  folder?: string,
  actor?: Member | null,
): Promise<ProjectFileImportResult> {
  const storage = createProjectStorage(root);

  return addSourceFileToStorage(storage, config, file, folder, actor);
}

export async function addSourceFileToStorage(
  storage: ProjectStorage,
  config: ProjectConfig,
  file: File,
  folder?: string,
  actor?: Member | null,
): Promise<ProjectFileImportResult> {
  assertCan(resolveProjectActor(actor), PERMISSION_ACTIONS.FILE_CREATE, config);
  assertSupportedImportFile(file.name);

  const sourceText = await file.text();
  const name = normalizeProjectFileName(file.name);
  const fileId = uniqueFileId(config, name);
  const now = nowIso();
  const addedFile: ProjectFile = {
    id: fileId,
    name,
    source_path: await createUniqueSourcePath(storage, config, fileId, name),
    entries_path: "",
    type: getFileType(name),
    folder: folder?.trim() || undefined,
    hidden: false,
    locked: false,
    updated_at: now,
  };
  addedFile.entries_path = `entries/${addedFile.id}`;
  const entries = parseEntriesFromSourceFile(
    addedFile.id,
    file.name,
    sourceText,
  );
  const nextConfig: ProjectConfig = {
    ...config,
    files: [...config.files, addedFile],
  };

  try {
    await storage.ensureDirectory("source");
    await storage.writeText(addedFile.source_path, sourceText);
    await writeEntriesForFileToStorage(storage, addedFile.id, entries, {
      chunkSize: config.settings.chunk_size,
    });
    await saveProjectToStorage(storage, nextConfig);
  } catch (error) {
    const residualPaths = await cleanupFailedSourceImport(storage, addedFile);
    clearCachedEntriesForFile(addedFile.id);
    const reason = error instanceof Error ? error.message : "未知错误。";
    const residualMessage =
      residualPaths.length > 0
        ? ` 已保留残留路径：${residualPaths.join("、")}。`
        : "";

    throw new Error(
      `添加源文件失败，project.json 未更新。原因：${reason}${residualMessage}`,
    );
  }

  return {
    config: nextConfig,
    file: addedFile,
    entryCount: entries.length,
  };
}

async function cleanupFailedSourceImport(
  storage: ProjectStorage,
  file: ProjectFile,
): Promise<string[]> {
  const residualPaths: string[] = [];

  for (const target of [
    { path: file.entries_path, recursive: true },
    { path: file.source_path, recursive: false },
  ]) {
    try {
      if (await storage.fileExists(target.path)) {
        await storage.deleteEntry(target.path, { recursive: target.recursive });
      }
    } catch {
      residualPaths.push(target.path);
    }
  }

  return residualPaths;
}

export async function updateSourceFileInProject(
  root: ProjectDirectoryHandle,
  config: ProjectConfig,
  fileId: string,
  sourceFile: File,
  actor?: Member | null,
): Promise<ProjectFileUpdateResult> {
  const storage = createProjectStorage(root);

  return updateSourceFileInStorage(
    storage,
    config,
    fileId,
    sourceFile,
    actor,
  );
}

export async function updateSourceFileInStorage(
  storage: ProjectStorage,
  config: ProjectConfig,
  fileId: string,
  sourceFile: File,
  actor?: Member | null,
): Promise<ProjectFileUpdateResult> {
  assertCan(resolveProjectActor(actor), PERMISSION_ACTIONS.FILE_UPDATE, config);
  assertSupportedImportFile(sourceFile.name);

  const projectFile = config.files.find((file) => file.id === fileId);

  if (!projectFile) {
    throw new Error("没有找到要更新的文件。");
  }

  const sourceText = await sourceFile.text();
  const preparedEntries = await prepareUpdatedEntriesFromSourceFile(
    storage,
    projectFile.id,
    sourceFile.name,
    sourceText,
    {
      chunkSize: config.settings.chunk_size,
    },
  );
  const nextConfig: ProjectConfig = {
    ...config,
    files: config.files.map((file) =>
      file.id === fileId
        ? {
            ...file,
            updated_at: nowIso(),
          }
        : file,
    ),
  };
  const writePlan = createProjectWritePlan(storage);

  for (const write of preparedEntries.writes) {
    writePlan.writeJsonl(write.path, write.rows);
  }

  for (const path of preparedEntries.deletes) {
    writePlan.deleteFile(path);
  }

  writePlan.writeText(projectFile.source_path, sourceText);
  writePlan.writeJson("project.json", nextConfig);

  await writePlan.execute();
  cacheEntriesForFile(projectFile.id, preparedEntries.entries);

  return {
    config: nextConfig,
    entryCount: preparedEntries.entries.length,
  };
}

export async function importTranslationFileToProject(
  root: ProjectDirectoryHandle,
  config: ProjectConfig,
  fileId: string,
  translationFile: File,
  actor?: Member | null,
): Promise<ProjectFileTranslationImportResult> {
  const writeActor = resolveProjectActor(actor);

  assertCan(
    writeActor,
    PERMISSION_ACTIONS.FILE_IMPORT_TRANSLATION,
    config,
  );
  assertSupportedImportFile(translationFile.name);

  const projectFile = config.files.find((file) => file.id === fileId);

  if (!projectFile) {
    throw new Error("没有找到要导入译文的文件。");
  }

  const result = await importEntryTranslations(
    projectFile.id,
    translationFile.name,
    await translationFile.text(),
    writeActor.id,
    {
      chunkSize: config.settings.chunk_size,
    },
  );

  return {
    config: await updateProjectFile(root, config, fileId, {
      updated_at: nowIso(),
    }, actor, PERMISSION_ACTIONS.FILE_IMPORT_TRANSLATION),
    ...result,
  };
}

export async function updateProjectFile(
  root: ProjectDirectoryHandle,
  config: ProjectConfig,
  fileId: string,
  patch: UpdateProjectFilePatch,
  actor?: Member | null,
  requiredAction?: PermissionAction,
): Promise<ProjectConfig> {
  const storage = createProjectStorage(root);
  const action = requiredAction ?? (patch.name
    ? PERMISSION_ACTIONS.FILE_RENAME
    : patch.locked !== undefined
      ? PERMISSION_ACTIONS.FILE_LOCK
      : patch.hidden !== undefined
        ? PERMISSION_ACTIONS.FILE_HIDE
        : PERMISSION_ACTIONS.FILE_UPDATE);

  assertCan(resolveProjectActor(actor), action, config);

  let found = false;
  const nextConfig: ProjectConfig = {
    ...config,
    files: config.files.map((file) => {
      if (file.id !== fileId) {
        return file;
      }

      found = true;

      return {
        ...file,
        ...patch,
        name: patch.name ? normalizeProjectFileName(patch.name) : file.name,
        folder:
          patch.folder !== undefined
            ? patch.folder.trim() || undefined
            : file.folder,
        updated_at: patch.updated_at ?? nowIso(),
      };
    }),
  };

  if (!found) {
    throw new Error("没有找到要更新的文件。");
  }

  await saveProjectToStorage(storage, nextConfig);

  return nextConfig;
}

export async function deleteProjectFile(
  root: ProjectDirectoryHandle,
  config: ProjectConfig,
  fileId: string,
  actor?: Member | null,
): Promise<ProjectConfig> {
  const storage = createProjectStorage(root);

  return deleteProjectFileFromStorage(storage, config, fileId, actor);
}

export async function deleteProjectFileFromStorage(
  storage: ProjectStorage,
  config: ProjectConfig,
  fileId: string,
  actor?: Member | null,
): Promise<ProjectConfig> {
  assertCan(resolveProjectActor(actor), PERMISSION_ACTIONS.FILE_DELETE, config);

  const file = config.files.find((item) => item.id === fileId);

  if (!file) {
    throw new Error("没有找到要删除的文件。");
  }

  const nextConfig: ProjectConfig = {
    ...config,
    files: config.files.filter((item) => item.id !== fileId),
  };
  const writePlan = createProjectWritePlan(storage);
  const sourcePathStillUsed = nextConfig.files.some(
    (projectFile) => projectFile.source_path === file.source_path,
  );

  if (await storage.fileExists(file.entries_path)) {
    const entryNames = await storage.listFiles(file.entries_path);

    for (const entryName of entryNames) {
      writePlan.deleteFile(`${file.entries_path}/${entryName}`);
    }

    writePlan.deleteDirectory(file.entries_path);
  }

  if (!sourcePathStillUsed) {
    writePlan.deleteFile(file.source_path);
  }
  writePlan.writeJson("project.json", nextConfig);

  await writePlan.execute();
  clearCachedEntriesForFile(file.id);

  return nextConfig;
}

export async function validateProjectStructure(
  root: ProjectDirectoryHandle,
): Promise<ProjectStructureResult> {
  const storage = createProjectStorage(root);
  const missing: string[] = [];

  for (const path of REQUIRED_PROJECT_PATHS) {
    if (!(await storage.fileExists(path))) {
      missing.push(path);
    }
  }

  if (missing.length > 0) {
    return { valid: false, missing };
  }

  const config = await loadProjectFromStorage(storage);

  for (const file of config.files) {
    if (!(await storage.fileExists(file.entries_path))) {
      missing.push(file.entries_path);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

function normalizeCreateProjectInput(
  input: CreateProjectInput,
): CreateProjectInput {
  return {
    ...input,
    name: input.name.trim(),
    description: input.description.trim(),
    sourceLanguage: input.sourceLanguage.trim() || "ja",
    targetLanguage: input.targetLanguage.trim() || "zh-Hans",
    ownerName: input.ownerName.trim(),
    proofreadRequired: (input.enableProofread
      ? Math.max(0, Math.min(3, Math.trunc(Number(input.proofreadRequired))))
      : 0) as ProofreadRequired,
    progressWeights: {
      translation: Math.max(0, Number(input.progressWeights.translation) || 0),
      proofread: Math.max(0, Number(input.progressWeights.proofread) || 0),
      review: Math.max(0, Number(input.progressWeights.review) || 0),
    },
  };
}

function assertCreateProjectInput(input: CreateProjectInput): void {
  if (!input.name) {
    throw new Error("请输入项目名称。");
  }

  if (!input.ownerName) {
    throw new Error("请输入 owner 成员名。");
  }

  if (!input.ownerPassword.trim()) {
    throw new Error("请输入 owner 密码。");
  }

  const weightTotal =
    input.progressWeights.translation +
    input.progressWeights.proofread +
    input.progressWeights.review;

  if (weightTotal !== 100) {
    throw new Error("进度权重总和必须等于 100。");
  }
}

async function assertProjectCanBeCreated(
  storage: ProjectStorage,
): Promise<void> {
  const conflicts: string[] = [];

  for (const path of CREATION_CONFLICT_PATHS) {
    if (await storage.fileExists(path)) {
      conflicts.push(path);
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      `这个文件夹已经包含项目数据：${conflicts.join("、")}。请选择空文件夹或另一个项目位置。`,
    );
  }
}

export async function selectProjectCreationDirectory(): Promise<ProjectDirectoryHandle> {
  return openProjectDirectory();
}

export async function openProjectRoot(
  root: ProjectDirectoryHandle,
): Promise<OpenedProject> {
  const storage = createProjectStorage(root);
  const result = await validateProjectStructure(root);

  if (!result.valid) {
    throw new Error(
      `这个文件夹不像一个项目文件夹，缺少：${result.missing.join("、")}。`,
    );
  }

  const [config, members] = await Promise.all([
    loadProjectFromStorage(storage),
    loadMembersFromStorage(storage),
  ]);

  setPermissionProject(config);

  return {
    root,
    storage,
    config,
    members,
    storageKind: storage.kind,
    sourceFileName: storage.sourceFileName,
  };
}

export async function createProjectInDirectory(
  root: ProjectDirectoryHandle,
  rawInput: CreateProjectInput,
): Promise<CreatedProject> {
  const storage = createProjectStorage(root);

  return createProjectInStorage(storage, rawInput);
}

export async function createProjectInStorage(
  storage: ProjectStorage,
  rawInput: CreateProjectInput,
): Promise<CreatedProject> {
  const input = normalizeCreateProjectInput(rawInput);

  assertCreateProjectInput(input);
  await assertProjectCanBeCreated(storage);

  const now = nowIso();
  const revision = createId("rev");
  const owner: Member = {
    id: createId("user"),
    name: input.ownerName,
    roles: ["owner"],
    allow_permissions: [],
    deny_permissions: [],
    active: true,
    created_at: now,
    updated_at: now,
    ...(await createPasswordFields(input.ownerPassword)),
  };
  const config: ProjectConfig = {
    schema_version: 1,
    project_id: createId("project"),
    revision,
    revision_hash: revision,
    name: input.name,
    description: input.description,
    source_language: input.sourceLanguage,
    target_language: input.targetLanguage,
    files: [],
    updated_at: now,
    settings: {
      chunk_size: 500,
      auto_save: true,
      allow_change_package: true,
      workflow: {
        enable_tasks: input.enableTasks,
        enable_proofread: input.proofreadRequired > 0,
        enable_review: input.enableReview,
        proofread_required: input.proofreadRequired,
        review_required: input.enableReview,
        allow_self_proofread: input.allowSelfProofread ?? false,
        allow_self_review: input.allowSelfReview ?? false,
        allow_same_user_multi_proofread:
          input.allowSameUserMultiProofread ?? false,
      },
      progress_weights: {
        translation: input.progressWeights.translation,
        proofread: input.progressWeights.proofread,
        review: input.progressWeights.review,
      },
      collaboration: {
        require_signed_change_packages:
          input.requireSignedChangePackages ??
          DEFAULT_NEW_PROJECT_COLLABORATION_SETTINGS.require_signed_change_packages,
      },
      role_permissions: getDefaultRolePermissions(),
      permission_schema_version: 2,
    },
  };
  const members = [owner];
  const writePlan = createProjectWritePlan(storage);

  for (const path of PROJECT_DIRECTORIES) {
    writePlan.ensureDirectory(path);
  }

  writePlan.writeJson<MembersFile>("members.json", {
    schema_version: 1,
    members,
  });
  writePlan.writeJsonl("terms/terms.jsonl", []);
  writePlan.writeJsonl("tasks/tasks.jsonl", []);
  writePlan.writeJsonl("logs/events.jsonl", []);
  writePlan.writeJson("project.json", config);

  await writePlan.execute();

  return {
    project: {
      root: storage.root,
      storage,
      config,
      members,
      storageKind: storage.kind,
      sourceFileName: storage.sourceFileName,
    },
    owner,
  };
}

export async function openProject(): Promise<OpenedProject> {
  const root = await openProjectDirectory();
  return openProjectRoot(root);
}

export async function openProjectFile(file: File): Promise<OpenedProject> {
  const root = await createProjectRootFromPackage(file);
  const storage = createProjectStorage(root);
  const config = await loadProjectFromStorage(storage);
  const members = (await storage.fileExists("members.json"))
    ? await loadMembersFromStorage(storage)
    : [];

  setPermissionProject(config);

  return {
    root,
    storage,
    config,
    members,
    storageKind: "packed",
    sourceFileName: file.name,
  };
}

export async function inspectProjectFile(
  file: File,
): Promise<ProjectPackagePreview> {
  return inspectProjectPackage(file);
}

export async function importProjectFile(file: File): Promise<OpenedProject> {
  const imported = await importProjectPackageToDirectory(file);

  return openProjectRoot(imported.root);
}
