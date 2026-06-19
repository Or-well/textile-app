import type { ProjectConfig } from "../model/types";
import { createZip, readZipBytes, type ZipContent } from "../utils/zip";
import {
  createMemoryProjectDirectory,
  fileExists,
  listFiles,
  markProjectPackageExported,
  readBinaryFile,
  readJson,
  type ProjectDirectoryHandle,
} from "./projectFs";

export interface ExportedProjectPackage {
  fileName: string;
  blob: Blob;
}

export interface PackedProjectInfo {
  root: ProjectDirectoryHandle;
  fileName: string;
}

const PACKED_PROJECT_DIRECTORIES = [
  "source",
  "entries",
  "terms",
  "tasks",
  "comments",
  "logs",
  "exports",
  "changes",
] as const;

function normalizePackagePath(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalizedPath
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.some((part) => part === "..")) {
    throw new Error("项目文件路径不正确，无法打开。");
  }

  return parts.join("/");
}

function buildPackageFileName(project: ProjectConfig): string {
  const safeProjectId = project.project_id
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const baseName = safeProjectId || "translation-project";
  const dateText = new Date().toISOString().slice(0, 10);

  return `${baseName}-${dateText}.hproj`;
}

async function addFileIfExists(
  root: ProjectDirectoryHandle,
  files: ZipContent,
  path: string,
): Promise<void> {
  if (!(await fileExists(root, path))) {
    return;
  }

  files[path] = await readBinaryFile(root, path);
}

async function collectDirectory(
  root: ProjectDirectoryHandle,
  files: ZipContent,
  path: string,
): Promise<void> {
  if (!(await fileExists(root, path))) {
    return;
  }

  let names: string[];

  try {
    names = await listFiles(root, path);
  } catch {
    return;
  }

  files[`${path}/`] = null;

  for (const name of names) {
    const childPath = `${path}/${name}`;

    try {
      files[childPath] = await readBinaryFile(root, childPath);
    } catch {
      await collectDirectory(root, files, childPath);
    }
  }
}

export async function exportProjectPackage(
  root: ProjectDirectoryHandle,
): Promise<ExportedProjectPackage> {
  if (!(await fileExists(root, "project.json"))) {
    throw new Error("当前项目缺少项目配置，无法导出为项目文件。");
  }

  const project = await readJson<ProjectConfig>(root, "project.json");
  const files: ZipContent = {};

  files["project.json"] = await readBinaryFile(root, "project.json");
  await addFileIfExists(root, files, "members.json");

  for (const directory of PACKED_PROJECT_DIRECTORIES) {
    await collectDirectory(root, files, directory);
  }

  const blob = await createZip(files);

  markProjectPackageExported(root);

  return {
    fileName: buildPackageFileName(project),
    blob,
  };
}

export async function createProjectRootFromPackage(
  file: File,
): Promise<ProjectDirectoryHandle> {
  const rawFiles = await readZipBytes(file);
  const files: Record<string, Uint8Array> = {};

  for (const [path, content] of Object.entries(rawFiles)) {
    const normalizedPath = normalizePackagePath(path);

    if (normalizedPath) {
      files[normalizedPath] = content;
    }
  }

  if (!files["project.json"]) {
    throw new Error("这个项目文件缺少项目配置，无法打开。");
  }

  return createMemoryProjectDirectory(files, file.name || "project.hproj");
}
