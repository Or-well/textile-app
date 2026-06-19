import type { Member, ProjectConfig, ProjectFile, ProofreadRequired } from "../model/types";
import type { RolePermissions } from "../model/types";
import { PERMISSION_ACTIONS, type PermissionAction } from "../model/permissions";
import { createId } from "../utils/id";
import { nowIso } from "../utils/time";
import { createPasswordFields } from "./auth";
import { appendEventToRoot } from "./history";
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
  clearCachedEntriesForFile,
  importEntryTranslations,
  parseEntriesFromSourceFile,
  updateEntriesFromSourceFile,
  writeEntriesForFile,
} from "./entries";
import { createProjectRootFromPackage } from "./projectPackage";
import {
  deleteEntry,
  ensureDirectory,
  fileExists,
  openProjectDirectory,
  readJson,
  writeTextFile,
  writeJsonl,
  writeJson,
  type ProjectDirectoryHandle,
} from "./projectFs";

interface MembersFile {
  schema_version: number;
  members: Member[];
}

export interface OpenedProject {
  root: ProjectDirectoryHandle;
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
  progressWeights: {
    translation: number;
    proofread: number;
    review: number;
  };
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

export async function loadProject(
  root: ProjectDirectoryHandle,
): Promise<ProjectConfig> {
  return readJson<ProjectConfig>(root, "project.json");
}

export async function saveProject(
  root: ProjectDirectoryHandle,
  config: ProjectConfig,
): Promise<void> {
  await writeJson(root, "project.json", config);
  setPermissionProject(config);
}

export async function loadMembers(
  root: ProjectDirectoryHandle,
): Promise<Member[]> {
  const file = await readJson<MembersFile>(root, "members.json");

  return file.members;
}

export async function saveMembers(
  root: ProjectDirectoryHandle,
  members: Member[],
): Promise<void> {
  await writeJson<MembersFile>(root, "members.json", {
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

  await saveProject(root, nextProject);
  await appendEventToRoot(root, {
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

  await saveMembers(root, nextMembers);
  await appendEventToRoot(root, {
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

export function getProjectFiles(config: ProjectConfig): ProjectFile[] {
  return config.files;
}

export async function createProjectFile(
  root: ProjectDirectoryHandle,
  config: ProjectConfig,
  input: CreateProjectFileInput,
): Promise<ProjectConfig> {
  const name = normalizeProjectFileName(input.name);
  const fileId = uniqueFileId(config, name);
  const now = nowIso();
  const projectFile: ProjectFile = {
    id: fileId,
    name,
    source_path: `source/${name}`,
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

  await ensureDirectory(root, "source");
  await ensureDirectory(root, projectFile.entries_path);
  await writeTextFile(root, projectFile.source_path, input.sourceText);
  await saveProject(root, nextConfig);

  return nextConfig;
}

export async function addSourceFileToProject(
  root: ProjectDirectoryHandle,
  config: ProjectConfig,
  file: File,
  folder?: string,
  actor?: Member | null,
): Promise<ProjectFileImportResult> {
  assertCan(resolveProjectActor(actor), PERMISSION_ACTIONS.FILE_CREATE, config);
  assertSupportedImportFile(file.name);

  const sourceText = await file.text();
  const name = normalizeProjectFileName(file.name);
  const now = nowIso();
  const addedFile: ProjectFile = {
    id: uniqueFileId(config, name),
    name,
    source_path: `source/${name}`,
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
    await ensureDirectory(root, "source");
    await writeTextFile(root, addedFile.source_path, sourceText);
    await writeEntriesForFile(addedFile.id, entries);
    await saveProject(root, nextConfig);
  } catch (error) {
    const residualPaths = await cleanupFailedSourceImport(root, addedFile);
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
  root: ProjectDirectoryHandle,
  file: ProjectFile,
): Promise<string[]> {
  const residualPaths: string[] = [];

  for (const target of [
    { path: file.entries_path, recursive: true },
    { path: file.source_path, recursive: false },
  ]) {
    try {
      if (await fileExists(root, target.path)) {
        await deleteEntry(root, target.path, { recursive: target.recursive });
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
  assertCan(resolveProjectActor(actor), PERMISSION_ACTIONS.FILE_UPDATE, config);
  assertSupportedImportFile(sourceFile.name);

  const projectFile = config.files.find((file) => file.id === fileId);

  if (!projectFile) {
    throw new Error("没有找到要更新的文件。");
  }

  const sourceText = await sourceFile.text();
  const entries = await updateEntriesFromSourceFile(
    projectFile.id,
    sourceFile.name,
    sourceText,
  );

  await writeTextFile(root, projectFile.source_path, sourceText);

  return {
    config: await updateProjectFile(root, config, fileId, {
      updated_at: nowIso(),
    }, actor, PERMISSION_ACTIONS.FILE_UPDATE),
    entryCount: entries.length,
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

  await saveProject(root, nextConfig);

  return nextConfig;
}

export async function deleteProjectFile(
  root: ProjectDirectoryHandle,
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

  try {
    if (await fileExists(root, file.entries_path)) {
      await deleteEntry(root, file.entries_path, { recursive: true });
    }

    if (await fileExists(root, file.source_path)) {
      await deleteEntry(root, file.source_path);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误。";

    throw new Error(`删除文件失败，project.json 未更新。原因：${reason}`);
  }

  await saveProject(root, nextConfig);

  return nextConfig;
}

export async function validateProjectStructure(
  root: ProjectDirectoryHandle,
): Promise<ProjectStructureResult> {
  const missing: string[] = [];

  for (const path of REQUIRED_PROJECT_PATHS) {
    if (!(await fileExists(root, path))) {
      missing.push(path);
    }
  }

  if (missing.length > 0) {
    return { valid: false, missing };
  }

  const config = await loadProject(root);

  for (const file of config.files) {
    if (!(await fileExists(root, file.entries_path))) {
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
  root: ProjectDirectoryHandle,
): Promise<void> {
  const conflicts: string[] = [];

  for (const path of CREATION_CONFLICT_PATHS) {
    if (await fileExists(root, path)) {
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
  const result = await validateProjectStructure(root);

  if (!result.valid) {
    throw new Error(
      `这个文件夹不像一个项目文件夹，缺少：${result.missing.join("、")}。`,
    );
  }

  const [config, members] = await Promise.all([
    loadProject(root),
    loadMembers(root),
  ]);

  setPermissionProject(config);

  return { root, config, members, storageKind: root.storageKind ?? "folder" };
}

export async function createProjectInDirectory(
  root: ProjectDirectoryHandle,
  rawInput: CreateProjectInput,
): Promise<CreatedProject> {
  const input = normalizeCreateProjectInput(rawInput);

  assertCreateProjectInput(input);
  await assertProjectCanBeCreated(root);

  for (const path of PROJECT_DIRECTORIES) {
    await ensureDirectory(root, path);
  }

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
        allow_self_proofread: false,
        allow_self_review: false,
        allow_same_user_multi_proofread: false,
      },
      progress_weights: {
        translation: input.progressWeights.translation,
        proofread: input.progressWeights.proofread,
        review: input.progressWeights.review,
      },
      role_permissions: getDefaultRolePermissions(),
    },
  };
  const members = [owner];

  await Promise.all([
    saveProject(root, config),
    saveMembers(root, members),
    writeJsonl(root, "terms/terms.jsonl", []),
    writeJsonl(root, "tasks/tasks.jsonl", []),
    writeJsonl(root, "logs/events.jsonl", []),
  ]);

  return {
    project: { root, config, members, storageKind: "folder" },
    owner,
  };
}

export async function openProject(): Promise<OpenedProject> {
  const root = await openProjectDirectory();
  return openProjectRoot(root);
}

export async function openProjectFile(file: File): Promise<OpenedProject> {
  const root = await createProjectRootFromPackage(file);
  const config = await loadProject(root);
  const members = (await fileExists(root, "members.json"))
    ? await loadMembers(root)
    : [];

  setPermissionProject(config);

  return {
    root,
    config,
    members,
    storageKind: "packed",
    sourceFileName: file.name,
  };
}
