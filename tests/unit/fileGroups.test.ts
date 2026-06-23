import { describe, expect, it } from "vitest";
import type { ProjectFile } from "../../src/model/types";
import {
  fileMatchesGroupFilter,
  listFileGroups,
  normalizeFileGroupName,
  UNGROUPED_FILE_FILTER,
} from "../../src/utils/fileGroups";

function createFile(id: string, folder?: string): ProjectFile {
  return {
    id,
    name: `${id}.txt`,
    source_path: `source/${id}.txt`,
    entries_path: `entries/${id}`,
    type: "txt",
    folder,
    hidden: false,
    locked: false,
  };
}

describe("file groups", () => {
  it("normalizes whitespace and lists only non-empty groups", () => {
    const files = [
      createFile("a", " Main "),
      createFile("b", "Main"),
      createFile("c", "Side"),
      createFile("d", "  "),
    ];

    expect(listFileGroups(files)).toEqual([
      { name: "Main", fileCount: 2 },
      { name: "Side", fileCount: 1 },
    ]);
  });

  it("matches all, named and ungrouped filters", () => {
    const grouped = createFile("a", " Main ");
    const ungrouped = createFile("b");

    expect(fileMatchesGroupFilter(grouped, "")).toBe(true);
    expect(fileMatchesGroupFilter(grouped, "Main")).toBe(true);
    expect(fileMatchesGroupFilter(grouped, UNGROUPED_FILE_FILTER)).toBe(false);
    expect(fileMatchesGroupFilter(ungrouped, UNGROUPED_FILE_FILTER)).toBe(true);
    expect(normalizeFileGroupName("  ")).toBe("");
  });
});
