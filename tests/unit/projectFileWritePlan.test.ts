import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "../../src/model/types";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import {
  deleteProjectFileFromStorage,
  updateSourceFileInStorage,
} from "../../src/services/project";
import {
  createProjectStorage,
  type ProjectStorage,
} from "../../src/services/projectStorage";
import { createEntry, createMember, createProject } from "./factories";
import { FailingProjectStorage } from "./failingProjectStorage";

async function createFileStorage(): Promise<{
  storage: ProjectStorage;
  config: ProjectConfig;
}> {
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
    "project-file-test.hproj",
  );
  const storage = createProjectStorage(root);

  await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
    createEntry({
      id: "file-1:1",
      file_id: "file-1",
      index: 1,
      key: "line_000001",
      source: "First",
      target: "第一",
      status: "translated",
    }),
  ]);
  await storage.writeJsonl("entries/file-1/chunk_0002.jsonl", [
    createEntry({
      id: "file-1:2",
      file_id: "file-1",
      index: 2,
      key: "line_000002",
      source: "Second",
      target: "第二",
      status: "translated",
    }),
  ]);

  return { storage, config };
}

describe("source file write plan", () => {
  it("commits source, chunks, and project config together", async () => {
    const { storage, config } = await createFileStorage();
    const actor = createMember(["owner"]);

    const result = await updateSourceFileInStorage(
      storage,
      config,
      "file-1",
      new File(["First changed"], "dialog.txt", { type: "text/plain" }),
      actor,
    );

    expect(result.entryCount).toBe(1);
    await expect(storage.readText("source/dialog.txt")).resolves.toBe(
      "First changed",
    );
    await expect(
      storage.readJsonl("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([
      {
        source: "First changed",
        target: "第一",
      },
    ]);
    await expect(
      storage.fileExists("entries/file-1/chunk_0002.jsonl"),
    ).resolves.toBe(false);
    await expect(storage.readJson("project.json")).resolves.toEqual(
      result.config,
    );
  });

  it("restores source, chunks, and project config when update fails", async () => {
    const { storage: baseStorage, config } = await createFileStorage();
    const storage = new FailingProjectStorage(baseStorage, 3);
    const actor = createMember(["owner"]);

    await expect(
      updateSourceFileInStorage(
        storage,
        config,
        "file-1",
        new File(["First changed"], "dialog.txt", { type: "text/plain" }),
        actor,
      ),
    ).rejects.toThrow("已尝试恢复原数据");

    await expect(baseStorage.readText("source/dialog.txt")).resolves.toBe(
      "First\nSecond",
    );
    await expect(
      baseStorage.readJsonl("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([{ source: "First", target: "第一" }]);
    await expect(
      baseStorage.readJsonl("entries/file-1/chunk_0002.jsonl"),
    ).resolves.toMatchObject([{ source: "Second", target: "第二" }]);
    await expect(baseStorage.readJson("project.json")).resolves.toEqual(config);
  });
});

describe("project file deletion plan", () => {
  it("commits source, entries, and project index deletion together", async () => {
    const { storage, config } = await createFileStorage();
    const actor = createMember(["owner"]);

    const result = await deleteProjectFileFromStorage(
      storage,
      config,
      "file-1",
      actor,
    );

    expect(result.files).toEqual([]);
    await expect(storage.fileExists("source/dialog.txt")).resolves.toBe(false);
    await expect(storage.fileExists("entries/file-1")).resolves.toBe(false);
    await expect(storage.readJson("project.json")).resolves.toEqual(result);
  });

  it("restores deleted source and chunks when deletion fails", async () => {
    const { storage: baseStorage, config } = await createFileStorage();
    const storage = new FailingProjectStorage(baseStorage, 4);
    const actor = createMember(["owner"]);

    await expect(
      deleteProjectFileFromStorage(storage, config, "file-1", actor),
    ).rejects.toThrow("已尝试恢复原数据");

    await expect(baseStorage.readText("source/dialog.txt")).resolves.toBe(
      "First\nSecond",
    );
    await expect(
      baseStorage.fileExists("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toBe(true);
    await expect(
      baseStorage.fileExists("entries/file-1/chunk_0002.jsonl"),
    ).resolves.toBe(true);
    await expect(baseStorage.readJson("project.json")).resolves.toEqual(config);
  });
});
