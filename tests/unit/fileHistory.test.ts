import { describe, expect, it } from "vitest";
import type { ProjectEvent } from "../../src/model/types";
import {
  getFileHistory,
  setHistoryProjectStorage,
} from "../../src/services/history";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import {
  addSourceFileToStorage,
  deleteProjectFileFromStorage,
  updateProjectFile,
  updateSourceFileInStorage,
} from "../../src/services/project";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createEntry, createMember, createProject } from "./factories";

async function createHistoryStorage(events: ProjectEvent[] = []) {
  const root = createMemoryProjectDirectory(
    {
      "project.json": JSON.stringify(createProject()),
      "logs/events.jsonl": "",
    },
    "file-history-test.hproj",
  );
  const storage = createProjectStorage(root);

  await storage.writeJsonl("logs/events.jsonl", events);
  setHistoryProjectStorage(storage);

  return storage;
}

async function createFileStorage() {
  const config = createProject({
    files: [
      {
        id: "file-1",
        name: "dialog.txt",
        source_path: "source/dialog.txt",
        entries_path: "entries/file-1",
        type: "txt",
        hidden: false,
        locked: false,
      },
    ],
    settings: {
      chunk_size: 1,
      auto_save: true,
      allow_change_package: true,
    },
  });
  const root = createMemoryProjectDirectory(
    {
      "project.json": `${JSON.stringify(config, null, 2)}\n`,
      "source/dialog.txt": "First\nSecond",
    },
    "file-history-project-test.hproj",
  );
  const storage = createProjectStorage(root);

  await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
    createEntry({
      id: "file-1:1",
      file_id: "file-1",
      index: 1,
      source: "First",
      target: "第一",
      status: "translated",
    }),
  ]);
  setHistoryProjectStorage(storage);

  return { storage, config };
}

describe("file history", () => {
  it("collects file events by file id, entry id prefix, and detail file id", async () => {
    await createHistoryStorage([
      {
        id: "event-old",
        type: "entry.updated",
        user_id: "member-1",
        entry_id: "file-1:1",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "event-new",
        type: "file.renamed",
        user_id: "member-2",
        file_id: "file-1",
        created_at: "2026-01-03T00:00:00.000Z",
        detail: {
          before_name: "a.txt",
          after_name: "b.txt",
        },
      },
      {
        id: "event-detail",
        type: "legacy.file.event",
        user_id: "member-3",
        created_at: "2026-01-02T00:00:00.000Z",
        detail: {
          file_id: "file-1",
        },
      },
      {
        id: "event-other",
        type: "file.renamed",
        user_id: "member-4",
        file_id: "file-2",
        created_at: "2026-01-04T00:00:00.000Z",
      },
    ]);

    const rows = await getFileHistory("file-1");

    expect(rows.map((row) => row.id)).toEqual([
      "event-new",
      "event-detail",
      "event-old",
    ]);
    expect(rows[0]).toMatchObject({
      label: "重命名文件",
      userId: "member-2",
    });
    expect(rows[1]).toMatchObject({
      label: "legacy.file.event",
    });
  });

  it("records source file lifecycle events", async () => {
    const { storage, config } = await createFileStorage();
    const actor = createMember(["owner"], { id: "owner-1" });

    const addResult = await addSourceFileToStorage(
      storage,
      config,
      new File(["Third"], "third.txt", { type: "text/plain" }),
      "chapter",
      actor,
    );
    const updateResult = await updateSourceFileInStorage(
      storage,
      addResult.config,
      addResult.file.id,
      new File(["Third changed"], "third.txt", { type: "text/plain" }),
      actor,
    );
    const renamedConfig = await updateProjectFile(
      storage.root,
      updateResult.config,
      addResult.file.id,
      { name: "third-renamed.txt" },
      actor,
    );

    await deleteProjectFileFromStorage(
      storage,
      renamedConfig,
      addResult.file.id,
      actor,
    );

    const rows = await getFileHistory(addResult.file.id);

    expect(rows.map((row) => row.type)).toEqual([
      "file.deleted",
      "file.renamed",
      "file.source_updated",
      "file.added",
    ]);
    expect(rows.find((row) => row.type === "file.added")?.detail).toMatchObject({
      file_name: "third.txt",
      folder: "chapter",
      entry_count: 1,
    });
  });
});
