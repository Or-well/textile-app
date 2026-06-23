import type { ProjectFile } from "../model/types";

export const UNGROUPED_FILE_FILTER = "__ungrouped__";

export interface FileGroupSummary {
  name: string;
  fileCount: number;
}

export function normalizeFileGroupName(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function listFileGroups(files: ProjectFile[]): FileGroupSummary[] {
  const counts = new Map<string, number>();

  for (const file of files) {
    const name = normalizeFileGroupName(file.folder);

    if (name) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return Array.from(counts, ([name, fileCount]) => ({
    name,
    fileCount,
  })).sort((left, right) => left.name.localeCompare(right.name));
}

export function fileMatchesGroupFilter(
  file: ProjectFile,
  filter: string,
): boolean {
  if (!filter) {
    return true;
  }

  const groupName = normalizeFileGroupName(file.folder);

  return filter === UNGROUPED_FILE_FILTER
    ? !groupName
    : groupName === filter;
}
