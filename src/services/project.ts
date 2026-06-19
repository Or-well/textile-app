import type { Member, ProjectConfig, ProjectFile, ProofreadRequired } from "../model/types";
import { createId } from "../utils/id";
import { nowIso } from "../utils/time";
import { createPasswordFields } from "./auth";
import {
  createEntriesFromSourceFile,
  importEntryTranslations,
  updateEntriesFromSourceFile,
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
): Promise<ProjectFileImportResult> {
  assertSupportedImportFile(file.name);

  const sourceText = await file.text();
  const nextConfig = await createProjectFile(root, config, {
    name: file.name,
    sourceText,
    type: getFileType(file.name),
    folder,
  });
  const addedFile = nextConfig.files.find(
    (projectFile) =>
      !config.files.some((existingFile) => existingFile.id === projectFile.id),
  );

  if (!addedFile) {
    throw new Error("源文件记录创建失败。");
  }

  const entries = await createEntriesFromSourceFile(
    addedFile.id,
    file.name,
    sourceText,
  );

  return {
    config: nextConfig,
    file: addedFile,
    entryCount: entries.length,
  };
}

export async function updateSourceFileInProject(
  root: ProjectDirectoryHandle,
  config: ProjectConfig,
  fileId: string,
  sourceFile: File,
): Promise<ProjectFileUpdateResult> {
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
    }),
    entryCount: entries.length,
  };
}

export async function importTranslationFileToProject(
  root: ProjectDirectoryHandle,
  config: ProjectConfig,
  fileId: string,
  translationFile: File,
): Promise<ProjectFileTranslationImportResult> {
  assertSupportedImportFile(translationFile.name);

  const projectFile = config.files.find((file) => file.id === fileId);

  if (!projectFile) {
    throw new Error("没有找到要导入译文的文件。");
  }

  const result = await importEntryTranslations(
    projectFile.id,
    translationFile.name,
    await translationFile.text(),
  );

  return {
    config: await updateProjectFile(root, config, fileId, {
      updated_at: nowIso(),
    }),
    ...result,
  };
}

export async function updateProjectFile(
  root: ProjectDirectoryHandle,
  config: ProjectConfig,
  fileId: string,
  patch: UpdateProjectFilePatch,
): Promise<ProjectConfig> {
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
): Promise<ProjectConfig> {
  const file = config.files.find((item) => item.id === fileId);

  if (!file) {
    throw new Error("没有找到要删除的文件。");
  }

  const nextConfig: ProjectConfig = {
    ...config,
    files: config.files.filter((item) => item.id !== fileId),
  };

  await saveProject(root, nextConfig);

  if (await fileExists(root, file.entries_path)) {
    await deleteEntry(root, file.entries_path, { recursive: true });
  }

  if (await fileExists(root, file.source_path)) {
    await deleteEntry(root, file.source_path);
  }

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
    name: input.name,
    description: input.description,
    source_language: input.sourceLanguage,
    target_language: input.targetLanguage,
    files: [],
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

  return {
    root,
    config,
    members,
    storageKind: "packed",
    sourceFileName: file.name,
  };
}
