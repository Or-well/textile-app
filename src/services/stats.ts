import type { Entry } from "../model/types";
import { loadAllEntries } from "./entries";

export interface BasicProjectStats {
  totalEntries: number;
  untranslatedEntries: number;
  translatedEntries: number;
  proofreadEntries: number;
  reviewedEntries: number;
  disputedEntries: number;
  progressPercent: number;
}

function countByStatus(entries: Entry[], status: Entry["status"]): number {
  return entries.filter((entry) => entry.status === status).length;
}

export async function getProjectStats(
  entries?: Entry[],
): Promise<BasicProjectStats> {
  const rows = entries ?? (await loadAllEntries());
  const totalEntries = rows.length;
  const untranslatedEntries = countByStatus(rows, "untranslated");
  const translatedEntries = countByStatus(rows, "translated");
  const proofreadEntries = countByStatus(rows, "proofread");
  const reviewedEntries = countByStatus(rows, "reviewed");
  const disputedEntries = countByStatus(rows, "disputed");
  const completedEntries = totalEntries - untranslatedEntries;
  const progressPercent =
    totalEntries === 0 ? 0 : Math.round((completedEntries / totalEntries) * 100);

  return {
    totalEntries,
    untranslatedEntries,
    translatedEntries,
    proofreadEntries,
    reviewedEntries,
    disputedEntries,
    progressPercent,
  };
}
