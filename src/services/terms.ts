import type { Term } from "../model/types";
import { createId } from "../utils/id";
import { parseJsonl, stringifyJsonl } from "../utils/jsonl";
import { nowIso } from "../utils/time";
import {
  ensureDirectory,
  readJsonl,
  writeJsonl,
  type ProjectDirectoryHandle,
} from "./projectFs";

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

const TERMS_PATH = "terms/terms.jsonl";

let currentProjectRoot: ProjectDirectoryHandle | null = null;
let cachedTerms: Term[] | null = null;

export function setTermsProjectRoot(root: ProjectDirectoryHandle): void {
  currentProjectRoot = root;
  cachedTerms = null;
}

function getProjectRoot(): ProjectDirectoryHandle {
  if (!currentProjectRoot) {
    throw new Error("请先打开项目文件夹。");
  }

  return currentProjectRoot;
}

function findMatchedText(term: Term, sourceText: string): string | undefined {
  if (sourceText.includes(term.source)) {
    return term.source;
  }

  return term.variants.find((variant) => sourceText.includes(variant));
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
  };
}

function normalizeTerm(term: Partial<Term>, userId: string): Term {
  const now = nowIso();
  const variants = Array.isArray(term.variants) ? term.variants : [];

  return {
    id: term.id || createId("term"),
    source: term.source?.trim() ?? "",
    target: term.target?.trim() ?? "",
    part_of_speech: term.part_of_speech?.trim() ?? "",
    note: term.note?.trim() ?? "",
    variants: normalizeVariants(variants),
    created_by: term.created_by || userId,
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

function parseImportedTerms(text: string, userId: string): Term[] {
  try {
    const json = JSON.parse(text) as unknown;

    if (Array.isArray(json)) {
      return json.map((row) => normalizeTerm(row as Partial<Term>, userId));
    }
  } catch {
    // Not a JSON array; try JSONL below.
  }

  try {
    return parseJsonl<Partial<Term>>(text).map((row) =>
      normalizeTerm(row, userId),
    );
  } catch {
    throw new Error("术语文件无法读取。请确认文件是 JSONL 或术语数组 JSON。");
  }
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

  try {
    cachedTerms = sortTerms(
      (await readJsonl<Partial<Term>>(getProjectRoot(), TERMS_PATH)).map(
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

  await ensureDirectory(getProjectRoot(), "terms");
  await writeJsonl(getProjectRoot(), TERMS_PATH, sortedTerms);
  cachedTerms = sortedTerms;

  return sortedTerms;
}

export async function addTerm(input: TermInput, userId: string): Promise<Term> {
  const normalizedInput = normalizeTermInput(input);

  validateTermInput(normalizedInput);

  const terms = await loadTerms();
  const term: Term = {
    id: createId("term"),
    ...normalizedInput,
    created_by: userId,
    updated_at: nowIso(),
  };

  await saveTerms([...terms, term]);

  return term;
}

export async function updateTerm(
  termId: string,
  input: TermInput,
): Promise<Term> {
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
  const terms = await loadTerms();
  const nextTerms = terms.filter((term) => term.id !== termId);

  if (nextTerms.length === terms.length) {
    throw new Error("没有找到要删除的术语。");
  }

  await saveTerms(nextTerms);
}

export async function importTermsFile(
  file: Blob,
  userId: string,
): Promise<ImportedTermsResult> {
  const importedTerms = parseImportedTerms(await file.text(), userId).filter(
    (term) => term.source && term.target,
  );
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
  const terms = await loadTerms();
  const createdAt = nowIso().slice(0, 10);

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

export async function checkTermUsage(
  sourceText: string,
  targetText: string,
): Promise<TermUsageResult[]> {
  const terms = await matchTerms(sourceText);

  return terms.map((term) => ({
    term,
    matchedText: findMatchedText(term, sourceText) ?? term.source,
    isRecommendedUsed: targetText.includes(term.target),
  }));
}
