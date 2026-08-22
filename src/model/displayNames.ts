import type { Entry, ProjectFile } from "./types";

export function getFileDisplayName(
  files: readonly ProjectFile[],
  fileId: string,
  options: { emptyLabel?: string; missingLabel?: string } = {},
): string {
  if (!fileId) {
    return options.emptyLabel ?? "未关联文件";
  }

  return (
    files.find((file) => file.id === fileId)?.name ??
    options.missingLabel ??
    "已删除文件"
  );
}

export function getEntryDisplayName(
  entry: Entry,
  files: readonly ProjectFile[] = [],
): string {
  const fileName = getFileDisplayName(files, entry.file_id, {
    missingLabel: "未知文件",
  });
  const entryLabel = entry.key?.trim() || `第 ${entry.index} 条`;

  return `${fileName} · ${entryLabel}`;
}
