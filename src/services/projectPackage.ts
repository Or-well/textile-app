import type { ProjectConfig } from "../model/types";
import { parseJsonl } from "../utils/jsonl";
import { createZip, readZipEntries, type ZipContent } from "../utils/zip";
import {
  createMemoryProjectDirectory,
  deleteEntry,
  fileExists,
  listFiles,
  markProjectPackageExported,
  openProjectDirectory,
  readBinaryFile,
  readJson,
  type ProjectDirectoryHandle,
} from "./projectFs";
import { createProjectStorage } from "./projectStorage";
import { createProjectWritePlan } from "./projectWritePlan";

export interface ExportedProjectPackage {
  fileName: string;
  blob: Blob;
}

export interface PackedProjectInfo {
  root: ProjectDirectoryHandle;
  fileName: string;
}

export type ProjectPackageImportStatus = "ready" | "warning" | "blocked";

export interface ProjectPackagePreview {
  fileName: string;
  valid: boolean;
  projectName: string;
  projectDescription: string;
  projectId: string;
  revision: string;
  updatedAt: string;
  sourceLanguage: string;
  targetLanguage: string;
  projectFileCount: number;
  packageFileCount: number;
  memberCount: number;
  entryCount: number;
  includedDirectories: string[];
  missingPaths: string[];
  warnings: string[];
  importStatus: ProjectPackageImportStatus;
  importStatusText: string;
  suggestedFolderName: string;
}

export interface ImportedProjectPackage {
  root: ProjectDirectoryHandle;
  folderName: string;
  preview: ProjectPackagePreview;
}

export class ProjectPackageImportError extends Error {
  readonly cause: unknown;
  readonly residualPaths: string[];

  constructor(cause: unknown, residualPaths: string[]) {
    const reason = cause instanceof Error ? cause.message : "未知错误。";
    const visiblePaths = residualPaths.slice(0, 5);
    const remainingCount = residualPaths.length - visiblePaths.length;
    const residualMessage =
      visiblePaths.length > 0
        ? ` 已保留残留路径：${visiblePaths.join("、")}${
            remainingCount > 0 ? ` 等 ${residualPaths.length} 项` : ""
          }。`
        : "";

    super(`导入 Textile 项目文件失败。原因：${reason}${residualMessage}`);
    this.name = "ProjectPackageImportError";
    this.cause = cause;
    this.residualPaths = residualPaths;
  }
}

interface MembersFile {
  members?: unknown[];
}

interface NormalizedProjectPackage {
  files: Record<string, Uint8Array>;
  directories: string[];
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

const REQUIRED_IMPORT_PATHS = [
  "project.json",
  "members.json",
  "entries",
  "terms",
  "tasks",
] as const;

const textDecoder = new TextDecoder();

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

function decodePackageText(content: Uint8Array): string {
  return textDecoder.decode(content);
}

function parsePackageJson<T>(
  files: Record<string, Uint8Array>,
  path: string,
  fallbackMessage: string,
): T {
  const content = files[path];

  if (!content) {
    throw new Error(fallbackMessage);
  }

  try {
    return JSON.parse(decodePackageText(content)) as T;
  } catch {
    throw new Error(`项目文件 ${path} 格式有问题，无法读取。`);
  }
}

function readPackageProjectConfig(
  files: Record<string, Uint8Array>,
): ProjectConfig {
  const project = parsePackageJson<ProjectConfig>(
    files,
    "project.json",
    "这个项目文件缺少项目配置，无法读取。",
  );

  if (
    !project ||
    typeof project.project_id !== "string" ||
    typeof project.name !== "string" ||
    typeof project.source_language !== "string" ||
    typeof project.target_language !== "string" ||
    !project.settings ||
    !Array.isArray(project.files)
  ) {
    throw new Error("项目配置缺少必要字段，无法读取。");
  }

  return project;
}

function assertProjectPackageDataReadable(
  projectPackage: NormalizedProjectPackage,
): void {
  readPackageProjectConfig(projectPackage.files);

  const membersFile = parsePackageJson<MembersFile>(
    projectPackage.files,
    "members.json",
    "这个项目文件缺少成员数据，无法导入。",
  );

  if (!Array.isArray(membersFile.members)) {
    throw new Error("项目文件 members.json 缺少 members 数组，无法导入。");
  }

  for (const [path, content] of Object.entries(projectPackage.files)) {
    if (
      path.endsWith(".jsonl") &&
      ["entries/", "terms/", "tasks/", "comments/", "logs/"].some(
        (prefix) => path.startsWith(prefix),
      )
    ) {
      try {
        parseJsonl(decodePackageText(content));
      } catch (error) {
        const reason = error instanceof Error ? error.message : "格式错误。";

        throw new Error(`项目数据文件 ${path} 格式有问题，无法导入。${reason}`);
      }
    }
  }
}

async function readNormalizedProjectPackage(
  file: File,
): Promise<NormalizedProjectPackage> {
  const rawEntries = await readZipEntries(file);
  const files: Record<string, Uint8Array> = {};
  const directories = new Set<string>();

  for (const path of rawEntries.directories) {
    const normalizedPath = normalizePackagePath(path);

    if (normalizedPath) {
      directories.add(normalizedPath);
    }
  }

  for (const [path, content] of Object.entries(rawEntries.files)) {
    const normalizedPath = normalizePackagePath(path);

    if (!normalizedPath) {
      continue;
    }

    files[normalizedPath] = content;
    rememberPackageParentDirectories(directories, normalizedPath);
  }

  return {
    files,
    directories: Array.from(directories).sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function rememberPackageParentDirectories(
  directories: Set<string>,
  path: string,
): void {
  const parts = normalizePackagePath(path).split("/");

  parts.pop();

  for (let index = 1; index <= parts.length; index += 1) {
    directories.add(parts.slice(0, index).join("/"));
  }
}

function packagePathExists(
  projectPackage: NormalizedProjectPackage,
  path: string,
): boolean {
  const normalizedPath = normalizePackagePath(path);
  const prefix = `${normalizedPath}/`;

  return (
    Boolean(projectPackage.files[normalizedPath]) ||
    projectPackage.directories.includes(normalizedPath) ||
    Object.keys(projectPackage.files).some((filePath) =>
      filePath.startsWith(prefix),
    )
  );
}

function getDirectoryPath(path: string): string {
  const parts = normalizePackagePath(path).split("/");

  parts.pop();

  return parts.join("/");
}

function sanitizeImportFolderName(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80);

  if (!sanitized) {
    return "Textile项目";
  }

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(sanitized)) {
    return `${sanitized}-项目`;
  }

  return sanitized;
}

function buildImportFolderName(project: ProjectConfig, fileName: string): string {
  const packageName = fileName.replace(/\.hproj$/i, "");
  const baseName = project.name.trim() || packageName || "Textile项目";
  const idText = project.project_id.replace(/[^a-zA-Z0-9]+/g, "").slice(-8);
  const folderName = idText ? `${baseName}-${idText}` : baseName;

  return sanitizeImportFolderName(folderName);
}

function countPackageEntries(files: Record<string, Uint8Array>): number {
  return Object.entries(files).reduce((total, [path, content]) => {
    if (!path.startsWith("entries/") || !path.endsWith(".jsonl")) {
      return total;
    }

    return (
      total +
      decodePackageText(content)
        .split(/\r?\n/)
        .filter((line) => line.trim()).length
    );
  }, 0);
}

function countPackageMembers(files: Record<string, Uint8Array>): number {
  if (!files["members.json"]) {
    return 0;
  }

  try {
    const membersFile = JSON.parse(decodePackageText(files["members.json"])) as MembersFile;

    return Array.isArray(membersFile.members) ? membersFile.members.length : 0;
  } catch {
    return 0;
  }
}

function normalizeProjectDescription(project: ProjectConfig): string {
  return project.description?.trim() ?? "";
}

function getImportStatus(
  missingPaths: string[],
  warnings: string[],
): { importStatus: ProjectPackageImportStatus; importStatusText: string } {
  if (missingPaths.length > 0) {
    return {
      importStatus: "blocked",
      importStatusText: "缺少必要数据",
    };
  }

  if (warnings.length > 0) {
    return {
      importStatus: "warning",
      importStatusText: "需注意",
    };
  }

  return {
    importStatus: "ready",
    importStatusText: "结构完整",
  };
}

function getIncludedDirectories(
  projectPackage: NormalizedProjectPackage,
): string[] {
  return PACKED_PROJECT_DIRECTORIES.filter((path) =>
    packagePathExists(projectPackage, path),
  );
}

function getMissingImportPaths(
  projectPackage: NormalizedProjectPackage,
): string[] {
  return REQUIRED_IMPORT_PATHS.filter(
    (path) => !packagePathExists(projectPackage, path),
  );
}

function buildPreview(
  file: File,
  projectPackage: NormalizedProjectPackage,
): ProjectPackagePreview {
  const warnings: string[] = [];
  let project: ProjectConfig | null = null;

  try {
    project = readPackageProjectConfig(projectPackage.files);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "这个项目文件无法读取。";

    return {
      fileName: file.name || "project.hproj",
      valid: false,
      projectName: "",
      projectDescription: "",
      projectId: "",
      revision: "",
      updatedAt: "",
      sourceLanguage: "",
      targetLanguage: "",
      projectFileCount: 0,
      packageFileCount: Object.keys(projectPackage.files).length,
      memberCount: countPackageMembers(projectPackage.files),
      entryCount: countPackageEntries(projectPackage.files),
      includedDirectories: getIncludedDirectories(projectPackage),
      missingPaths: ["project.json"],
      warnings: [message],
      importStatus: "blocked",
      importStatusText: "缺少必要数据",
      suggestedFolderName: "Textile项目",
    };
  }

  const missingPaths = getMissingImportPaths(projectPackage);

  for (const fileConfig of project.files) {
    if (!packagePathExists(projectPackage, fileConfig.entries_path)) {
      missingPaths.push(fileConfig.entries_path);
    }

    if (
      fileConfig.source_path &&
      !packagePathExists(projectPackage, fileConfig.source_path)
    ) {
      warnings.push(`缺少源文件：${fileConfig.source_path}`);
    }
  }
  const uniqueMissingPaths = Array.from(new Set(missingPaths));
  const status = getImportStatus(uniqueMissingPaths, warnings);

  return {
    fileName: file.name || "project.hproj",
    valid: uniqueMissingPaths.length === 0,
    projectName: project.name,
    projectDescription: normalizeProjectDescription(project),
    projectId: project.project_id,
    revision: project.revision ?? "",
    updatedAt: project.updated_at ?? "",
    sourceLanguage: project.source_language,
    targetLanguage: project.target_language,
    projectFileCount: project.files.length,
    packageFileCount: Object.keys(projectPackage.files).length,
    memberCount: countPackageMembers(projectPackage.files),
    entryCount: countPackageEntries(projectPackage.files),
    includedDirectories: getIncludedDirectories(projectPackage),
    missingPaths: uniqueMissingPaths,
    warnings,
    ...status,
    suggestedFolderName: buildImportFolderName(project, file.name || "project.hproj"),
  };
}

function getPackageDirectories(
  projectPackage: NormalizedProjectPackage,
): string[] {
  const directories = new Set<string>([
    ...PACKED_PROJECT_DIRECTORIES,
    ...projectPackage.directories,
  ]);

  for (const path of Object.keys(projectPackage.files)) {
    const directoryPath = getDirectoryPath(path);

    if (directoryPath) {
      directories.add(directoryPath);
    }
  }

  return Array.from(directories).sort(
    (left, right) =>
      left.split("/").length - right.split("/").length ||
      left.localeCompare(right),
  );
}

function getPackageFileEntries(
  projectPackage: NormalizedProjectPackage,
): Array<[string, Uint8Array]> {
  return Object.entries(projectPackage.files).sort(([left], [right]) => {
    if (left === "project.json") {
      return 1;
    }

    if (right === "project.json") {
      return -1;
    }

    return left.localeCompare(right);
  });
}

interface DirectoryScanResult {
  files: string[];
  directories: string[];
  inaccessible: string[];
}

async function scanDirectoryTree(
  root: ProjectDirectoryHandle,
  path = "",
): Promise<DirectoryScanResult> {
  const result: DirectoryScanResult = {
    files: [],
    directories: [],
    inaccessible: [],
  };
  let names: string[];

  try {
    names = await listFiles(root, path);
  } catch {
    result.inaccessible.push(path);
    return result;
  }

  for (const name of names) {
    const childPath = [path, name].filter(Boolean).join("/");

    try {
      await readBinaryFile(root, childPath);
      result.files.push(childPath);
      continue;
    } catch {
      // Directories cannot be read as files.
    }

    try {
      const childResult = await scanDirectoryTree(root, childPath);

      result.directories.push(childPath, ...childResult.directories);
      result.files.push(...childResult.files);
      result.inaccessible.push(...childResult.inaccessible);
    } catch {
      result.inaccessible.push(childPath);
    }
  }

  return result;
}

function sortDeepestFirst(paths: string[]): string[] {
  return [...paths].sort((left, right) => {
    const depthDiff = right.split("/").length - left.split("/").length;

    return depthDiff || right.localeCompare(left);
  });
}

async function listResidualImportPaths(
  parentRoot: ProjectDirectoryHandle,
  folderName: string,
): Promise<string[]> {
  if (!(await fileExists(parentRoot, folderName))) {
    return [];
  }

  try {
    const targetRoot = await parentRoot.getDirectoryHandle(folderName);
    const scan = await scanDirectoryTree(targetRoot);
    const paths = [
      ...scan.files,
      ...scan.directories,
      ...scan.inaccessible,
    ];

    if (paths.length === 0) {
      return [folderName];
    }

    return Array.from(
      new Set(
        paths.map((path) => (path ? `${folderName}/${path}` : folderName)),
      ),
    ).sort((left, right) => left.localeCompare(right));
  } catch {
    return [folderName];
  }
}

async function cleanupFailedProjectImport(
  parentRoot: ProjectDirectoryHandle,
  folderName: string,
): Promise<string[]> {
  try {
    await deleteEntry(parentRoot, folderName, { recursive: true });
  } catch {
    // Fall through to leaf-first cleanup.
  }

  if (!(await fileExists(parentRoot, folderName))) {
    return [];
  }

  try {
    const targetRoot = await parentRoot.getDirectoryHandle(folderName);
    const scan = await scanDirectoryTree(targetRoot);

    for (const path of sortDeepestFirst(scan.files)) {
      try {
        await deleteEntry(targetRoot, path);
      } catch {
        // Residual scan below reports paths that could not be removed.
      }
    }

    for (const path of sortDeepestFirst(scan.directories)) {
      try {
        await deleteEntry(targetRoot, path);
      } catch {
        // Non-empty or inaccessible directories are reported below.
      }
    }

    try {
      await deleteEntry(parentRoot, folderName, { recursive: true });
    } catch {
      // Residual scan below reports the final state.
    }
  } catch {
    // Residual scan below reports the target directory itself.
  }

  return listResidualImportPaths(parentRoot, folderName);
}

async function importPreparedProjectPackage(
  projectPackage: NormalizedProjectPackage,
  preview: ProjectPackagePreview,
  parentRoot: ProjectDirectoryHandle,
): Promise<ImportedProjectPackage> {
  const folderName = preview.suggestedFolderName;

  if (await fileExists(parentRoot, folderName)) {
    throw new Error(
      `目标位置已存在 ${folderName}，请换一个导入位置或先移动已有文件夹。`,
    );
  }

  const targetRoot = await parentRoot.getDirectoryHandle(folderName, {
    create: true,
  });
  const targetStorage = createProjectStorage(targetRoot);
  let existingNames: string[];

  try {
    existingNames = await targetStorage.listFiles("");
  } catch (error) {
    const residualPaths = await cleanupFailedProjectImport(
      parentRoot,
      folderName,
    );

    throw new ProjectPackageImportError(error, residualPaths);
  }

  if (existingNames.length > 0) {
    throw new Error(
      `目标目录 ${folderName} 在导入前已包含内容，已停止导入以避免覆盖。`,
    );
  }

  const writePlan = createProjectWritePlan(targetStorage);

  for (const directory of getPackageDirectories(projectPackage)) {
    writePlan.ensureDirectory(directory);
  }

  for (const [path, content] of getPackageFileEntries(projectPackage)) {
    writePlan.writeBinary(path, content);
  }

  try {
    await writePlan.execute({ verifyWrites: true });
  } catch (error) {
    const residualPaths = await cleanupFailedProjectImport(
      parentRoot,
      folderName,
    );

    throw new ProjectPackageImportError(error, residualPaths);
  }

  return {
    root: targetRoot,
    folderName,
    preview,
  };
}

async function prepareProjectPackageImport(file: File): Promise<{
  projectPackage: NormalizedProjectPackage;
  preview: ProjectPackagePreview;
}> {
  const projectPackage = await readNormalizedProjectPackage(file);
  const preview = buildPreview(file, projectPackage);

  if (!preview.valid) {
    throw new Error(
      `这个 Textile 项目文件不能导入，缺少：${preview.missingPaths.join("、")}。`,
    );
  }

  assertProjectPackageDataReadable(projectPackage);

  return { projectPackage, preview };
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

  return {
    fileName: buildPackageFileName(project),
    blob,
  };
}

export function completeProjectPackageExport(
  root: ProjectDirectoryHandle,
): void {
  markProjectPackageExported(root);
}

export async function inspectProjectPackage(
  file: File,
): Promise<ProjectPackagePreview> {
  return buildPreview(file, await readNormalizedProjectPackage(file));
}

export async function importProjectPackageToDirectory(
  file: File,
): Promise<ImportedProjectPackage> {
  const { projectPackage, preview } = await prepareProjectPackageImport(file);
  const parentRoot = await openProjectDirectory();

  return importPreparedProjectPackage(projectPackage, preview, parentRoot);
}

export async function importProjectPackageToParentDirectory(
  file: File,
  parentRoot: ProjectDirectoryHandle,
): Promise<ImportedProjectPackage> {
  const { projectPackage, preview } = await prepareProjectPackageImport(file);

  return importPreparedProjectPackage(projectPackage, preview, parentRoot);
}

export async function createProjectRootFromPackage(
  file: File,
): Promise<ProjectDirectoryHandle> {
  const projectPackage = await readNormalizedProjectPackage(file);
  const files: Record<string, Uint8Array> = {};

  for (const [path, content] of Object.entries(projectPackage.files)) {
    const normalizedPath = normalizePackagePath(path);

    if (normalizedPath) {
      files[normalizedPath] = content;
    }
  }

  if (!files["project.json"]) {
    throw new Error("这个项目文件缺少项目配置，无法打开。");
  }

  return createMemoryProjectDirectory(
    files,
    file.name || "project.hproj",
    projectPackage.directories,
  );
}
