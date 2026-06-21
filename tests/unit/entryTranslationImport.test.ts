import { describe, expect, it } from "vitest";
import type { Entry } from "../../src/model/types";
import {
  importEntryTranslations,
  setEntriesProjectStorage,
} from "../../src/services/entries";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createEntry } from "./factories";
import { FailingProjectStorage } from "./failingProjectStorage";

async function createImportStorage(entries: Entry[]) {
  const root = createMemoryProjectDirectory({}, "translation-import.hproj");
  const storage = createProjectStorage(root);

  await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", entries);
  setEntriesProjectStorage(storage);

  return storage;
}

describe("translation import workflow", () => {
  it("resets downstream workflow when imported target changes", async () => {
    const storage = await createImportStorage([
      createEntry({
        id: "file-1:1",
        file_id: "file-1",
        index: 1,
        key: "line_000001",
        target: "Reviewed",
        status: "reviewed",
        translated_by: "translator-1",
        proofread_by: ["proofreader-1"],
        proofread_count: 1,
        reviewed_by: "reviewer-1",
        disputed: true,
      }),
    ]);

    await expect(
      importEntryTranslations(
        "file-1",
        "translations.json",
        JSON.stringify([{ key: "line_000001", target: "Changed" }]),
        "importer-1",
      ),
    ).resolves.toEqual({ matched: 1, skipped: 0 });
    await expect(
      storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([
      {
        target: "Changed",
        status: "translated",
        translated_by: "importer-1",
        proofread_by: [],
        proofread_count: 0,
        reviewed_by: "",
        disputed: true,
      },
    ]);
    await expect(
      storage.readJsonl("logs/events.jsonl"),
    ).resolves.toMatchObject([
      {
        type: "entry.updated",
        user_id: "importer-1",
        detail: {
          operation: "translation_import",
          before_target: "Reviewed",
          after_target: "Changed",
          after_proofread_by: [],
          after_reviewed_by: "",
        },
      },
    ]);
  });

  it("skips locked and hidden entries", async () => {
    const storage = await createImportStorage([
      createEntry({
        id: "file-1:1",
        file_id: "file-1",
        index: 1,
        key: "line_000001",
        target: "Locked",
        status: "translated",
        locked: true,
      }),
      createEntry({
        id: "file-1:2",
        file_id: "file-1",
        index: 2,
        key: "line_000002",
        target: "Hidden",
        status: "translated",
        hidden: true,
      }),
    ]);

    await expect(
      importEntryTranslations(
        "file-1",
        "translations.json",
        JSON.stringify([
          { key: "line_000001", target: "Changed locked" },
          { key: "line_000002", target: "Changed hidden" },
        ]),
        "importer-1",
      ),
    ).resolves.toEqual({ matched: 0, skipped: 2 });
    await expect(
      storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([
      { target: "Locked" },
      { target: "Hidden" },
    ]);
  });

  it("rolls back imported entries when history writing fails", async () => {
    const baseStorage = await createImportStorage([
      createEntry({
        id: "file-1:1",
        file_id: "file-1",
        index: 1,
        key: "line_000001",
        target: "Original",
        status: "translated",
        translated_by: "translator-1",
      }),
    ]);
    const failingStorage = new FailingProjectStorage(baseStorage, 2);

    setEntriesProjectStorage(failingStorage);

    await expect(
      importEntryTranslations(
        "file-1",
        "translations.json",
        JSON.stringify([{ key: "line_000001", target: "Changed" }]),
        "importer-1",
      ),
    ).rejects.toThrow("已尝试恢复原数据");
    await expect(
      baseStorage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([{ target: "Original" }]);
    await expect(baseStorage.fileExists("logs/events.jsonl")).resolves.toBe(false);
  });
});
