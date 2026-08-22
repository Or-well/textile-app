import { describe, expect, it, vi } from "vitest";
import type { Entry } from "../../src/model/types";
import {
  loadEntries,
  saveEntry,
  setEntriesProjectStorage,
} from "../../src/services/entries";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createEntry, createMember, createProject } from "./factories";

async function prepareEntryStorage() {
  const storage = createProjectStorage(createMemoryProjectDirectory({}));
  const entry = createEntry({
    id: "file-1:000001",
    file_id: "file-1",
    index: 1,
    target: "",
    status: "untranslated",
  });

  await storage.writeJson(
    "project.json",
    createProject({
      files: [
        {
          id: "file-1",
          name: "file.txt",
          source_path: "source/file.txt",
          entries_path: "entries/file-1",
          type: "txt",
          hidden: false,
          locked: false,
        },
      ],
    }),
  );
  await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [entry]);
  await storage.writeJsonl("logs/events.jsonl", []);
  setEntriesProjectStorage(storage);

  return { storage, entry };
}

describe("entry read model", () => {
  it("coalesces concurrent file loads and reuses the loaded snapshot", async () => {
    const { storage } = await prepareEntryStorage();
    const readJsonl = vi.spyOn(storage, "readJsonl");

    const [first, second] = await Promise.all([
      loadEntries("file-1"),
      loadEntries("file-1"),
    ]);
    const third = await loadEntries("file-1");
    const entryReads = readJsonl.mock.calls.filter(
      ([path]) => path === "entries/file-1/chunk_0001.jsonl",
    );

    expect(entryReads).toHaveLength(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("uses the indexed chunk when saving a loaded entry", async () => {
    const { storage, entry } = await prepareEntryStorage();
    const actor = createMember(["owner"], { id: "owner-1" });

    await loadEntries("file-1");
    const listFiles = vi.spyOn(storage, "listFiles");

    const saved = await saveEntry(
      {
        ...entry,
        target: "译文",
        status: "translated",
      } as Entry,
      { actor },
    );

    expect(saved.target).toBe("译文");
    expect(listFiles).not.toHaveBeenCalled();
  });
});
