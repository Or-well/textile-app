import type { Entry, ProjectConfig, ProjectFile, Term } from "../model/types";
import { normalizeEntries } from "../model/status";
import { nowIso } from "../utils/time";
import { createZip, type ZipContent } from "../utils/zip";
import {
  listFiles,
  readJson,
  readJsonl,
  type ProjectDirectoryHandle,
} from "./projectFs";

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
  name: string;
  created_at: string;
  files: {
    id: string;
    name: string;
    path: string;
    entries: number;
  }[];
}

export interface ReleaseProjectData {
  manifest: ReleaseManifest;
  files: ReleaseFile[];
  untranslatedReport: string;
  disputeReport: string;
  termCheckReport: string;
}

export interface ExportProjectResult {
  fileName: string;
  blob: Blob;
  manifest: ReleaseManifest;
}

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

async function loadTerms(): Promise<Term[]> {
  try {
    return readJsonl<Term>(getProjectRoot(), "terms/terms.jsonl");
  } catch {
    return [];
  }
}

function buildReleaseText(entries: Entry[]): string {
  return `${entries.map((entry) => `${entry.key}\t${entry.target}`).join("\n")}\n`;
}

function fileNameWithoutExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function termAppearsInSource(term: Term, source: string): boolean {
  return (
    source.includes(term.source) ||
    term.variants.some((variant) => source.includes(variant))
  );
}

export async function exportFile(fileId: string): Promise<ReleaseFile> {
  const config = await loadProjectConfig();
  const projectFile = config.files.find((file) => file.id === fileId);

  if (!projectFile) {
    throw new Error("没有找到要导出的文件。请检查项目配置。");
  }

  const entries = await loadEntryChunks(projectFile);
  const releaseName = `${fileNameWithoutExtension(projectFile.name)}.txt`;

  return {
    fileId: projectFile.id,
    fileName: releaseName,
    path: `release/${releaseName}`,
    content: buildReleaseText(entries),
    entries,
  };
}

export function generateUntranslatedReport(entries: Entry[]): string {
  const rows = entries.filter((entry) => entry.status === "untranslated");

  if (rows.length === 0) {
    return "未翻译词条：0\n";
  }

  return [
    `未翻译词条：${rows.length}`,
    "",
    ...rows.map((entry) => `${entry.id}\t${entry.speaker}\t${entry.source}`),
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
    "",
    ...rows.map((entry) => `${entry.id}\t${entry.speaker}\t${entry.source}`),
    "",
  ].join("\n");
}

export function generateTermCheckReport(entries: Entry[], terms: Term[]): string {
  const issues = entries.flatMap((entry) =>
    terms
      .filter((term) => termAppearsInSource(term, entry.source))
      .filter((term) => !entry.target.includes(term.target))
      .map((term) => `${entry.id}\t${term.source} -> ${term.target}`),
  );

  if (issues.length === 0) {
    return "术语问题：0\n";
  }

  return [`术语问题：${issues.length}`, "", ...issues, ""].join("\n");
}

export async function generateReleaseZip(
  data: ReleaseProjectData,
): Promise<Blob> {
  const files: ZipContent = {
    "manifest.json": `${JSON.stringify(data.manifest, null, 2)}\n`,
    "release/": null,
    "reports/": null,
    "reports/untranslated.txt": data.untranslatedReport,
    "reports/disputes.txt": data.disputeReport,
    "reports/term-check.txt": data.termCheckReport,
  };

  for (const file of data.files) {
    files[file.path] = file.content;
  }

  return createZip(files);
}

export async function exportProject(): Promise<ExportProjectResult> {
  const config = await loadProjectConfig();
  const files = await Promise.all(
    config.files
      .filter((file) => !file.hidden)
      .map((file) => exportFile(file.id)),
  );
  const entries = files.flatMap((file) => file.entries);
  const terms = await loadTerms();
  const createdAt = nowIso();
  const manifest: ReleaseManifest = {
    schema_version: 1,
    project_id: config.project_id,
    name: config.name,
    created_at: createdAt,
    files: files.map((file) => ({
      id: file.fileId,
      name: file.fileName,
      path: file.path,
      entries: file.entries.length,
    })),
  };
  const data: ReleaseProjectData = {
    manifest,
    files,
    untranslatedReport: generateUntranslatedReport(entries),
    disputeReport: generateDisputeReport(entries),
    termCheckReport: generateTermCheckReport(entries, terms),
  };

  return {
    fileName: `release-${config.project_id}-${createdAt.slice(0, 10)}.zip`,
    blob: await generateReleaseZip(data),
    manifest,
  };
}
