import { PERMISSION_ACTIONS } from "../model/permissions";
import {
  parseEntryExchangeWorkflowFields,
  toEntryExchangeRow,
} from "../model/entryExchange";
import type { Member, ProjectConfig } from "../model/types";
import { stringifyJsonl } from "../utils/jsonl";
import { loadEntries } from "./entries";
import { assertCan } from "./permissions";

export type EntryExchangeFormat = "json" | "jsonl";

export interface EntryExchangeExport {
  blob: Blob;
  fileName: string;
  entryCount: number;
}

function fileNameWithoutExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export async function exportEntryExchangeFile(
  project: ProjectConfig,
  fileId: string,
  format: EntryExchangeFormat,
  actor: Member | null | undefined,
): Promise<EntryExchangeExport> {
  assertCan(
    actor,
    PERMISSION_ACTIONS.FILE_VIEW,
    project,
    "当前成员没有导出词条交换文件的权限。",
  );

  const projectFile = project.files.find((file) => file.id === fileId);

  if (!projectFile) {
    throw new Error("没有找到要导出的项目文件。");
  }

  if (projectFile.hidden) {
    throw new Error("隐藏文件不能导出词条交换文件。请先取消隐藏。");
  }

  const entries = await loadEntries(fileId);

  if (entries.some((entry) => entry.hidden)) {
    throw new Error(
      "当前文件包含隐藏词条。为避免生成不完整交换文件，请先取消隐藏后再导出。",
    );
  }

  const rows = [...entries]
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id))
    .map(toEntryExchangeRow);
  const seenIndexes = new Set<number>();

  rows.forEach((row, index) => {
    parseEntryExchangeWorkflowFields(row, index + 1);

    if (!Number.isInteger(row.index) || row.index <= 0) {
      throw new Error(
        `词条 ${row.key || index + 1} 的 index 不正确，不能导出交换文件。`,
      );
    }

    if (seenIndexes.has(row.index)) {
      throw new Error(
        `文件中存在重复 index ${row.index}，不能导出交换文件。`,
      );
    }

    seenIndexes.add(row.index);
  });
  const content =
    format === "jsonl"
      ? stringifyJsonl(rows)
      : `${JSON.stringify(rows, null, 2)}\n`;
  const baseName = fileNameWithoutExtension(projectFile.name);

  return {
    blob: new Blob([content], {
      type:
        format === "jsonl"
          ? "application/x-ndjson;charset=utf-8"
          : "application/json;charset=utf-8",
    }),
    fileName: `${baseName}.textile-entries.${format}`,
    entryCount: rows.length,
  };
}
