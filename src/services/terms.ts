import JSZip from "jszip";
import type { Term } from "../model/types";
import { createId } from "../utils/id";
import { parseJsonl, stringifyJsonl } from "../utils/jsonl";
import { parseCsvRecords } from "../utils/csv";
import { nowIso, utcDateKey } from "../utils/time";
import {
  canCreateTerm,
  canDeleteTerm,
  canExportTerm,
  canImportTerm,
  canUpdateTerm,
  getCurrentUser,
} from "./permissions";
import type { ProjectDirectoryHandle } from "./projectFs";
import {
  createProjectStorage,
  type ProjectStorage,
} from "./projectStorage";

export interface TermUsageResult {
  term: Term;
  matchedText: string;
  isRecommendedUsed: boolean;
}

export interface TermInput {
  source: string;
  target: string;
  part_of_speech: string;
  note: string;
  variants: string[];
  case_sensitive?: boolean;
}

export interface ImportedTermsResult {
  added: number;
  updated: number;
  total: number;
}

export interface ExportedTermsFile {
  fileName: string;
  blob: Blob;
}

interface ImportTermRow {
  id?: string;
  source?: string;
  original?: string;
  target?: string;
  translation?: string;
  part_of_speech?: string;
  pos?: string;
  note?: string;
  variants?: string[] | string;
  case_sensitive?: boolean | string | number;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

const TERMS_PATH = "terms/terms.jsonl";

let currentProjectStorage: ProjectStorage | null = null;
let cachedTerms: Term[] | null = null;

export function setTermsProjectRoot(root: ProjectDirectoryHandle): void {
  setTermsProjectStorage(createProjectStorage(root));
}

export function setTermsProjectStorage(storage: ProjectStorage): void {
  currentProjectStorage = storage;
  cachedTerms = null;
}

function getProjectStorage(): ProjectStorage {
  if (!currentProjectStorage) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectStorage;
}

function getWriteUserId(fallbackUserId = ""): string {
  const user = getCurrentUser();

  if (!user?.id) {
    throw new Error("Login required.");
  }

  return user.id || fallbackUserId;
}

function assertTermWritePermission(canWrite: boolean): void {
  if (!canWrite) {
    throw new Error("Permission denied.");
  }
}

function includesTermText(text: string, termText: string, caseSensitive?: boolean): boolean {
  if (!termText) {
    return false;
  }

  if (caseSensitive) {
    return text.includes(termText);
  }

  return text.toLowerCase().includes(termText.toLowerCase());
}

function findMatchedText(term: Term, sourceText: string): string | undefined {
  const isCaseSensitive = term.case_sensitive === true;

  if (includesTermText(sourceText, term.source, isCaseSensitive)) {
    return term.source;
  }

  return term.variants.find((variant) =>
    includesTermText(sourceText, variant, isCaseSensitive),
  );
}

function normalizeVariants(variants: string[]): string[] {
  return Array.from(
    new Set(
      variants
        .map((variant) => variant.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeTermInput(input: TermInput): TermInput {
  return {
    source: input.source.trim(),
    target: input.target.trim(),
    part_of_speech: input.part_of_speech.trim(),
    note: input.note.trim(),
    variants: normalizeVariants(input.variants),
    case_sensitive: input.case_sensitive === true ? true : undefined,
  };
}

function normalizeImportedVariants(value: ImportTermRow["variants"]): string[] {
  if (Array.isArray(value)) {
    return normalizeVariants(value);
  }

  if (typeof value === "string") {
    return normalizeVariants(value.split(/[;\n]/));
  }

  return [];
}

function parseBooleanLike(value: ImportTermRow["case_sensitive"]): boolean | undefined {
  if (value === true || value === 1) {
    return true;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "y", "是"].includes(normalized)) {
      return true;
    }
  }

  return undefined;
}

function normalizeTerm(term: ImportTermRow, userId: string): Term {
  const now = nowIso();

  return {
    id: term.id || createId("term"),
    source: (term.source ?? term.original ?? "").trim(),
    target: (term.target ?? term.translation ?? "").trim(),
    part_of_speech: (term.part_of_speech ?? term.pos ?? "").trim(),
    note: term.note?.trim() ?? "",
    variants: normalizeImportedVariants(term.variants),
    case_sensitive: parseBooleanLike(term.case_sensitive),
    created_by: term.created_by || userId,
    created_at: term.created_at || now,
    updated_at: term.updated_at || now,
  };
}

function validateTermInput(input: TermInput): void {
  if (!input.source) {
    throw new Error("术语原文不能为空。");
  }

  if (!input.target) {
    throw new Error("推荐译名不能为空。");
  }
}

function sortTerms(terms: Term[]): Term[] {
  return [...terms].sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      a.id.localeCompare(b.id),
  );
}

function normalizeHeaderName(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (["source", "original", "原文", "原文术语"].includes(normalized)) {
    return "source";
  }

  if (["target", "translation", "译文", "译文术语"].includes(normalized)) {
    return "target";
  }

  if (["part_of_speech", "pos", "词性"].includes(normalized)) {
    return "part_of_speech";
  }

  if (["note", "备注"].includes(normalized)) {
    return "note";
  }

  if (["variants", "变体"].includes(normalized)) {
    return "variants";
  }

  if (["case_sensitive", "区分大小写"].includes(normalized)) {
    return "case_sensitive";
  }

  return normalized;
}

function parseCsvTerms(text: string, userId: string): Term[] {
  const rows = parseCsvRecords(text);

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map(normalizeHeaderName);

  if (!headers.includes("source") || !headers.includes("target")) {
    throw new Error("CSV 第一行必须包含 source 和 target 表头。");
  }

  return rows.slice(1).map((columns, rowIndex) => {
    const row: ImportTermRow = {};

    headers.forEach((header, columnIndex) => {
      const value = columns[columnIndex] ?? "";

      if (header === "source") {
        row.source = value;
      } else if (header === "target") {
        row.target = value;
      } else if (header === "part_of_speech") {
        row.part_of_speech = value;
      } else if (header === "note") {
        row.note = value;
      } else if (header === "variants") {
        row.variants = value;
      } else if (header === "case_sensitive") {
        row.case_sensitive = value;
      } else if (header === "id") {
        row.id = value;
      }
    });

    const term = normalizeTerm(row, userId);

    validateImportedTerm(term, rowIndex + 2);

    return term;
  });
}

function parseJsonTerms(text: string, userId: string): Term[] {
  let json: unknown;

  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error("JSON 术语文件无法读取。请确认文件是术语数组。");
  }

  if (!Array.isArray(json)) {
    throw new Error("JSON 术语文件必须是数组。");
  }

  return json.map((row, index) => {
    const term = normalizeTerm(row as ImportTermRow, userId);

    validateImportedTerm(term, index + 1);

    return term;
  });
}

function parseJsonlTerms(text: string, userId: string): Term[] {
  try {
    return parseJsonl<ImportTermRow>(text).map((row, index) => {
      const term = normalizeTerm(row, userId);

      validateImportedTerm(term, index + 1);

      return term;
    });
  } catch {
    throw new Error("JSONL 术语文件无法读取。请确认每行都是术语对象。");
  }
}

function validateImportedTerm(term: Term, rowNumber: number): void {
  if (!term.source) {
    throw new Error(`第 ${rowNumber} 条术语缺少 source。`);
  }

  if (!term.target) {
    throw new Error(`第 ${rowNumber} 条术语缺少 target。`);
  }
}

function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function parseXml(text: string, label: string): Document {
  const xml = new DOMParser().parseFromString(text, "application/xml");

  if (xml.querySelector("parsererror")) {
    throw new Error(`${label} 格式有问题，无法读取。`);
  }

  return xml;
}

async function getZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);

  if (!file) {
    throw new Error(`XLSX 缺少 ${path}。`);
  }

  return file.async("text");
}

function getRelationshipTarget(relsXml: Document, relationshipId: string): string {
  const relationship = Array.from(relsXml.getElementsByTagName("Relationship"))
    .find((item) => item.getAttribute("Id") === relationshipId);
  const target = relationship?.getAttribute("Target");

  if (!target) {
    throw new Error("XLSX 工作表关系缺失，无法读取。");
  }

  return target.startsWith("/")
    ? target.slice(1)
    : `xl/${target.replace(/^\.\.\//, "")}`;
}

function readSharedStrings(xml: Document | null): string[] {
  if (!xml) {
    return [];
  }

  return Array.from(xml.getElementsByTagName("si")).map((item) =>
    Array.from(item.getElementsByTagName("t"))
      .map((textNode) => textNode.textContent ?? "")
      .join(""),
  );
}

function getColumnIndex(cellRef: string): number {
  const letters = (cellRef.match(/[A-Z]+/i)?.[0] ?? "").toUpperCase();
  let index = 0;

  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }

  return Math.max(0, index - 1);
}

function readCellValue(cell: Element, sharedStrings: string[]): string {
  const type = cell.getAttribute("t");
  const value = cell.getElementsByTagName("v")[0]?.textContent ?? "";

  if (type === "s") {
    return sharedStrings[Number(value)] ?? "";
  }

  if (type === "inlineStr") {
    return Array.from(cell.getElementsByTagName("t"))
      .map((textNode) => textNode.textContent ?? "")
      .join("");
  }

  if (type === "b") {
    return value === "1" ? "true" : "false";
  }

  return value;
}

function readWorksheetRows(xml: Document, sharedStrings: string[]): string[][] {
  return Array.from(xml.getElementsByTagName("row"))
    .map((row) => {
      const cells: string[] = [];

      for (const cell of Array.from(row.getElementsByTagName("c"))) {
        const cellRef = cell.getAttribute("r") ?? "";

        cells[getColumnIndex(cellRef)] = readCellValue(cell, sharedStrings);
      }

      return cells.map((value) => value ?? "");
    })
    .filter((row) => row.some((value) => value.trim()));
}

function rowsToTerms(rows: string[][], userId: string, formatLabel: string): Term[] {
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map(normalizeHeaderName);

  if (!headers.includes("source") || !headers.includes("target")) {
    throw new Error(`${formatLabel} 第一行必须包含 source 和 target 表头。`);
  }

  return rows.slice(1).map((columns, rowIndex) => {
    const row: ImportTermRow = {};

    headers.forEach((header, columnIndex) => {
      const value = columns[columnIndex] ?? "";

      if (header === "source") {
        row.source = value;
      } else if (header === "target") {
        row.target = value;
      } else if (header === "part_of_speech") {
        row.part_of_speech = value;
      } else if (header === "note") {
        row.note = value;
      } else if (header === "variants") {
        row.variants = value;
      } else if (header === "case_sensitive") {
        row.case_sensitive = value;
      } else if (header === "id") {
        row.id = value;
      }
    });

    const term = normalizeTerm(row, userId);

    validateImportedTerm(term, rowIndex + 2);

    return term;
  });
}

async function parseXlsxTerms(file: Blob, userId: string): Promise<Term[]> {
  const zip = await JSZip.loadAsync(file);
  const workbookXml = parseXml(await getZipText(zip, "xl/workbook.xml"), "XLSX workbook");
  const relsXml = parseXml(
    await getZipText(zip, "xl/_rels/workbook.xml.rels"),
    "XLSX relationships",
  );
  const firstSheet = workbookXml.getElementsByTagName("sheet")[0];
  const relationshipId =
    firstSheet?.getAttribute("r:id") ??
    firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");

  if (!relationshipId) {
    throw new Error("XLSX 没有可读取的工作表。");
  }

  const worksheetPath = getRelationshipTarget(relsXml, relationshipId);
  const worksheetXml = parseXml(await getZipText(zip, worksheetPath), "XLSX worksheet");
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  const sharedStringsXml = sharedStringsFile
    ? parseXml(await sharedStringsFile.async("text"), "XLSX shared strings")
    : null;

  return rowsToTerms(
    readWorksheetRows(worksheetXml, readSharedStrings(sharedStringsXml)),
    userId,
    "XLSX",
  );
}

async function parseImportedTerms(file: File, userId: string): Promise<Term[]> {
  const extension = getFileExtension(file.name);

  if (extension === "xls") {
    throw new Error("当前不支持 .xls。请另存为 .xlsx 后再导入。");
  }

  if (extension === "xlsx") {
    return parseXlsxTerms(file, userId);
  }

  const text = await file.text();

  if (extension === "json") {
    return parseJsonTerms(text, userId);
  }

  if (extension === "jsonl") {
    return parseJsonlTerms(text, userId);
  }

  if (extension === "csv") {
    return parseCsvTerms(text, userId);
  }

  throw new Error("当前仅支持导入 .json、.jsonl、.csv、.xlsx 术语文件。");
}

function findSameTermIndex(terms: Term[], term: Term): number {
  const byId = terms.findIndex((row) => row.id === term.id);

  if (byId >= 0) {
    return byId;
  }

  return terms.findIndex((row) => row.source === term.source);
}

export async function loadTerms(): Promise<Term[]> {
  if (cachedTerms) {
    return cachedTerms;
  }

  return loadTermsFresh();
}

export async function loadTermsFresh(): Promise<Term[]> {
  try {
    cachedTerms = sortTerms(
      (await getProjectStorage().readJsonl<Partial<Term>>(TERMS_PATH)).map(
        (term) => normalizeTerm(term, "unknown_user"),
      ),
    );
    return cachedTerms;
  } catch {
    throw new Error("术语表无法读取。请确认项目里包含术语数据文件。");
  }
}

export async function saveTerms(terms: Term[]): Promise<Term[]> {
  const sortedTerms = sortTerms(terms);

  const storage = getProjectStorage();

  await storage.ensureDirectory("terms");
  await storage.writeJsonl(TERMS_PATH, sortedTerms);
  cachedTerms = sortedTerms;

  return sortedTerms;
}

export async function addTerm(input: TermInput, userId: string): Promise<Term> {
  const actorId = getWriteUserId(userId);

  assertTermWritePermission(canCreateTerm(getCurrentUser()));

  const normalizedInput = normalizeTermInput(input);

  validateTermInput(normalizedInput);

  const terms = await loadTerms();
  const term: Term = {
    id: createId("term"),
    ...normalizedInput,
    created_by: actorId,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  await saveTerms([...terms, term]);

  return term;
}

export async function updateTerm(
  termId: string,
  input: TermInput,
): Promise<Term> {
  assertTermWritePermission(canUpdateTerm(getCurrentUser()));

  const normalizedInput = normalizeTermInput(input);

  validateTermInput(normalizedInput);

  const terms = await loadTerms();
  const termIndex = terms.findIndex((term) => term.id === termId);

  if (termIndex < 0) {
    throw new Error("没有找到要编辑的术语。");
  }

  const updatedTerm: Term = {
    ...terms[termIndex],
    ...normalizedInput,
    updated_at: nowIso(),
  };
  const nextTerms = [...terms];

  nextTerms[termIndex] = updatedTerm;
  await saveTerms(nextTerms);

  return updatedTerm;
}

export async function deleteTerm(termId: string): Promise<void> {
  assertTermWritePermission(canDeleteTerm(getCurrentUser()));

  const terms = await loadTerms();
  const nextTerms = terms.filter((term) => term.id !== termId);

  if (nextTerms.length === terms.length) {
    throw new Error("没有找到要删除的术语。");
  }

  await saveTerms(nextTerms);
}

export async function importTermsFile(
  file: File,
  userId: string,
): Promise<ImportedTermsResult> {
  const actorId = getWriteUserId(userId);

  assertTermWritePermission(canImportTerm(getCurrentUser()));

  const importedTerms = await parseImportedTerms(file, actorId);
  const terms = await loadTerms();
  const nextTerms = [...terms];
  let added = 0;
  let updated = 0;

  for (const term of importedTerms) {
    const termIndex = findSameTermIndex(nextTerms, term);
    const nextTerm: Term = {
      ...term,
      updated_at: nowIso(),
    };

    if (termIndex >= 0) {
      nextTerms[termIndex] = {
        ...nextTerms[termIndex],
        ...nextTerm,
        id: nextTerms[termIndex].id,
        created_by: nextTerms[termIndex].created_by,
        created_at: nextTerms[termIndex].created_at,
      };
      updated += 1;
    } else {
      nextTerms.push(nextTerm);
      added += 1;
    }
  }

  await saveTerms(nextTerms);

  return {
    added,
    updated,
    total: importedTerms.length,
  };
}

export async function exportTermsFile(): Promise<ExportedTermsFile> {
  assertTermWritePermission(canExportTerm(getCurrentUser()));

  const terms = await loadTerms();
  const createdAt = utcDateKey();

  return {
    fileName: `terms-${createdAt}.jsonl`,
    blob: new Blob([stringifyJsonl(terms)], {
      type: "application/x-jsonlines;charset=utf-8",
    }),
  };
}

export async function matchTerms(sourceText: string): Promise<Term[]> {
  const terms = await loadTerms();

  return terms
    .filter((term) => findMatchedText(term, sourceText))
    .sort(
      (a, b) =>
        b.source.length - a.source.length || a.source.localeCompare(b.source),
    );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function columnName(index: number): string {
  let name = "";
  let value = index + 1;

  while (value > 0) {
    const modulo = (value - 1) % 26;

    name = String.fromCharCode(65 + modulo) + name;
    value = Math.floor((value - modulo) / 26);
  }

  return name;
}

function createInlineStringCell(value: string, columnIndex: number, rowIndex: number): string {
  const cellRef = `${columnName(columnIndex)}${rowIndex}`;

  return `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function createWorksheetXml(rows: string[][]): string {
  const rowXml = rows
    .map((row, rowIndex) => {
      const excelRowIndex = rowIndex + 1;
      const cells = row
        .map((value, columnIndex) =>
          createInlineStringCell(value, columnIndex, excelRowIndex),
        )
        .join("");

      return `<row r="${excelRowIndex}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

export async function createTermSampleXlsxBlob(): Promise<Blob> {
  const zip = new JSZip();
  const rows = [
    ["source", "target", "part_of_speech", "note", "variants", "case_sensitive"],
    ["魔術回路", "魔术回路", "名词", "专有名词", "魔術迴路;魔术迴路", "false"],
    ["遠坂凛", "远坂凛", "人名", "角色名", "遠坂 凛", "true"],
  ];

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="terms" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
  );
  zip.file("xl/worksheets/sheet1.xml", createWorksheetXml(rows));

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function searchTerms(keyword: string): Promise<Term[]> {
  const query = keyword.trim().toLowerCase();

  if (!query) {
    return [];
  }

  const terms = await loadTerms();

  return terms.filter((term) => {
    const values = [
      term.source,
      term.target,
      term.part_of_speech,
      term.note,
      ...term.variants,
    ].map((value) => value.toLowerCase());

    return values.some((value) => value.includes(query));
  });
}

export async function checkTermUsage(
  sourceText: string,
  targetText: string,
): Promise<TermUsageResult[]> {
  const terms = await matchTerms(sourceText);

  return checkTermUsageWithTerms(terms, sourceText, targetText);
}

export function checkTermUsageWithTerms(
  terms: Term[],
  sourceText: string,
  targetText: string,
): TermUsageResult[] {
  return terms.map((term) => ({
    term,
    matchedText: findMatchedText(term, sourceText) ?? term.source,
    isRecommendedUsed: includesTermText(
      targetText,
      term.target,
      term.case_sensitive === true,
    ),
  }));
}
