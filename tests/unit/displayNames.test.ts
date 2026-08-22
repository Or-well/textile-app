import { describe, expect, it } from "vitest";
import {
  getEntryDisplayName,
  getFileDisplayName,
} from "../../src/model/displayNames";
import type { Entry, ProjectFile } from "../../src/model/types";

const files: ProjectFile[] = [
  {
    id: "file-internal-1",
    name: "第一章.ks",
    source_path: "source/first.ks",
    entries_path: "entries/file-internal-1",
    type: "ks",
    hidden: false,
    locked: false,
  },
];

describe("display names", () => {
  it("never uses a missing file id as its visible fallback", () => {
    expect(getFileDisplayName(files, "file-missing")).toBe("已删除文件");
    expect(getFileDisplayName(files, "")).toBe("未关联文件");
  });

  it("describes entries with user-facing file and key data", () => {
    const entry = {
      id: "entry-internal-1",
      file_id: "file-internal-1",
      key: "scene_001",
      index: 0,
    } as Entry;

    expect(getEntryDisplayName(entry, files)).toBe("第一章.ks · scene_001");
    expect(getEntryDisplayName(entry, [])).not.toContain(entry.id);
    expect(getEntryDisplayName(entry, [])).not.toContain(entry.file_id);
  });
});
