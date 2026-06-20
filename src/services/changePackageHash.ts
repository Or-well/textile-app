import type {
  Comment,
  Entry,
  ProjectEvent,
  Task,
  Term,
} from "../model/types";
import { sha256Hex, stableStringify } from "./crypto";

export interface ChangePackagePayload {
  entries: Record<string, Entry[]>;
  comments: Record<string, Comment[]>;
  terms: Record<string, Term[]>;
  contexts: Record<string, string>;
  sourceFiles: Record<string, string>;
  tasks: Record<string, Task[]>;
  projectFiles: Record<string, string>;
  memberFiles: Record<string, string>;
  events: ProjectEvent[];
}

type HashableRow = {
  id?: string;
  entry_id?: string;
  created_at?: string;
  index?: number;
};

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function getStableRowKey(row: HashableRow): string {
  return [
    row.id ?? "",
    row.entry_id ?? "",
    typeof row.index === "number" ? String(row.index).padStart(8, "0") : "",
    row.created_at ?? "",
  ].join("|");
}

function sortRows<T extends HashableRow>(rows: T[]): T[] {
  return [...rows].sort((left, right) =>
    compareText(getStableRowKey(left), getStableRowKey(right)),
  );
}

function normalizeRecordRows<T extends HashableRow>(
  rowsByPath: Record<string, T[]>,
): { path: string; rows: T[] }[] {
  return Object.entries(rowsByPath)
    .sort(([leftPath], [rightPath]) => compareText(leftPath, rightPath))
    .map(([path, rows]) => ({
      path,
      rows: sortRows(rows),
    }));
}

function normalizeTextRecord(
  rowsByPath: Record<string, string>,
): { path: string; content: string }[] {
  return Object.entries(rowsByPath)
    .sort(([leftPath], [rightPath]) => compareText(leftPath, rightPath))
    .map(([path, content]) => ({ path, content }));
}

export function buildChangePackageHashPayload(payload: ChangePackagePayload) {
  return {
    entries: normalizeRecordRows(payload.entries),
    comments: normalizeRecordRows(payload.comments),
    terms: normalizeRecordRows(payload.terms),
    contexts: normalizeTextRecord(payload.contexts),
    source: normalizeTextRecord(payload.sourceFiles),
    tasks: normalizeRecordRows(payload.tasks),
    project: normalizeTextRecord(payload.projectFiles),
    members: normalizeTextRecord(payload.memberFiles),
    logs: sortRows(payload.events),
  };
}

export async function calculateChangePackageContentHash(
  payload: ChangePackagePayload,
): Promise<string> {
  return sha256Hex(stableStringify(buildChangePackageHashPayload(payload)));
}
