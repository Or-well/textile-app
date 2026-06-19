import { PERMISSION_ACTIONS } from "../model/permissions";
import type { Entry, Member, ProjectWorkflowSettings } from "../model/types";
import {
  getEntryProofreadCount,
  normalizeEntries,
  normalizeEntry,
  normalizeProofreadUsers,
} from "../model/status";
import { parseJsonl } from "../utils/jsonl";
import { nowIso } from "../utils/time";
import {
  ensureDirectory,
  listFiles,
  readJsonl,
  writeTextFile,
  writeJsonl,
  type ProjectDirectoryHandle,
} from "./projectFs";
import {
  assertCan,
  canEditEntry,
  canProofreadEntry,
  canReviewEntry,
  canRollbackEntry,
  canTranslateEntry,
  getCurrentUser,
} from "./permissions";

let currentProjectRoot: ProjectDirectoryHandle | null = null;
let cachedEntries: Entry[] = [];

export interface SourceImportResult {
  entries: Entry[];
  supported: boolean;
  formatLabel: string;
}

export interface TranslationImportResult {
  matched: number;
  skipped: number;
}

export interface SaveEntryOptions {
  actor?: Member | null;
  workflow?: ProjectWorkflowSettings;
}

interface ImportEntryRow {
  key?: string;
  source?: string;
  original?: string;
  target?: string;
  translation?: string;
  context?: string;
  speaker?: string;
  index?: number;
  status?: Entry["status"];
}

export function setEntriesProjectRoot(root: ProjectDirectoryHandle): void {
  currentProjectRoot = root;
  cachedEntries = [];
}

function getProjectRoot(): ProjectDirectoryHandle {
  if (!currentProjectRoot) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectRoot;
}

function getFileIdFromEntryId(entryId: string): string {
  const [fileId] = entryId.split(":");

  if (!fileId) {
    throw new Error("词条编号不正确，无法查找词条。");
  }

  return fileId;
}

function getSupportedTextFormat(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "jsonl" || extension === "json" || extension === "csv") {
    return extension;
  }

  if (extension === "txt" || extension === "ks") {
    return extension;
  }

  throw new Error("当前仅支持导入 .txt、.ks、.jsonl、.json、.csv 文本文件。");
}

function padEntryIndex(index: number): string {
  return String(index).padStart(6, "0");
}

function countTextWords(text: string): number {
  return Array.from(text.trim()).length;
}

function normalizeHeaderName(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (normalized === "original" || normalized === "source" || normalized === "原文") {
    return "source";
  }

  if (
    normalized === "translation" ||
    normalized === "target" ||
    normalized === "译文"
  ) {
    return "target";
  }

  if (normalized === "上下文" || normalized.startsWith("context")) {
    return "context";
  }

  if (normalized === "键值") {
    return "key";
  }

  return normalized;
}

function isHeaderRow(columns: string[]): boolean {
  const names = columns.map(normalizeHeaderName);

  return names.includes("key") && (names.includes("source") || names.includes("target"));
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === "\"" && inQuotes && nextChar === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);

  return cells.map((cell) => cell.trim());
}

function parseCsvRows(text: string): ImportEntryRow[] {
  const rows = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(parseCsvLine);

  if (rows.length === 0) {
    return [];
  }

  if (isHeaderRow(rows[0])) {
    const headers = rows[0].map(normalizeHeaderName);

    return rows.slice(1).map((columns, rowIndex) => {
      const row: ImportEntryRow = { index: rowIndex + 1 };

      headers.forEach((header, columnIndex) => {
        const value = columns[columnIndex] ?? "";

        if (header === "key") {
          row.key = value;
        } else if (header === "source") {
          row.source = value;
        } else if (header === "target") {
          row.target = value;
        } else if (header === "context") {
          row.context = value;
        } else if (header === "speaker") {
          row.speaker = value;
        } else if (header === "index") {
          row.index = Number(value) || row.index;
        }
      });

      return row;
    });
  }

  return rows.map((columns, rowIndex) => ({
    key: columns[0] ?? "",
    source: columns[1] ?? "",
    target: columns[2] ?? "",
    context: columns[3] ?? "",
    index: rowIndex + 1,
  }));
}

function parseJsonRows(text: string): ImportEntryRow[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("JSON 文件格式有问题，无法读取。");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("JSON 文件必须是词条数组。");
  }

  return parsed.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new Error(`JSON 第 ${index + 1} 条不是对象，无法读取。`);
    }

    return row as ImportEntryRow;
  });
}

function getSourceText(row: ImportEntryRow): string {
  return row.source ?? row.original ?? "";
}

function getTargetText(row: ImportEntryRow): string {
  return row.target ?? row.translation ?? "";
}

function normalizeSourceEntry(
  row: ImportEntryRow,
  fileId: string,
  index: number,
): Entry {
  const key = row.key?.trim() || `line_${padEntryIndex(index)}`;
  const source = getSourceText(row).trim();
  const target = getTargetText(row);
  const now = nowIso();

  return normalizeEntry({
    id: `${fileId}:${padEntryIndex(index)}`,
    file_id: fileId,
    index,
    key,
    speaker: row.speaker ?? "",
    source,
    target,
    context: row.context ?? "",
    status: row.status ?? (target.trim() ? "translated" : "untranslated"),
    disputed: false,
    assignee: "",
    translated_by: "",
    proofread_by: [],
    proofread_count: 0,
    reviewed_by: "",
    word_count: countTextWords(source),
    hidden: false,
    locked: false,
    updated_at: now,
    updated_by: "",
  });
}

function parseSourceText(fileId: string, fileName: string, text: string): SourceImportResult {
  const format = getSupportedTextFormat(fileName);

  if (format === "jsonl" || format === "json") {
    const rows =
      format === "jsonl" ? parseJsonl<ImportEntryRow>(text) : parseJsonRows(text);

    return {
      entries: rows.map((row, index) => normalizeSourceEntry(row, fileId, index + 1)),
      supported: true,
      formatLabel: format === "jsonl" ? "JSONL 词条" : "JSON 词条",
    };
  }

  if (format === "csv") {
    const rows = parseCsvRows(text);

    return {
      entries: rows.map((row, index) => normalizeSourceEntry(row, fileId, index + 1)),
      supported: true,
      formatLabel: "CSV 词条",
    };
  }

  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const entries = lines.map((line, index) =>
    normalizeSourceEntry(
      {
        key: `line_${padEntryIndex(index + 1)}`,
        source: line,
      },
      fileId,
      index + 1,
    ),
  );

  return {
    entries,
    supported: true,
    formatLabel: format === "ks" ? "KS 文本" : "纯文本",
  };
}

function findReusableEntry(
  sourceEntry: Entry,
  existingByKey: Map<string, Entry>,
  existingByIndex: Map<number, Entry>,
): Entry | undefined {
  return existingByKey.get(sourceEntry.key) ?? existingByIndex.get(sourceEntry.index);
}

function mergeSourceEntries(newEntries: Entry[], existingEntries: Entry[]): Entry[] {
  const existingByKey = new Map(
    existingEntries.filter((entry) => entry.key).map((entry) => [entry.key, entry]),
  );
  const existingByIndex = new Map(existingEntries.map((entry) => [entry.index, entry]));
  const now = nowIso();

  return newEntries.map((sourceEntry) => {
    const existingEntry = findReusableEntry(sourceEntry, existingByKey, existingByIndex);

    if (!existingEntry) {
      return sourceEntry;
    }

    return {
      ...sourceEntry,
      target: existingEntry.target,
      status: existingEntry.status,
      disputed: existingEntry.disputed,
      dispute_reason: existingEntry.dispute_reason,
      dispute_resolved_at: existingEntry.dispute_resolved_at,
      dispute_resolved_by: existingEntry.dispute_resolved_by,
      assignee: existingEntry.assignee,
      translated_by: existingEntry.translated_by,
      proofread_by: existingEntry.proofread_by,
      proofread_count: existingEntry.proofread_count,
      reviewed_by: existingEntry.reviewed_by,
      hidden: existingEntry.hidden,
      locked: existingEntry.locked,
      updated_at: now,
      updated_by: existingEntry.updated_by,
    };
  });
}

function parseTranslationRows(text: string, fileName: string): Array<{
  key?: string;
  index?: number;
  target: string;
}> {
  const format = getSupportedTextFormat(fileName);

  if (format === "jsonl") {
    return parseJsonl<ImportEntryRow>(text)
      .map((row) => ({
        key: row.key,
        index: row.index,
        target: getTargetText(row),
      }))
      .filter((row) => Boolean(row.key || row.index));
  }

  if (format === "json") {
    return parseJsonRows(text)
      .map((row, index) => ({
        key: row.key,
        index: row.index ?? index + 1,
        target: getTargetText(row),
      }))
      .filter((row) => Boolean(row.key || row.index));
  }

  if (format === "csv") {
    return parseCsvRows(text)
      .map((row) => ({
        key: row.key,
        index: row.index,
        target: getTargetText(row),
      }))
      .filter((row) => Boolean(row.key || row.index));
  }

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((target, index) => ({
      index: index + 1,
      target,
    }));
}

async function writeFileEntries(fileId: string, entries: Entry[]): Promise<void> {
  const root = getProjectRoot();

  await ensureDirectory(root, `entries/${fileId}`);
  await writeJsonl(root, `entries/${fileId}/chunk_0001.jsonl`, entries);

  cachedEntries = [
    ...cachedEntries.filter((entry) => entry.file_id !== fileId),
    ...entries,
  ];
}

export function parseEntriesFromSourceFile(
  fileId: string,
  fileName: string,
  text: string,
): Entry[] {
  return parseSourceText(fileId, fileName, text).entries;
}

export async function writeEntriesForFile(
  fileId: string,
  entries: Entry[],
): Promise<void> {
  await writeFileEntries(fileId, entries);
}

export function clearCachedEntriesForFile(fileId: string): void {
  cachedEntries = cachedEntries.filter((entry) => entry.file_id !== fileId);
}

function resolveActor(actor?: Member | null): Member {
  const user = actor ?? getCurrentUser();

  if (!user?.id) {
    throw new Error("Login required.");
  }

  return user;
}

function assertCanWriteEntry(
  actor: Member,
  originalEntry: Entry,
  nextEntry: Entry,
  workflow?: ProjectWorkflowSettings,
): void {
  const originalProofreadCount = getEntryProofreadCount(originalEntry);
  const nextProofreadCount = getEntryProofreadCount(nextEntry);
  const targetChanged = nextEntry.target !== originalEntry.target;
  const contextChanged = nextEntry.context !== originalEntry.context;
  const isProofreadAction = nextProofreadCount > originalProofreadCount;
  const isReviewAction =
    nextEntry.status === "reviewed" &&
    (originalEntry.status !== "reviewed" || nextEntry.reviewed_by !== originalEntry.reviewed_by);
  const isRollbackAction =
    (originalEntry.status === "reviewed" && nextEntry.status === "proofread") ||
    (originalEntry.status === "proofread" && nextEntry.status === "translated");
  const isTranslateAction =
    targetChanged ||
    (nextEntry.status === "translated" && originalEntry.status === "untranslated");

  if (isRollbackAction) {
    if (!canRollbackEntry(actor, originalEntry)) {
      throw new Error("Permission denied.");
    }
    return;
  }

  if (isReviewAction) {
    if (!canReviewEntry(actor, originalEntry, workflow)) {
      throw new Error("Permission denied.");
    }
    return;
  }

  if (isProofreadAction) {
    if (!canProofreadEntry(actor, originalEntry, workflow)) {
      throw new Error("Permission denied.");
    }
    return;
  }

  if (isTranslateAction) {
    if (!canTranslateEntry(actor, originalEntry) && !canEditEntry(actor, originalEntry)) {
      throw new Error("Permission denied.");
    }
    return;
  }

  if (contextChanged) {
    return;
  }

  if (!canEditEntry(actor, originalEntry)) {
    throw new Error("Permission denied.");
  }
}

function applyEntryAuditFields(
  originalEntry: Entry,
  entry: Entry,
  actor: Member,
): Entry {
  const now = nowIso();
  const target = entry.target;
  const targetBecameFilled =
    !originalEntry.target.trim() && target.trim().length > 0;
  const statusBecameTranslated =
    entry.status === "translated" && originalEntry.status === "untranslated";
  const shouldMarkTranslated =
    target.trim().length > 0 && originalEntry.status === "untranslated";
  const originalProofreadCount = getEntryProofreadCount(originalEntry);
  const nextProofreadCount = getEntryProofreadCount(entry);
  const proofreadAction = nextProofreadCount > originalProofreadCount;
  const reviewAction = entry.status === "reviewed";
  const savedEntry: Entry = normalizeEntry({
    ...originalEntry,
    ...entry,
    status: shouldMarkTranslated ? "translated" : entry.status,
    updated_at: now,
    updated_by: actor.id,
  });

  if (targetBecameFilled || statusBecameTranslated || shouldMarkTranslated) {
    savedEntry.translated_by = actor.id;
  }

  if (proofreadAction) {
    const proofreadBy = normalizeProofreadUsers(savedEntry.proofread_by);
    const nextProofreadBy = proofreadBy.includes(actor.id)
      ? proofreadBy
      : [...proofreadBy, actor.id];

    savedEntry.proofread_by = nextProofreadBy;
    savedEntry.proofread_count = Math.max(
      originalProofreadCount + 1,
      nextProofreadCount,
      nextProofreadBy.length,
    );
  }

  if (reviewAction) {
    savedEntry.reviewed_by = actor.id;
  }

  return savedEntry;
}

async function listEntryChunkFiles(
  root: ProjectDirectoryHandle,
  fileId: string,
): Promise<string[]> {
  const entryDirectory = `entries/${fileId}`;
  const fileNames = await listFiles(root, entryDirectory);

  return fileNames
    .filter((name) => /^chunk_.*\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

export async function loadEntries(fileId: string): Promise<Entry[]> {
  const root = getProjectRoot();
  const entryDirectory = `entries/${fileId}`;

  try {
    const chunkFiles = await listEntryChunkFiles(root, fileId);
    const entryGroups = await Promise.all(
      chunkFiles.map((fileName) =>
        readJsonl<Entry>(root, `${entryDirectory}/${fileName}`),
      ),
    );
    const entries = normalizeEntries(entryGroups.flat())
      .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));

    cachedEntries = [
      ...cachedEntries.filter((entry) => entry.file_id !== fileId),
      ...entries,
    ];

    return entries;
  } catch {
    throw new Error("词条数据无法读取。请确认项目文件夹和词条文件没有损坏。");
  }
}

export async function createEntriesFromSourceFile(
  fileId: string,
  fileName: string,
  text: string,
): Promise<Entry[]> {
  const entries = parseEntriesFromSourceFile(fileId, fileName, text);

  await writeFileEntries(fileId, entries);

  return entries;
}

export async function updateEntriesFromSourceFile(
  fileId: string,
  fileName: string,
  text: string,
): Promise<Entry[]> {
  const result = parseSourceText(fileId, fileName, text);
  let existingEntries: Entry[] = [];

  try {
    existingEntries = await loadEntries(fileId);
  } catch {
    existingEntries = [];
  }

  const mergedEntries = mergeSourceEntries(result.entries, existingEntries);

  await writeFileEntries(fileId, mergedEntries);

  return mergedEntries;
}

export async function importEntryTranslations(
  fileId: string,
  fileName: string,
  text: string,
  userId = "",
): Promise<TranslationImportResult> {
  const entries = await loadEntries(fileId);
  const rows = parseTranslationRows(text, fileName);
  const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const entriesByIndex = new Map(entries.map((entry) => [entry.index, entry]));
  let matched = 0;
  let skipped = 0;
  const now = nowIso();

  for (const row of rows) {
    const entry =
      (row.key ? entriesByKey.get(row.key) : undefined) ??
      (row.index ? entriesByIndex.get(row.index) : undefined);

    if (!entry) {
      skipped += 1;
      continue;
    }

    const targetWasEmpty = !entry.target.trim();

    entry.target = row.target;
    entry.updated_at = now;
    entry.updated_by = userId || entry.updated_by;

    if (row.target.trim() && entry.status === "untranslated") {
      entry.status = "translated";
    }

    if (row.target.trim() && (targetWasEmpty || entry.status === "translated") && userId) {
      entry.translated_by = userId;
    }

    matched += 1;
  }

  await writeFileEntries(fileId, entries);

  return { matched, skipped };
}

export async function saveSourceText(path: string, text: string): Promise<void> {
  await writeTextFile(getProjectRoot(), path, text);
}

export async function loadAllEntries(): Promise<Entry[]> {
  const root = getProjectRoot();

  try {
    const fileIds = await listFiles(root, "entries");
    const entryGroups = await Promise.all(
      fileIds.map((fileId) => loadEntries(fileId)),
    );
    const entries = normalizeEntries(entryGroups.flat())
      .sort((a, b) => a.file_id.localeCompare(b.file_id) || a.index - b.index);

    cachedEntries = entries;

    return entries;
  } catch {
    throw new Error("词条列表无法读取。请确认项目里包含 entries 文件夹。");
  }
}

export async function getEntryById(entryId: string): Promise<Entry | undefined> {
  const cachedEntry = cachedEntries.find((entry) => entry.id === entryId);

  if (cachedEntry) {
    return cachedEntry;
  }

  const fileId = getFileIdFromEntryId(entryId);
  const entries = await loadEntries(fileId);

  return entries.find((entry) => entry.id === entryId);
}

export async function updateEntryContext(
  entryId: string,
  context: string,
  userId: string,
): Promise<Entry> {
  const root = getProjectRoot();
  const fileId = getFileIdFromEntryId(entryId);
  const entryDirectory = `entries/${fileId}`;
  const chunkFiles = await listEntryChunkFiles(root, fileId);
  const nextContext = context.trim();

  for (const chunkFile of chunkFiles) {
    const chunkPath = `${entryDirectory}/${chunkFile}`;
    const entries = normalizeEntries(await readJsonl<Entry>(root, chunkPath));
    const entryIndex = entries.findIndex((row) => row.id === entryId);

    if (entryIndex < 0) {
      continue;
    }

    const originalEntry = normalizeEntry(entries[entryIndex]);
    const actor = resolveActor(getCurrentUser()?.id === userId ? getCurrentUser() : undefined);
    const action = nextContext
      ? originalEntry.context?.trim()
        ? PERMISSION_ACTIONS.CONTEXT_UPDATE
        : PERMISSION_ACTIONS.CONTEXT_CREATE
      : PERMISSION_ACTIONS.CONTEXT_DELETE;

    assertCan(actor, action);

    const savedEntry: Entry = {
      ...originalEntry,
      context: nextContext,
      updated_at: nowIso(),
      updated_by: actor.id,
    };

    entries[entryIndex] = savedEntry;

    await writeJsonl(root, chunkPath, entries);

    cachedEntries = cachedEntries.map((cachedEntry) =>
      cachedEntry.id === savedEntry.id ? savedEntry : cachedEntry,
    );

    if (!cachedEntries.some((cachedEntry) => cachedEntry.id === savedEntry.id)) {
      cachedEntries.push(savedEntry);
    }

    return savedEntry;
  }

  throw new Error("没有找到要更新上下文的词条。请重新打开项目后再试。");
}

export async function saveEntry(
  entry: Entry,
  options: SaveEntryOptions = {},
): Promise<Entry> {
  const root = getProjectRoot();
  const actor = resolveActor(options.actor);
  const fileId = getFileIdFromEntryId(entry.id);
  const entryDirectory = `entries/${fileId}`;
  const chunkFiles = await listEntryChunkFiles(root, fileId);

  for (const chunkFile of chunkFiles) {
    const chunkPath = `${entryDirectory}/${chunkFile}`;
    const entries = normalizeEntries(await readJsonl<Entry>(root, chunkPath));
    const entryIndex = entries.findIndex((row) => row.id === entry.id);

    if (entryIndex < 0) {
      continue;
    }

    const originalEntry = normalizeEntry(entries[entryIndex]);
    const mergedEntry = normalizeEntry({ ...originalEntry, ...entry });

    assertCanWriteEntry(actor, originalEntry, mergedEntry, options.workflow);

    const savedEntry = applyEntryAuditFields(originalEntry, mergedEntry, actor);

    entries[entryIndex] = savedEntry;

    await writeJsonl(root, chunkPath, entries);

    cachedEntries = cachedEntries.map((cachedEntry) =>
      cachedEntry.id === savedEntry.id ? savedEntry : cachedEntry,
    );

    if (!cachedEntries.some((cachedEntry) => cachedEntry.id === savedEntry.id)) {
      cachedEntries.push(savedEntry);
    }

    return savedEntry;
  }

  throw new Error("没有找到要保存的词条。请重新打开项目后再试。");
}
