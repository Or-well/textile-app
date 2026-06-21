import type { Entry, EntryStatus } from "./types";
import { hasWorkflowTarget } from "./status";

export const ENTRY_EXCHANGE_STATUSES: readonly EntryStatus[] = [
  "untranslated",
  "translated",
  "proofread",
  "reviewed",
];

const WORKFLOW_FIELD_NAMES = [
  "translated_by",
  "proofread_count",
  "proofread_by",
  "reviewed_by",
] as const;

const PROTECTED_FIELD_NAMES = [
  "id",
  "file_id",
  "assignee",
  "disputed",
  "dispute_reason",
  "dispute_resolved_at",
  "dispute_resolved_by",
  "word_count",
  "hidden",
  "locked",
  "updated_at",
  "updated_by",
] as const;

export interface EntryExchangeWorkflowFields {
  status: EntryStatus;
  translated_by: string;
  proofread_count: number;
  proofread_by: string[];
  reviewed_by: string;
}

export interface EntryExchangeRow
  extends EntryExchangeWorkflowFields,
    Record<string, unknown> {
  key: string;
  index: number;
  speaker: string;
  source: string;
  target: string;
  context: string;
}

function hasOwn(row: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, field);
}

export function hasEntryExchangeWorkflowFields(
  row: Record<string, unknown>,
): boolean {
  return WORKFLOW_FIELD_NAMES.some((field) => hasOwn(row, field));
}

function getTargetText(row: Record<string, unknown>): string {
  const value = row.target ?? row.translation ?? "";

  return typeof value === "string" ? value : "";
}

function getSourceText(row: Record<string, unknown>): string {
  const value = row.source ?? row.original ?? "";

  return typeof value === "string" ? value : "";
}

function assertContentFieldTypes(
  row: Record<string, unknown>,
  rowLabel: string,
): void {
  for (const field of ["key", "speaker", "context"] as const) {
    if (row[field] !== undefined && typeof row[field] !== "string") {
      throw new Error(`${rowLabel}的 ${field} 必须是字符串。`);
    }
  }

  if (
    row.source !== undefined &&
    typeof row.source !== "string"
  ) {
    throw new Error(`${rowLabel}的 source 必须是字符串。`);
  }

  if (
    row.original !== undefined &&
    typeof row.original !== "string"
  ) {
    throw new Error(`${rowLabel}的 original 必须是字符串。`);
  }

  if (
    row.target !== undefined &&
    typeof row.target !== "string"
  ) {
    throw new Error(`${rowLabel}的 target 必须是字符串。`);
  }

  if (
    row.translation !== undefined &&
    typeof row.translation !== "string"
  ) {
    throw new Error(`${rowLabel}的 translation 必须是字符串。`);
  }
}

function parseOptionalUser(
  row: Record<string, unknown>,
  field: "translated_by" | "reviewed_by",
  rowLabel: string,
): string {
  const value = row[field];

  if (value === undefined) {
    return "";
  }

  if (typeof value !== "string") {
    throw new Error(`${rowLabel}的 ${field} 必须是字符串。`);
  }

  return value.trim();
}

function parseProofreadUsers(value: unknown, rowLabel: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(`${rowLabel}的 proofread_by 必须是非空字符串数组。`);
  }

  const users = value.map((item) => item.trim());

  if (new Set(users).size !== users.length) {
    throw new Error(`${rowLabel}的 proofread_by 不能包含重复成员。`);
  }

  return users;
}

export function parseEntryExchangeWorkflowFields(
  row: Record<string, unknown>,
  rowNumber: number,
): EntryExchangeWorkflowFields | null {
  if (!hasEntryExchangeWorkflowFields(row)) {
    return null;
  }

  const rowLabel = `第 ${rowNumber} 条交换词条`;
  assertContentFieldTypes(row, rowLabel);
  const protectedField = PROTECTED_FIELD_NAMES.find((field) => hasOwn(row, field));

  if (protectedField) {
    throw new Error(
      `${rowLabel}包含不允许导入的管理字段 ${protectedField}。交换文件只能携带词条内容和工作流信息。`,
    );
  }

  if (
    typeof row.status !== "string" ||
    !ENTRY_EXCHANGE_STATUSES.includes(row.status as EntryStatus)
  ) {
    throw new Error(`${rowLabel}必须提供有效的 status。`);
  }

  const status = row.status as EntryStatus;
  const source = getSourceText(row);
  const target = getTargetText(row);
  const translatedBy = parseOptionalUser(row, "translated_by", rowLabel);
  const reviewedBy = parseOptionalUser(row, "reviewed_by", rowLabel);
  const proofreadUsers = parseProofreadUsers(row.proofread_by, rowLabel);
  const rawProofreadCount = row.proofread_count ?? 0;

  if (
    typeof rawProofreadCount !== "number" ||
    !Number.isInteger(rawProofreadCount) ||
    rawProofreadCount < 0 ||
    rawProofreadCount > 3
  ) {
    throw new Error(`${rowLabel}的 proofread_count 必须是 0 到 3 的整数。`);
  }

  if (proofreadUsers.length > rawProofreadCount) {
    throw new Error(`${rowLabel}的校对成员数量不能大于 proofread_count。`);
  }

  if (status === "untranslated") {
    if (
      target.trim() ||
      translatedBy ||
      rawProofreadCount > 0 ||
      proofreadUsers.length > 0 ||
      reviewedBy
    ) {
      throw new Error(
        `${rowLabel}标记为 untranslated 时，译文和翻译、校对、审核信息必须为空。`,
      );
    }
  } else if (!hasWorkflowTarget({ source, target })) {
    throw new Error(`${rowLabel}标记为 ${status} 时译文不能为空。`);
  }

  if (
    status === "translated" &&
    (rawProofreadCount > 0 || proofreadUsers.length > 0 || reviewedBy)
  ) {
    throw new Error(
      `${rowLabel}标记为 translated 时不能包含校对或审核结果。`,
    );
  }

  if (status === "proofread") {
    if (rawProofreadCount === 0) {
      throw new Error(
        `${rowLabel}标记为 proofread 时 proofread_count 必须大于 0。`,
      );
    }

    if (reviewedBy) {
      throw new Error(
        `${rowLabel}标记为 proofread 时 reviewed_by 必须为空。`,
      );
    }
  }

  return {
    status,
    translated_by: translatedBy,
    proofread_count: rawProofreadCount,
    proofread_by: proofreadUsers,
    reviewed_by: reviewedBy,
  };
}

export function toEntryExchangeRow(entry: Entry): EntryExchangeRow {
  return {
    key: entry.key,
    index: entry.index,
    speaker: entry.speaker,
    source: entry.source,
    target: entry.target,
    context: entry.context ?? "",
    status: entry.status,
    translated_by: entry.translated_by,
    proofread_count: entry.proofread_count ?? 0,
    proofread_by: [...(entry.proofread_by ?? [])],
    reviewed_by: entry.reviewed_by,
  };
}
