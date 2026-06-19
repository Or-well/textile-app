import type {
  Entry,
  ProjectConfig,
  ProjectFile,
  ReleaseExportFormat,
  ReleaseExportSettings,
  Term,
} from "../model/types";
import { normalizeEntries } from "../model/status";
import { nowIso } from "../utils/time";
import { createZip, type ZipContent } from "../utils/zip";
import { exportCsvFile } from "./exporters/csvExporter";
import { exportJsonFile } from "./exporters/jsonExporter";
import { exportKsFile } from "./exporters/ksExporter";
import { exportTxtFile } from "./exporters/txtExporter";
import {
  listFiles,
  readJson,
  readJsonl,
  type ProjectDirectoryHandle,
} from "./projectFs";
import { calculateEntryProgress, type BasicProjectStats } from "./stats";
import { checkTermUsageWithTerms } from "./terms";

export interface ReleaseExportOptions {
  format: ReleaseExportFormat;
  only_reviewed: boolean;
  include_source: boolean;
  include_key: boolean;
  include_report: boolean;
  include_manifest: boolean;
}

export interface ExportProjectOptions extends Partial<ReleaseExportSettings> {
  format?: ReleaseExportFormat;
  exportedBy?: string;
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

export interface ReleaseManifest {
  schema_version: number;
  project_id: string;
  project_name: string;
  exported_at: string;
  exported_by: string;
  app_version: string;
  entry_count: number;
  format: ReleaseExportFormat;
  only_reviewed: boolean;
  include_source: boolean;
  include_key: boolean;
  reports: string[];
  files: {
    id: string;
    name: string;
    path: string;
    entries: number;
  }[];
}

export interface ReleaseExportSummary {
  totalEntries: number;
  reviewedEntries: number;
  untranslatedEntries: number;
  disputedEntries: number;
  exportEntries: number;
}

export interface ReleaseProjectData {
  manifest: ReleaseManifest;
  files: ReleaseFile[];
  options: ReleaseExportOptions;
  untranslatedReport: string;
  disputeReport: string;
  termCheckReport: string;
}

export interface ExportProjectResult {
  fileName: string;
  blob: Blob;
  manifest: ReleaseManifest;
  summary: ReleaseExportSummary;
}

const EXPORT_APP_VERSION = "0.3.0";
const REPORT_NAMES = ["untranslated", "disputes", "term-check"] as const;

export const DEFAULT_RELEASE_EXPORT_SETTINGS: Required<ReleaseExportSettings> = {
  default_format: "json",
  only_reviewed: false,
  include_source: true,
  include_key: true,
  include_report: true,
  include_manifest: true,
};

let currentProjectRoot: ProjectDirectoryHandle | null = null;

export function setExporterProjectRoot(root: ProjectDirectoryHandle): void {
  currentProjectRoot = root;
}

function getProjectRoot(): ProjectDirectoryHandle {
  if (!currentProjectRoot) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectRoot;
}

function isReleaseExportFormat(
  value: ReleaseExportSettings["default_format"],
): value is ReleaseExportFormat {
  return value === "json" || value === "txt" || value === "csv" || value === "ks";
}

export function normalizeProjectExportSettings(
  settings?: ReleaseExportSettings,
): Required<ReleaseExportSettings> {
  return {
    default_format: isReleaseExportFormat(settings?.default_format)
      ? settings.default_format
      : DEFAULT_RELEASE_EXPORT_SETTINGS.default_format,
    only_reviewed:
      settings?.only_reviewed ?? DEFAULT_RELEASE_EXPORT_SETTINGS.only_reviewed,
    include_source:
      settings?.include_source ?? DEFAULT_RELEASE_EXPORT_SETTINGS.include_source,
    include_key: settings?.include_key ?? DEFAULT_RELEASE_EXPORT_SETTINGS.include_key,
    include_report:
      settings?.include_report ?? DEFAULT_RELEASE_EXPORT_SETTINGS.include_report,
    include_manifest:
      settings?.include_manifest ?? DEFAULT_RELEASE_EXPORT_SETTINGS.include_manifest,
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
    include_report: options.include_report ?? projectSettings.include_report,
    include_manifest: options.include_manifest ?? projectSettings.include_manifest,
  };
}

async function loadProjectConfig(): Promise<ProjectConfig> {
  return readJson<ProjectConfig>(getProjectRoot(), "project.json");
}

async function loadEntryChunks(projectFile: ProjectFile): Promise<Entry[]> {
  const root = getProjectRoot();
  const fileNames = await listFiles(root, projectFile.entries_path);
  const chunkFiles = fileNames
    .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const groups = await Promise.all(
    chunkFiles.map((fileName) =>
      readJsonl<Entry>(root, `${projectFile.entries_path}/${fileName}`),
    ),
  );

  return normalizeEntries(groups.flat())
    .filter((entry) => !entry.hidden)
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
}

async function loadTermsForReport(): Promise<Term[]> {
  try {
    return readJsonl<Term>(getProjectRoot(), "terms/terms.jsonl");
  } catch {
    return [];
  }
}

function fileNameWithoutExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function filterReleaseEntries(
  entries: Entry[],
  options: ReleaseExportOptions,
): Entry[] {
  return options.only_reviewed
    ? entries.filter((entry) => entry.status === "reviewed")
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

function formatReportEntry(entry: Entry): string {
  return [
    entry.id,
    entry.key,
    entry.speaker || "-",
    entry.status,
    entry.source,
    entry.target || "-",
  ].join("\t");
}

export function generateUntranslatedReport(entries: Entry[]): string {
  const rows = entries.filter((entry) => entry.status === "untranslated");

  if (rows.length === 0) {
    return "未翻译词条：0\n";
  }

  return [
    `未翻译词条：${rows.length}`,
    "词条\t键值\t说话人\t状态\t原文\t译文",
    ...rows.map(formatReportEntry),
    "",
  ].join("\n");
}

export function generateDisputeReport(entries: Entry[]): string {
  const rows = entries.filter((entry) => entry.disputed === true);

  if (rows.length === 0) {
    return "争议词条：0\n";
  }

  return [
    `争议词条：${rows.length}`,
    "词条\t键值\t说话人\t状态\t原文\t译文",
    ...rows.map(formatReportEntry),
    "",
  ].join("\n");
}

export function generateTermCheckReport(entries: Entry[], terms: Term[]): string {
  const issues = entries.flatMap((entry) =>
    checkTermUsageWithTerms(terms, entry.source, entry.target)
      .filter((result) => !result.isRecommendedUsed)
      .map((result) =>
        [
          entry.id,
          entry.key,
          result.matchedText,
          result.term.target,
          entry.source,
          entry.target || "-",
        ].join("\t"),
      ),
  );

  if (issues.length === 0) {
    return "术语问题：0\n";
  }

  return [
    `术语问题：${issues.length}`,
    "词条\t键值\t命中术语\t推荐译名\t原文\t译文",
    ...issues,
    "",
  ].join("\n");
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
    const releaseEntries = filterReleaseEntries(entries, options);
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
      path: `release/${asset.fileName}`,
      content: asset.content,
      entries: releaseEntries,
    });
  }

  return {
    files,
    allEntries,
    exportEntries: files.flatMap((file) => file.entries),
  };
}

function buildManifest(
  project: ProjectConfig,
  files: ReleaseFile[],
  options: ReleaseExportOptions,
  exportedAt: string,
  exportedBy = "",
): ReleaseManifest {
  return {
    schema_version: 1,
    project_id: project.project_id,
    project_name: project.name,
    exported_at: exportedAt,
    exported_by: exportedBy || "unknown_user",
    app_version: EXPORT_APP_VERSION,
    entry_count: files.reduce((total, file) => total + file.entries.length, 0),
    format: options.format,
    only_reviewed: options.only_reviewed,
    include_source: options.include_source,
    include_key: options.include_key,
    reports: options.include_report ? [...REPORT_NAMES] : [],
    files: files.map((file) => ({
      id: file.fileId,
      name: file.fileName,
      path: file.path,
      entries: file.entries.length,
    })),
  };
}

export async function exportFile(
  fileId: string,
  options: ExportProjectOptions = {},
): Promise<ReleaseFile> {
  const config = await loadProjectConfig();
  const releaseOptions = normalizeReleaseExportOptions(config, options);
  const projectFile = config.files.find((file) => file.id === fileId);

  if (!projectFile) {
    throw new Error("没有找到要导出的文件。请检查项目配置。");
  }

  const entries = filterReleaseEntries(await loadEntryChunks(projectFile), releaseOptions);
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
    path: `release/${asset.fileName}`,
    content: asset.content,
    entries,
  };
}

export async function generateReleaseZip(
  data: ReleaseProjectData,
): Promise<Blob> {
  const files: ZipContent = {
    "release/": null,
  };

  if (data.options.include_manifest) {
    files["manifest.json"] = `${JSON.stringify(data.manifest, null, 2)}\n`;
  }

  if (data.options.include_report) {
    files["reports/"] = null;
    files["reports/untranslated.txt"] = data.untranslatedReport;
    files["reports/disputes.txt"] = data.disputeReport;
    files["reports/term-check.txt"] = data.termCheckReport;
  }

  for (const file of data.files) {
    files[file.path] = file.content;
  }

  return createZip(files);
}

export async function getReleaseExportSummary(
  options: ExportProjectOptions = {},
): Promise<ReleaseExportSummary> {
  const config = await loadProjectConfig();
  const releaseOptions = normalizeReleaseExportOptions(config, options);
  const { allEntries, exportEntries } = await collectReleaseFiles(
    config,
    releaseOptions,
  );

  return buildSummary(config, allEntries, exportEntries);
}

export async function exportProject(
  options: ExportProjectOptions = {},
): Promise<ExportProjectResult> {
  const config = await loadProjectConfig();
  const releaseOptions = normalizeReleaseExportOptions(config, options);
  const { files, allEntries, exportEntries } = await collectReleaseFiles(
    config,
    releaseOptions,
  );

  if (files.length === 0) {
    throw new Error("当前项目没有可导出的文件。");
  }

  const terms = await loadTermsForReport();
  const exportedAt = nowIso();
  const manifest = buildManifest(
    config,
    files,
    releaseOptions,
    exportedAt,
    options.exportedBy,
  );
  const data: ReleaseProjectData = {
    manifest,
    files,
    options: releaseOptions,
    untranslatedReport: generateUntranslatedReport(allEntries),
    disputeReport: generateDisputeReport(allEntries),
    termCheckReport: generateTermCheckReport(allEntries, terms),
  };

  return {
    fileName: `release-${config.project_id}-${exportedAt.slice(0, 10)}.zip`,
    blob: await generateReleaseZip(data),
    manifest,
    summary: buildSummary(config, allEntries, exportEntries),
  };
}
