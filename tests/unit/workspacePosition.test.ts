import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAllWorkspacePositions,
  getProjectWorkspacePosition,
  rememberProjectEntryPosition,
  rememberProjectFilePosition,
} from "../../src/services/workspacePosition";

function createStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("workspace positions", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: createStorage() },
    });
  });

  afterEach(() => {
    clearAllWorkspacePositions();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("remembers the last file and entry per project user", () => {
    rememberProjectFilePosition("project-1", "member-1", "file-1");
    rememberProjectEntryPosition(
      "project-1",
      "member-1",
      "file-1",
      "entry-7",
    );

    expect(getProjectWorkspacePosition("project-1", "member-1")).toMatchObject({
      projectId: "project-1",
      userId: "member-1",
      lastFileId: "file-1",
      entryByFileId: {
        "file-1": "entry-7",
      },
    });
    expect(getProjectWorkspacePosition("project-1", "member-2")).toBeNull();
  });

  it("keeps remembered entries for other files when the current file changes", () => {
    rememberProjectEntryPosition(
      "project-1",
      "member-1",
      "file-1",
      "entry-1",
    );
    rememberProjectEntryPosition(
      "project-1",
      "member-1",
      "file-2",
      "entry-2",
    );

    expect(getProjectWorkspacePosition("project-1", "member-1")).toMatchObject({
      lastFileId: "file-2",
      entryByFileId: {
        "file-1": "entry-1",
        "file-2": "entry-2",
      },
    });
  });

  it("drops positions for files that no longer exist", () => {
    rememberProjectEntryPosition(
      "project-1",
      "member-1",
      "file-1",
      "entry-1",
    );

    expect(
      getProjectWorkspacePosition("project-1", "member-1", ["file-2"]),
    ).toMatchObject({
      lastFileId: "",
      entryByFileId: {},
    });
  });
});
