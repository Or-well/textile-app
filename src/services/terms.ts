import type { Term } from "../model/types";
import { readJsonl, type ProjectDirectoryHandle } from "./projectFs";

export interface TermUsageResult {
  term: Term;
  matchedText: string;
  isRecommendedUsed: boolean;
}

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

export async function loadTerms(): Promise<Term[]> {
  if (cachedTerms) {
    return cachedTerms;
  }

  try {
    cachedTerms = await readJsonl<Term>(getProjectRoot(), "terms/terms.jsonl");
    return cachedTerms;
  } catch {
    throw new Error("术语表无法读取。请确认项目里包含术语数据文件。");
  }
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
