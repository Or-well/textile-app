import type { Member, Term } from "../model/types";
import { nowIso } from "../utils/time";
import {
  canDeleteTerm,
  canUpdateTerm,
} from "./permissions";
import { loadTermsFresh, saveTerms } from "./terms";

export type TermBatchOperation =
  | "set_part_of_speech"
  | "set_case_sensitive"
  | "clear_case_sensitive"
  | "delete";

export interface TermBatchRequest {
  termIds: string[];
  operation: TermBatchOperation;
  actor: Member | null | undefined;
  value?: string;
}

export interface TermBatchSkippedItem {
  termId: string;
  reason: string;
}

export interface TermBatchPreview {
  operation: TermBatchOperation;
  selectedCount: number;
  applicableTermIds: string[];
  skipped: TermBatchSkippedItem[];
  skippedReasonCounts: Array<{ reason: string; count: number }>;
}

export interface TermBatchResult extends TermBatchPreview {
  updatedTerms: Term[];
  deletedTermIds: string[];
}

interface PreparedTermBatch {
  preview: TermBatchPreview;
  nextTerms: Term[];
  updatedTerms: Term[];
  deletedTermIds: string[];
}

const TERM_BATCH_OPERATIONS = new Set<TermBatchOperation>([
  "set_part_of_speech",
  "set_case_sensitive",
  "clear_case_sensitive",
  "delete",
]);

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

function countSkippedReasons(
  skipped: TermBatchSkippedItem[],
): TermBatchPreview["skippedReasonCounts"] {
  const counts = new Map<string, number>();

  for (const item of skipped) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }

  return Array.from(counts, ([reason, count]) => ({ reason, count })).sort(
    (left, right) => right.count - left.count,
  );
}

function resolveActor(actor: Member | null | undefined): Member {
  if (!actor?.id || !actor.active) {
    throw new Error("请先登录项目成员账号。");
  }

  return actor;
}

function assertOperation(operation: TermBatchOperation): void {
  if (!TERM_BATCH_OPERATIONS.has(operation)) {
    throw new Error("不支持的术语批量操作。");
  }
}

function assertPermission(
  operation: TermBatchOperation,
  actor: Member,
): void {
  const allowed =
    operation === "delete" ? canDeleteTerm(actor) : canUpdateTerm(actor);

  if (!allowed) {
    throw new Error("当前成员没有执行该术语批量操作的权限。");
  }
}

async function prepareTermBatch(
  request: TermBatchRequest,
): Promise<PreparedTermBatch> {
  const actor = resolveActor(request.actor);
  assertOperation(request.operation);
  assertPermission(request.operation, actor);

  const termIds = uniqueIds(request.termIds);
  const selectedIds = new Set(termIds);
  const terms = await loadTermsFresh();
  const termsById = new Map(terms.map((term) => [term.id, term]));
  const skipped: TermBatchSkippedItem[] = [];
  const applicableTermIds: string[] = [];
  const updatedTerms: Term[] = [];
  const deletedTermIds: string[] = [];
  const updatedAt = nowIso();
  const partOfSpeech = request.value?.trim() ?? "";

  if (request.operation === "set_part_of_speech" && !partOfSpeech) {
    throw new Error("请选择要统一设置的词性。");
  }

  for (const termId of termIds) {
    const term = termsById.get(termId);

    if (!term) {
      skipped.push({ termId, reason: "术语不存在或已被删除" });
      continue;
    }

    if (
      request.operation === "set_part_of_speech" &&
      term.part_of_speech === partOfSpeech
    ) {
      skipped.push({ termId, reason: "词性已经是指定值" });
      continue;
    }

    if (
      request.operation === "set_case_sensitive" &&
      term.case_sensitive === true
    ) {
      skipped.push({ termId, reason: "已经区分大小写" });
      continue;
    }

    if (
      request.operation === "clear_case_sensitive" &&
      term.case_sensitive !== true
    ) {
      skipped.push({ termId, reason: "已经忽略大小写" });
      continue;
    }

    applicableTermIds.push(termId);

    if (request.operation === "delete") {
      deletedTermIds.push(termId);
      continue;
    }

    updatedTerms.push({
      ...term,
      part_of_speech:
        request.operation === "set_part_of_speech"
          ? partOfSpeech
          : term.part_of_speech,
      case_sensitive:
        request.operation === "set_case_sensitive"
          ? true
          : request.operation === "clear_case_sensitive"
            ? false
            : term.case_sensitive,
      updated_at: updatedAt,
    });
  }

  const updatedById = new Map(updatedTerms.map((term) => [term.id, term]));
  const nextTerms = terms
    .filter((term) => !deletedTermIds.includes(term.id))
    .map((term) => updatedById.get(term.id) ?? term);
  const preview: TermBatchPreview = {
    operation: request.operation,
    selectedCount: selectedIds.size,
    applicableTermIds,
    skipped,
    skippedReasonCounts: countSkippedReasons(skipped),
  };

  return {
    preview,
    nextTerms,
    updatedTerms,
    deletedTermIds,
  };
}

export async function previewTermBatch(
  request: TermBatchRequest,
): Promise<TermBatchPreview> {
  return (await prepareTermBatch(request)).preview;
}

export async function executeTermBatch(
  request: TermBatchRequest,
): Promise<TermBatchResult> {
  const prepared = await prepareTermBatch(request);

  if (prepared.preview.applicableTermIds.length > 0) {
    await saveTerms(prepared.nextTerms);
  }

  return {
    ...prepared.preview,
    updatedTerms: prepared.updatedTerms,
    deletedTermIds: prepared.deletedTermIds,
  };
}
