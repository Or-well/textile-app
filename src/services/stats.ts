import type { Entry, ProjectConfig, TaskType } from "../model/types";
import {
  hasWorkflowTarget,
  isEntryProofreadComplete,
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

export interface TaskTypeProgress {
  progressAvailable: boolean;
  completedEntries: number;
  progressPercent: number;
}

type ProgressWeightInput = ProjectConfig["settings"]["progress_weights"];
type WorkflowInput = ProjectConfig["settings"]["workflow"];
type NormalizableProgressWeights = ProgressWeights & {
  translation?: number;
  proofread?: number;
  review?: number;
};

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
  workflow?: WorkflowInput,
): ProgressWeights {
  const workflowSettings = normalizeWorkflowSettings(workflow);
  const proofreadEnabled = workflowSettings.proofread_required > 0;
  const reviewEnabled = workflowSettings.review_required;
  const source = (weights ?? DEFAULT_PROGRESS_WEIGHTS) as NormalizableProgressWeights;

  const translationWeight =
    source.translation ?? source.translationWeight ?? DEFAULT_PROGRESS_WEIGHTS.translationWeight;
  const proofreadWeight = proofreadEnabled
    ? source.proofread ?? source.proofreadWeight ?? DEFAULT_PROGRESS_WEIGHTS.proofreadWeight
    : 0;
  const reviewWeight = reviewEnabled
    ? source.review ?? source.reviewWeight ?? DEFAULT_PROGRESS_WEIGHTS.reviewWeight
    : 0;

  if (
    !isValidWeight(translationWeight) ||
    !isValidWeight(proofreadWeight) ||
    !isValidWeight(reviewWeight)
  ) {
    return normalizeProgressWeights(DEFAULT_PROGRESS_WEIGHTS, workflow);
  }

  const total = translationWeight + proofreadWeight + reviewWeight;

  if (total <= 0) {
    return normalizeProgressWeights(DEFAULT_PROGRESS_WEIGHTS, workflow);
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
  const workflowSettings = normalizeWorkflowSettings(workflow);
  const progressWeights = normalizeProgressWeights(weights, workflowSettings);
  const totalEntries = rows.length;
  const untranslatedEntries = countByStatus(rows, "untranslated");
  const translatedEntries = countByStatus(rows, "translated");
  const proofreadEntries = workflowSettings.proofread_required > 0
    ? rows.filter((entry) =>
        isEntryProofreadComplete(entry, workflowSettings),
      ).length
    : 0;
  const reviewedEntries = workflowSettings.review_required
    ? countByStatus(rows, "reviewed")
    : 0;
  const disputedEntries = rows.filter((entry) => entry.disputed === true).length;
  const entriesWithTarget = rows.filter((entry) => hasWorkflowTarget(entry)).length;

  const translationRatio =
    totalEntries === 0 ? 0 : entriesWithTarget / totalEntries;
  const proofreadRatio =
    totalEntries === 0 || workflowSettings.proofread_required === 0
      ? 0
      : proofreadEntries / totalEntries;
  const reviewRatio =
    totalEntries === 0 || !workflowSettings.review_required
      ? 0
      : reviewedEntries / totalEntries;
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
    completedEntries: workflowSettings.review_required
      ? reviewedEntries
      : workflowSettings.proofread_required > 0
        ? proofreadEntries
        : entriesWithTarget,
    translationProgress: toPercent(translationRatio),
    proofreadProgress: toPercent(proofreadRatio),
    reviewProgress: toPercent(reviewRatio),
    progressPercent: toPercent(overallRatio),
    progressWeights,
    proofreadRequired: workflowSettings.proofread_required,
    reviewRequired: workflowSettings.review_required,
  };
}

export function calculateTaskTypeProgress(
  entries: Entry[],
  taskType: TaskType,
  workflow?: WorkflowInput,
): TaskTypeProgress {
  const rows = normalizeEntries(entries);
  const workflowSettings = normalizeWorkflowSettings(workflow);
  const totalEntries = rows.length;
  let completedEntries = 0;

  if (taskType === "translate") {
    completedEntries = rows.filter((entry) => hasWorkflowTarget(entry)).length;
  } else if (taskType === "proofread") {
    completedEntries = rows.filter((entry) =>
      isEntryProofreadComplete(entry, workflowSettings),
    ).length;
  } else if (taskType === "review") {
    completedEntries = rows.filter((entry) => entry.status === "reviewed").length;
  } else {
    return {
      progressAvailable: false,
      completedEntries: 0,
      progressPercent: 0,
    };
  }

  return {
    progressAvailable: true,
    completedEntries,
    progressPercent:
      totalEntries === 0 ? 0 : toPercent(completedEntries / totalEntries),
  };
}

export async function getProjectStats(
  entries?: Entry[],
  weights?: ProgressWeightInput,
  workflow?: WorkflowInput,
): Promise<BasicProjectStats> {
  return calculateEntryProgress(entries ?? (await loadAllEntries()), weights, workflow);
}
