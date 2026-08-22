import type {
  Entry,
  ProjectConfig,
  ProjectFile,
  ReleaseExportFormat,
  ReleaseExportSettings,
} from "../model/types";
import {
  isEntryReleaseComplete,
  normalizeEntries,
} from "../model/status";
import { nowIso, utcDateKey } from "../utils/time";
import { sanitizeFileNamePart } from "../utils/fileNames";
import { mapWithConcurrency } from "../utils/async";
import { createZip, type ZipContent } from "../utils/zip";
import { exportCsvFile } from "./exporters/csvExporter";
import { exportJsonFile } from "./exporters/jsonExporter";
import { exportKsFile } from "./exporters/ksExporter";
import { exportTxtFile } from "./exporters/txtExporter";
import type { ProjectDirectoryHandle } from "./projectFs";
import {
  createProjectStorage,
  type ProjectStorage,
} from "./projectStorage";
import { calculateEntryProgress, type BasicProjectStats } from "./stats";
import {
  canExportRelease,
  getCurrentUser,
} from "./permissions";
import { getCachedEntriesForFile } from "./entries";

export interface ReleaseExportOptions {
  format: ReleaseExportFormat;
  only_reviewed: boolean;
  include_source: boolean;
  include_key: boolean;
}

export interface ExportProjectOptions extends Partial<ReleaseExportSettings> {
  format?: ReleaseExportFormat;
  exportedAt?: string;
}

export interface NormalizedReleaseExportSettings {
  default_format: ReleaseExportFormat;
  only_reviewed: boolean;
  include_source: boolean;
  include_key: boolean;
}

export interface ExportAdapterContext {
  project: ProjectConfig;
  projectFile: ProjectFile;
  baseName: string;
  entries: Entry[];
  options: ReleaseExportOptions;
}

export interface ExportedReleaseAsset {
  fileName: string;
  content: string;
}

export interface ReleaseFile {
  fileId: string;
  fileName: string;
  path: string;
  content: string;
  entries: Entry[];
}

export interface ReleaseExportSummary {
  totalEntries: number;
  reviewedEntries: number;
  untranslatedEntries: number;
  disputedEntries: number;
  exportEntries: number;
}

export interface ExportProjectResult {
  fileName: string;
  blob: Blob;
  summary: ReleaseExportSummary;
}

export const DEFAULT_RELEASE_EXPORT_SETTINGS: NormalizedReleaseExportSettings = {
  default_format: "json",
  only_reviewed: false,
  include_source: true,
  include_key: true,
};

let currentProjectStorage: ProjectStorage | null = null;

export function setExporterProjectRoot(root: ProjectDirectoryHandle): void {
  setExporterProjectStorage(createProjectStorage(root));
}

export function setExporterProjectStorage(storage: ProjectStorage): void {
  currentProjectStorage = storage;
}

function getProjectStorage(): ProjectStorage {
  if (!currentProjectStorage) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectStorage;
}

function assertReleaseExportPermission(): void {
  if (!canExportRelease(getCurrentUser())) {
    throw new Error("Permission denied.");
  }
}

function isReleaseExportFormat(
  value: ReleaseExportSettings["default_format"],
): value is ReleaseExportFormat {
  return value === "json" || value === "txt" || value === "csv" || value === "ks";
}

export function normalizeProjectExportSettings(
  settings?: ReleaseExportSettings,
): NormalizedReleaseExportSettings {
  return {
    default_format: isReleaseExportFormat(settings?.default_format)
      ? settings.default_format
      : DEFAULT_RELEASE_EXPORT_SETTINGS.default_format,
    only_reviewed:
      settings?.only_reviewed ?? DEFAULT_RELEASE_EXPORT_SETTINGS.only_reviewed,
    include_source:
      settings?.include_source ?? DEFAULT_RELEASE_EXPORT_SETTINGS.include_source,
    include_key: settings?.include_key ?? DEFAULT_RELEASE_EXPORT_SETTINGS.include_key,
  };
}

export function normalizeReleaseExportOptions(
  project: ProjectConfig,
  options: ExportProjectOptions = {},
): ReleaseExportOptions {
  const projectSettings = normalizeProjectExportSettings(project.settings.export);

  return {
    format: options.format ?? options.default_format ?? projectSettings.default_format,
    only_reviewed: options.only_reviewed ?? projectSettings.only_reviewed,
    include_source: options.include_source ?? projectSettings.include_source,
    include_key: options.include_key ?? projectSettings.include_key,
  };
}

async function loadProjectConfig(): Promise<ProjectConfig> {
  return getProjectStorage().readJson<ProjectConfig>("project.json");
}

async function loadEntryChunks(projectFile: ProjectFile): Promise<Entry[]> {
  const storage = getProjectStorage();
  const cachedEntries = getCachedEntriesForFile(projectFile.id, storage);

  if (cachedEntries) {
    return cachedEntries
      .filter((entry) => !entry.hidden)
      .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  }

  const fileNames = await storage.listFiles(projectFile.entries_path);
  const chunkFiles = fileNames
    .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const groups = await Promise.all(
    chunkFiles.map((fileName) =>
      storage.readJsonl<Entry>(`${projectFile.entries_path}/${fileName}`),
    ),
  );

  return normalizeEntries(groups.flat())
    .filter((entry) => !entry.hidden)
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
}

function fileNameWithoutExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function filterReleaseEntries(
  project: ProjectConfig,
  entries: Entry[],
  options: ReleaseExportOptions,
): Entry[] {
  return options.only_reviewed
    ? entries.filter((entry) =>
        isEntryReleaseComplete(entry, project.settings.workflow),
      )
    : entries;
}

function exportWithAdapter(
  context: ExportAdapterContext,
): ExportedReleaseAsset {
  if (context.options.format === "json") {
    return exportJsonFile(context);
  }

  if (context.options.format === "csv") {
    return exportCsvFile(context);
  }

  if (context.options.format === "ks") {
    return exportKsFile(context);
  }

  return exportTxtFile(context);
}

function buildSummary(
  project: ProjectConfig,
  entries: Entry[],
  exportEntries: Entry[],
): ReleaseExportSummary {
  const stats: BasicProjectStats = calculateEntryProgress(
    entries,
    project.settings.progress_weights,
    project.settings.workflow,
  );

  return {
    totalEntries: stats.totalEntries,
    reviewedEntries: stats.reviewedEntries,
    untranslatedEntries: stats.untranslatedEntries,
    disputedEntries: stats.disputedEntries,
    exportEntries: exportEntries.length,
  };
}

async function collectReleaseFiles(
  project: ProjectConfig,
  options: ReleaseExportOptions,
): Promise<{
  files: ReleaseFile[];
  allEntries: Entry[];
  exportEntries: Entry[];
}> {
  const files: ReleaseFile[] = [];
  const allEntries: Entry[] = [];

  for (const projectFile of project.files.filter((file) => !file.hidden)) {
    const entries = await loadEntryChunks(projectFile);
    const releaseEntries = filterReleaseEntries(project, entries, options);
    const baseName = fileNameWithoutExtension(projectFile.name);
    const asset = exportWithAdapter({
      project,
      projectFile,
      baseName,
      entries: releaseEntries,
      options,
    });

    allEntries.push(...entries);
    files.push({
      fileId: projectFile.id,
      fileName: asset.fileName,
      path: asset.fileName,
      content: asset.content,
      entries: releaseEntries,
    });
  }

  assertUniqueReleasePaths(files);

  return {
    files,
    allEntries,
    exportEntries: files.flatMap((file) => file.entries),
  };
}

function assertUniqueReleasePaths(files: ReleaseFile[]): void {
  const seen = new Map<string, ReleaseFile>();

  for (const file of files) {
    const normalizedPath = file.path.toLocaleLowerCase();
    const existing = seen.get(normalizedPath);

    if (existing) {
      throw new Error(
        `导出后会产生同名文件“${file.fileName}”。请先调整项目中的原文件名，再导出成品。`,
      );
    }

    seen.set(normalizedPath, file);
  }
}

export async function exportFile(
  fileId: string,
  options: ExportProjectOptions = {},
): Promise<ReleaseFile> {
  assertReleaseExportPermission();

  const config = await loadProjectConfig();
  const releaseOptions = normalizeReleaseExportOptions(config, options);
  const projectFile = config.files.find((file) => file.id === fileId);

  if (!projectFile) {
    throw new Error("没有找到要导出的文件。请检查项目配置。");
  }

  const entries = filterReleaseEntries(
    config,
    await loadEntryChunks(projectFile),
    releaseOptions,
  );
  const asset = exportWithAdapter({
    project: config,
    projectFile,
    baseName: fileNameWithoutExtension(projectFile.name),
    entries,
    options: releaseOptions,
  });

  return {
    fileId: projectFile.id,
    fileName: asset.fileName,
    path: asset.fileName,
    content: asset.content,
    entries,
  };
}

export async function generateReleaseZip(
  releaseFiles: ReleaseFile[],
): Promise<Blob> {
  const files: ZipContent = {};

  for (const file of releaseFiles) {
    files[file.path] = file.content;
  }

  return createZip(files);
}

export async function getReleaseExportSummary(
  options: ExportProjectOptions = {},
): Promise<ReleaseExportSummary> {
  assertReleaseExportPermission();

  const config = await loadProjectConfig();
  const releaseOptions = normalizeReleaseExportOptions(config, options);
  const entryGroups = await mapWithConcurrency(
    config.files.filter((file) => !file.hidden),
    8,
    (file) => loadEntryChunks(file),
  );
  const allEntries = entryGroups.flat();
  const exportEntries = filterReleaseEntries(
    config,
    allEntries,
    releaseOptions,
  );

  return buildSummary(config, allEntries, exportEntries);
}

export function getReleaseExportSuggestedFileName(
  projectName: string,
  exportedAt = nowIso(),
): string {
  return `成品-${sanitizeFileNamePart(projectName, "Textile项目")}-${utcDateKey(exportedAt)}.zip`;
}

export async function exportProject(
  options: ExportProjectOptions = {},
): Promise<ExportProjectResult> {
  assertReleaseExportPermission();

  const config = await loadProjectConfig();
  const releaseOptions = normalizeReleaseExportOptions(config, options);
  const { files, allEntries, exportEntries } = await collectReleaseFiles(
    config,
    releaseOptions,
  );

  if (files.length === 0) {
    throw new Error("当前项目没有可导出的文件。");
  }

  const exportedAt = options.exportedAt ?? nowIso();

  return {
    fileName: getReleaseExportSuggestedFileName(config.name, exportedAt),
    blob: await generateReleaseZip(files),
    summary: buildSummary(config, allEntries, exportEntries),
  };
}
