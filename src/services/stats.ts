import type { Entry, ProjectConfig } from "../model/types";
import {
  isEntryProofreadComplete,
  isEntryReviewComplete,
  normalizeEntries,
  normalizeWorkflowSettings,
} from "../model/status";
import { loadAllEntries } from "./entries";

export interface ProgressWeights {
  translationWeight: number;
  proofreadWeight: number;
  reviewWeight: number;
}

export interface BasicProjectStats {
  totalEntries: number;
  untranslatedEntries: number;
  translatedEntries: number;
  proofreadEntries: number;
  reviewedEntries: number;
  disputedEntries: number;
  completedEntries: number;
  translationProgress: number;
  proofreadProgress: number;
  reviewProgress: number;
  progressPercent: number;
  progressWeights: ProgressWeights;
  proofreadRequired: number;
  reviewRequired: boolean;
}

type ProgressWeightInput = ProjectConfig["settings"]["progress_weights"];
type WorkflowInput = ProjectConfig["settings"]["workflow"];

export const DEFAULT_PROGRESS_WEIGHTS: ProgressWeights = {
  translationWeight: 0.4,
  proofreadWeight: 0.3,
  reviewWeight: 0.3,
};

function isValidWeight(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function normalizeProgressWeights(
  weights?: ProgressWeightInput,
): ProgressWeights {
  if (!weights) {
    return DEFAULT_PROGRESS_WEIGHTS;
  }

  const translationWeight =
    weights.translation ?? weights.translationWeight ?? DEFAULT_PROGRESS_WEIGHTS.translationWeight;
  const proofreadWeight =
    weights.proofread ?? weights.proofreadWeight ?? DEFAULT_PROGRESS_WEIGHTS.proofreadWeight;
  const reviewWeight =
    weights.review ?? weights.reviewWeight ?? DEFAULT_PROGRESS_WEIGHTS.reviewWeight;

  if (
    !isValidWeight(translationWeight) ||
    !isValidWeight(proofreadWeight) ||
    !isValidWeight(reviewWeight)
  ) {
    return DEFAULT_PROGRESS_WEIGHTS;
  }

  const total = translationWeight + proofreadWeight + reviewWeight;

  if (total <= 0) {
    return DEFAULT_PROGRESS_WEIGHTS;
  }

  return {
    translationWeight: translationWeight / total,
    proofreadWeight: proofreadWeight / total,
    reviewWeight: reviewWeight / total,
  };
}

function countByStatus(entries: Entry[], status: Entry["status"]): number {
  return entries.filter((entry) => entry.status === status).length;
}

function toPercent(value: number): number {
  return Math.round(value * 100);
}

export function calculateEntryProgress(
  entries: Entry[],
  weights?: ProgressWeightInput,
  workflow?: WorkflowInput,
): BasicProjectStats {
  const rows = normalizeEntries(entries);
  const progressWeights = normalizeProgressWeights(weights);
  const workflowSettings = normalizeWorkflowSettings(workflow);
  const totalEntries = rows.length;
  const untranslatedEntries = countByStatus(rows, "untranslated");
  const translatedEntries = countByStatus(rows, "translated");
  const proofreadEntries = rows.filter((entry) =>
    isEntryProofreadComplete(entry, workflowSettings),
  ).length;
  const reviewedEntries = rows.filter((entry) =>
    isEntryReviewComplete(entry, workflowSettings),
  ).length;
  const disputedEntries = rows.filter((entry) => entry.disputed === true).length;
  const translatedStageEntries =
    translatedEntries + countByStatus(rows, "proofread") + countByStatus(rows, "reviewed");

  const translationRatio =
    totalEntries === 0 ? 0 : translatedStageEntries / totalEntries;
  const proofreadRatio =
    totalEntries === 0 ? 0 : proofreadEntries / totalEntries;
  const reviewRatio = totalEntries === 0 ? 0 : reviewedEntries / totalEntries;
  const overallRatio =
    translationRatio * progressWeights.translationWeight +
    proofreadRatio * progressWeights.proofreadWeight +
    reviewRatio * progressWeights.reviewWeight;

  return {
    totalEntries,
    untranslatedEntries,
    translatedEntries,
    proofreadEntries,
    reviewedEntries,
    disputedEntries,
    completedEntries: reviewedEntries,
    translationProgress: toPercent(translationRatio),
    proofreadProgress: toPercent(proofreadRatio),
    reviewProgress: toPercent(reviewRatio),
    progressPercent: toPercent(overallRatio),
    progressWeights,
    proofreadRequired: workflowSettings.proofread_required,
    reviewRequired: workflowSettings.review_required,
  };
}

export async function getProjectStats(
  entries?: Entry[],
  weights?: ProgressWeightInput,
  workflow?: WorkflowInput,
): Promise<BasicProjectStats> {
  return calculateEntryProgress(entries ?? (await loadAllEntries()), weights, workflow);
}
