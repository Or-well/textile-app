import { PERMISSION_ACTIONS } from "../model/permissions";
import type {
  Entry,
  Member,
  ProjectEvent,
  ProjectWorkflowSettings,
} from "../model/types";
import {
  applyEntryTargetChange,
  getEntryProofreadCount,
  normalizeEntries,
  normalizeEntry,
  normalizeProofreadUsers,
} from "../model/status";
import { parseJsonl } from "../utils/jsonl";
import { parseCsvRecords } from "../utils/csv";
import { nowIso } from "../utils/time";
import {
  createEntryVersionEvent,
  isEntryVersionEvent,
  type EntryVersionSnapshot,
} from "./history";
import type { ProjectDirectoryHandle } from "./projectFs";
import {
  createProjectStorage,
  type ProjectStorage,
} from "./projectStorage";
import { createProjectWritePlan } from "./projectWritePlan";
import {
  assertCan,
  canEditEntry,
  canProofreadEntry,
  canRollbackEntry,
  canRestoreEntryVersion,
  canTranslateEntry,
  getCurrentUser,
  getReviewBlockMessage,
  getReviewBlockReason,
} from "./permissions";

let currentProjectStorage: ProjectStorage | null = null;
let cachedEntries: Entry[] = [];

const DEFAULT_ENTRY_CHUNK_SIZE = 500;
const MIN_ENTRY_CHUNK_SIZE = 1;
const MAX_ENTRY_CHUNK_SIZE = 5000;
const ENTRY_CHUNK_FILE_PATTERN = /^chunk_.*\.jsonl$/i;
const NUMBERED_ENTRY_CHUNK_FILE_PATTERN = /^chunk_(\d+)\.jsonl$/i;

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

export interface RestoreEntryVersionOptions extends SaveEntryOptions {
  snapshot?: EntryVersionSnapshot;
}

export interface WriteEntriesOptions {
  chunkSize?: number;
}

export interface PreparedEntriesWrite {
  fileId: string;
  entries: Entry[];
  writes: Array<{
    path: string;
    rows: Entry[];
  }>;
  deletes: string[];
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
  setEntriesProjectStorage(createProjectStorage(root));
}

export function setEntriesProjectStorage(storage: ProjectStorage): void {
  currentProjectStorage = storage;
  cachedEntries = [];
}

function getProjectStorage(): ProjectStorage {
  if (!currentProjectStorage) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectStorage;
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

function parseCsvRows(text: string): ImportEntryRow[] {
  const rows = parseCsvRecords(text);

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

function assertUniqueEntryKeys(entries: Entry[]): void {
  const seenKeys = new Set<string>();

  for (const entry of entries) {
    const key = entry.key.trim();

    if (!key) {
      continue;
    }

    if (seenKeys.has(key)) {
      throw new Error(`源文件包含重复 key：${key}。请先修正后再导入。`);
    }

    seenKeys.add(key);
  }
}

function parseSourceText(fileId: string, fileName: string, text: string): SourceImportResult {
  const format = getSupportedTextFormat(fileName);

  if (format === "jsonl" || format === "json") {
    const rows =
      format === "jsonl" ? parseJsonl<ImportEntryRow>(text) : parseJsonRows(text);
    const entries = rows.map((row, index) => normalizeSourceEntry(row, fileId, index + 1));

    assertUniqueEntryKeys(entries);

    return {
      entries,
      supported: true,
      formatLabel: format === "jsonl" ? "JSONL 词条" : "JSON 词条",
    };
  }

  if (format === "csv") {
    const rows = parseCsvRows(text);
    const entries = rows.map((row, index) => normalizeSourceEntry(row, fileId, index + 1));

    assertUniqueEntryKeys(entries);

    return {
      entries,
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

function normalizeChunkSize(value?: number): number {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_ENTRY_CHUNK_SIZE;
  }

  const chunkSize = Math.trunc(numericValue);

  return Math.max(
    MIN_ENTRY_CHUNK_SIZE,
    Math.min(MAX_ENTRY_CHUNK_SIZE, chunkSize),
  );
}

function getEntryChunkFileName(chunkIndex: number): string {
  return `chunk_${String(chunkIndex).padStart(4, "0")}.jsonl`;
}

function splitEntriesIntoChunks(entries: Entry[], chunkSize: number): Entry[][] {
  if (entries.length === 0) {
    return [[]];
  }

  const chunks: Entry[][] = [];

  for (let index = 0; index < entries.length; index += chunkSize) {
    chunks.push(entries.slice(index, index + chunkSize));
  }

  return chunks;
}

function getEntryChunkNumber(fileName: string): number {
  const match = NUMBERED_ENTRY_CHUNK_FILE_PATTERN.exec(fileName);

  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function writeFileEntries(
  fileId: string,
  entries: Entry[],
  options: WriteEntriesOptions = {},
): Promise<void> {
  await writeEntriesForFileToStorage(
    getProjectStorage(),
    fileId,
    entries,
    options,
  );
}

export async function writeEntriesForFileToStorage(
  storage: ProjectStorage,
  fileId: string,
  entries: Entry[],
  options: WriteEntriesOptions = {},
): Promise<void> {
  const prepared = await prepareEntriesWrite(
    storage,
    fileId,
    entries,
    options,
  );
  const writePlan = createProjectWritePlan(storage);

  for (const write of prepared.writes) {
    writePlan.writeJsonl(write.path, write.rows);
  }

  for (const path of prepared.deletes) {
    writePlan.deleteFile(path);
  }

  await writePlan.execute();
  cacheEntriesForFile(fileId, entries);
}

export async function prepareEntriesWrite(
  storage: ProjectStorage,
  fileId: string,
  entries: Entry[],
  options: WriteEntriesOptions = {},
): Promise<PreparedEntriesWrite> {
  const entryDirectory = `entries/${fileId}`;
  const chunkSize = normalizeChunkSize(options.chunkSize);
  const chunks = splitEntriesIntoChunks(entries, chunkSize);
  const nextChunkNames = new Set(
    chunks.map((_, index) => getEntryChunkFileName(index + 1)),
  );
  const existingChunkFiles = await listEntryChunkFiles(storage, fileId);

  return {
    fileId,
    entries,
    writes: chunks.map((rows, index) => ({
      path: `${entryDirectory}/${getEntryChunkFileName(index + 1)}`,
      rows,
    })),
    deletes: existingChunkFiles
      .filter((fileName) => !nextChunkNames.has(fileName))
      .map((fileName) => `${entryDirectory}/${fileName}`),
  };
}

export function cacheEntriesForFile(fileId: string, entries: Entry[]): void {
  cachedEntries = [
    ...cachedEntries.filter((entry) => entry.file_id !== fileId),
    ...entries,
  ];
}

function cacheEntry(savedEntry: Entry): void {
  cachedEntries = cachedEntries.map((entry) =>
    entry.id === savedEntry.id ? savedEntry : entry,
  );

  if (!cachedEntries.some((entry) => entry.id === savedEntry.id)) {
    cachedEntries.push(savedEntry);
  }
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
  options: WriteEntriesOptions = {},
): Promise<void> {
  await writeFileEntries(fileId, entries, options);
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

  if (targetChanged) {
    if (!canTranslateEntry(actor, originalEntry)) {
      throw new Error(
        originalEntry.status === "reviewed"
          ? "已审核词条必须先退回校对，才能修改译文。"
          : "当前成员没有修改译文的权限。",
      );
    }
    return;
  }

  if (isRollbackAction) {
    if (!canRollbackEntry(actor, originalEntry)) {
      throw new Error("Permission denied.");
    }
    return;
  }

  if (isReviewAction) {
    const reason = getReviewBlockReason(actor, originalEntry, workflow);

    if (reason) {
      throw new Error(
        getReviewBlockMessage(reason) || "当前成员不能审核此词条。",
      );
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
    if (!canTranslateEntry(actor, originalEntry)) {
      throw new Error("Permission denied.");
    }
    return;
  }

  if (contextChanged) {
    throw new Error("上下文必须通过上下文编辑入口修改。");
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
  const targetChanged = entry.target !== originalEntry.target;

  if (targetChanged) {
    return applyEntryTargetChange(originalEntry, entry.target, {
      userId: actor.id,
      updatedAt: now,
    });
  }

  const statusBecameTranslated =
    entry.status === "translated" && originalEntry.status === "untranslated";
  const originalProofreadCount = getEntryProofreadCount(originalEntry);
  const nextProofreadCount = getEntryProofreadCount(entry);
  const proofreadAction = nextProofreadCount > originalProofreadCount;
  const reviewAction = entry.status === "reviewed";
  const savedEntry: Entry = normalizeEntry({
    ...originalEntry,
    ...entry,
    target: originalEntry.target,
    updated_at: now,
    updated_by: actor.id,
  });

  if (statusBecameTranslated) {
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

function entryVersionChanged(before: Entry, after: Entry): boolean {
  return before.target !== after.target || before.status !== after.status;
}

async function loadProjectEvents(storage: ProjectStorage): Promise<ProjectEvent[]> {
  return (await storage.fileExists("logs/events.jsonl"))
    ? storage.readJsonl<ProjectEvent>("logs/events.jsonl")
    : [];
}

async function commitEntryAndVersionEvent(
  storage: ProjectStorage,
  chunkPath: string,
  entries: Entry[],
  event?: ProjectEvent,
): Promise<void> {
  const writePlan = createProjectWritePlan(storage);

  writePlan.writeJsonl(chunkPath, entries);

  if (event) {
    const events = await loadProjectEvents(storage);

    writePlan.writeJsonl("logs/events.jsonl", [...events, event]);
  }

  await writePlan.execute();
}

async function listEntryChunkFiles(
  storage: ProjectStorage,
  fileId: string,
): Promise<string[]> {
  const entryDirectory = `entries/${fileId}`;

  if (!(await storage.fileExists(entryDirectory))) {
    return [];
  }

  const fileNames = await storage.listFiles(entryDirectory);

  return fileNames
    .filter((name) => ENTRY_CHUNK_FILE_PATTERN.test(name))
    .sort((a, b) => {
      const chunkNumberDiff = getEntryChunkNumber(a) - getEntryChunkNumber(b);

      return chunkNumberDiff || a.localeCompare(b);
    });
}

export async function loadEntries(fileId: string): Promise<Entry[]> {
  const storage = getProjectStorage();

  try {
    const entries = await loadEntriesFromStorage(storage, fileId);

    cacheEntriesForFile(fileId, entries);

    return entries;
  } catch {
    throw new Error("词条数据无法读取。请确认项目文件夹和词条文件没有损坏。");
  }
}

async function loadEntriesFromStorage(
  storage: ProjectStorage,
  fileId: string,
): Promise<Entry[]> {
  const entryDirectory = `entries/${fileId}`;
  const chunkFiles = await listEntryChunkFiles(storage, fileId);
  const entryGroups = await Promise.all(
    chunkFiles.map((fileName) =>
      storage.readJsonl<Entry>(`${entryDirectory}/${fileName}`),
    ),
  );

  return normalizeEntries(entryGroups.flat())
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
}

export async function createEntriesFromSourceFile(
  fileId: string,
  fileName: string,
  text: string,
  options: WriteEntriesOptions = {},
): Promise<Entry[]> {
  const entries = parseEntriesFromSourceFile(fileId, fileName, text);

  await writeFileEntries(fileId, entries, options);

  return entries;
}

export async function prepareUpdatedEntriesFromSourceFile(
  storage: ProjectStorage,
  fileId: string,
  fileName: string,
  text: string,
  options: WriteEntriesOptions = {},
): Promise<PreparedEntriesWrite> {
  const result = parseSourceText(fileId, fileName, text);
  const existingEntries = await loadEntriesFromStorage(storage, fileId);
  const mergedEntries = mergeSourceEntries(result.entries, existingEntries);

  return prepareEntriesWrite(storage, fileId, mergedEntries, options);
}

export async function importEntryTranslations(
  fileId: string,
  fileName: string,
  text: string,
  userId = "",
  options: WriteEntriesOptions = {},
): Promise<TranslationImportResult> {
  const entries = await loadEntries(fileId);
  const rows = parseTranslationRows(text, fileName);
  const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const entriesByIndex = new Map(entries.map((entry) => [entry.index, entry]));
  let matched = 0;
  let skipped = 0;
  const updatedAt = nowIso();

  for (const row of rows) {
    const entry =
      (row.key ? entriesByKey.get(row.key) : undefined) ??
      (row.index ? entriesByIndex.get(row.index) : undefined);

    if (!entry) {
      skipped += 1;
      continue;
    }

    if (entry.locked || entry.hidden) {
      skipped += 1;
      continue;
    }

    const changedEntry = applyEntryTargetChange(entry, row.target, {
      userId: userId || entry.updated_by,
      updatedAt,
    });

    Object.assign(entry, changedEntry);
    matched += 1;
  }

  await writeFileEntries(fileId, entries, options);

  return { matched, skipped };
}

export async function saveSourceText(path: string, text: string): Promise<void> {
  await getProjectStorage().writeText(path, text);
}

export async function loadAllEntries(): Promise<Entry[]> {
  const storage = getProjectStorage();

  try {
    const fileIds = await storage.listFiles("entries");
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
  const storage = getProjectStorage();
  const fileId = getFileIdFromEntryId(entryId);
  const entryDirectory = `entries/${fileId}`;
  const chunkFiles = await listEntryChunkFiles(storage, fileId);
  const nextContext = context.trim();

  for (const chunkFile of chunkFiles) {
    const chunkPath = `${entryDirectory}/${chunkFile}`;
    const entries = normalizeEntries(await storage.readJsonl<Entry>(chunkPath));
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

    await storage.writeJsonl(chunkPath, entries);

    cacheEntry(savedEntry);

    return savedEntry;
  }

  throw new Error("没有找到要更新上下文的词条。请重新打开项目后再试。");
}

export async function saveEntry(
  entry: Entry,
  options: SaveEntryOptions = {},
): Promise<Entry> {
  const storage = getProjectStorage();
  const actor = resolveActor(options.actor);
  const fileId = getFileIdFromEntryId(entry.id);
  const entryDirectory = `entries/${fileId}`;
  const chunkFiles = await listEntryChunkFiles(storage, fileId);

  for (const chunkFile of chunkFiles) {
    const chunkPath = `${entryDirectory}/${chunkFile}`;
    const entries = normalizeEntries(await storage.readJsonl<Entry>(chunkPath));
    const entryIndex = entries.findIndex((row) => row.id === entry.id);

    if (entryIndex < 0) {
      continue;
    }

    const originalEntry = normalizeEntry(entries[entryIndex]);

    if (entry.context !== originalEntry.context) {
      throw new Error("上下文必须通过上下文编辑入口修改。");
    }

    const mergedEntry = normalizeEntry({
      ...originalEntry,
      target: entry.target,
      status: entry.status,
      proofread_by: entry.proofread_by,
      proofread_count: entry.proofread_count,
      reviewed_by: entry.reviewed_by,
    });

    assertCanWriteEntry(actor, originalEntry, mergedEntry, options.workflow);

    const savedEntry = applyEntryAuditFields(originalEntry, mergedEntry, actor);
    const versionEvent = entryVersionChanged(originalEntry, savedEntry)
      ? createEntryVersionEvent(originalEntry, savedEntry, actor.id)
      : undefined;

    entries[entryIndex] = savedEntry;

    await commitEntryAndVersionEvent(
      storage,
      chunkPath,
      entries,
      versionEvent,
    );

    cacheEntry(savedEntry);

    return savedEntry;
  }

  throw new Error("没有找到要保存的词条。请重新打开项目后再试。");
}

export async function restoreEntryVersion(
  entryId: string,
  versionEventId: string,
  options: RestoreEntryVersionOptions = {},
): Promise<Entry> {
  const storage = getProjectStorage();
  const actor = resolveActor(options.actor);
  const fileId = getFileIdFromEntryId(entryId);
  const entryDirectory = `entries/${fileId}`;
  const events = await loadProjectEvents(storage);
  const versionEvent = events.find((event) => event.id === versionEventId);

  if (
    !versionEvent ||
    !isEntryVersionEvent(versionEvent) ||
    versionEvent.entry_id !== entryId
  ) {
    throw new Error("没有找到可恢复的译文历史版本。");
  }

  const chunkFiles = await listEntryChunkFiles(storage, fileId);

  for (const chunkFile of chunkFiles) {
    const chunkPath = `${entryDirectory}/${chunkFile}`;
    const entries = normalizeEntries(await storage.readJsonl<Entry>(chunkPath));
    const entryIndex = entries.findIndex((row) => row.id === entryId);

    if (entryIndex < 0) {
      continue;
    }

    const originalEntry = normalizeEntry(entries[entryIndex]);

    if (!canRestoreEntryVersion(actor, originalEntry)) {
      throw new Error("当前成员没有恢复译文历史版本的权限。");
    }

    const snapshot = options.snapshot ?? "after";
    const restoredTarget =
      snapshot === "before"
        ? versionEvent.detail.before_target
        : versionEvent.detail.after_target;
    const restoredTranslatedBy =
      snapshot === "before"
        ? versionEvent.detail.before_translated_by
        : versionEvent.detail.after_translated_by;
    const restoredEntry: Entry = normalizeEntry({
      ...originalEntry,
      target: restoredTarget,
      status: restoredTarget.trim() ? "translated" : "untranslated",
      translated_by: restoredTarget.trim()
        ? restoredTranslatedBy ?? ""
        : "",
      proofread_by: [],
      proofread_count: 0,
      reviewed_by: "",
      updated_at: nowIso(),
      updated_by: actor.id,
    });
    const restoreEvent = createEntryVersionEvent(
      originalEntry,
      restoredEntry,
      actor.id,
      {
        type: "entry.restored",
        restoredFromEventId: versionEvent.id,
        restoredFromSnapshot: snapshot,
      },
    );

    entries[entryIndex] = restoredEntry;

    await commitEntryAndVersionEvent(
      storage,
      chunkPath,
      entries,
      restoreEvent,
    );
    cacheEntry(restoredEntry);

    return restoredEntry;
  }

  throw new Error("没有找到要恢复的词条。请重新打开项目后再试。");
}
