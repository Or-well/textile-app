import type { Member, ProjectConfig, ProjectFile } from "../model/types";
import {
  fileExists,
  openProjectDirectory,
  readJson,
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
}

export interface ProjectStructureResult {
  valid: boolean;
  missing: string[];
}

const REQUIRED_PROJECT_PATHS = [
  "project.json",
  "members.json",
  "entries",
  "terms",
  "tasks",
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

export async function openProject(): Promise<OpenedProject> {
  const root = await openProjectDirectory();
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

  return { root, config, members };
}
