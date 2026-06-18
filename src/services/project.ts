import type { Member, ProjectConfig, ProjectFile } from "../model/types";
import { createId } from "../utils/id";
import { nowIso } from "../utils/time";
import { createPasswordFields } from "./auth";
import { createProjectRootFromPackage } from "./projectPackage";
import {
  ensureDirectory,
  fileExists,
  openProjectDirectory,
  readJson,
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
  proofreadRequired: number;
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
    proofreadRequired: input.enableProofread
      ? Math.max(0, Math.min(3, Math.trunc(Number(input.proofreadRequired))))
      : 0,
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
        enable_proofread: input.enableProofread,
        enable_review: input.enableReview,
        proofread_required: input.proofreadRequired,
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
