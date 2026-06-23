import { describe, expect, it } from "vitest";
import type { ProjectConfig, ProjectFile } from "../../src/model/types";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import {
  createProjectStorage,
  type ProjectStorage,
} from "../../src/services/projectStorage";
import {
  executeFileBatchFromStorage,
  previewFileBatchFromStorage,
} from "../../src/services/fileBatch";
import { createEntry, createMember, createProject } from "./factories";
import { FailingProjectStorage } from "./failingProjectStorage";

function createFile(
  id: string,
  overrides: Partial<ProjectFile> = {},
): ProjectFile {
  return {
    id,
    name: `${id}.txt`,
    source_path: `source/${id}.txt`,
    entries_path: `entries/${id}`,
    type: "txt",
    hidden: false,
    locked: false,
    ...overrides,
  };
}

async function createFileBatchStorage(): Promise<{
  storage: ProjectStorage;
  project: ProjectConfig;
}> {
  const project = createProject({
    files: [
      createFile("file-1", { source_path: "source/shared.txt" }),
      createFile("file-2", { source_path: "source/shared.txt" }),
      createFile("file-3"),
    ],
  });
  const root = createMemoryProjectDirectory(
    {
      "project.json": `${JSON.stringify(project, null, 2)}\n`,
      "source/shared.txt": "Shared",
      "source/file-3.txt": "Third",
    },
    "file-batch.hproj",
  );
  const storage = createProjectStorage(root);

  for (const file of project.files) {
    await storage.writeJsonl(`${file.entries_path}/chunk_0001.jsonl`, [
      createEntry({
        id: `${file.id}:1`,
        file_id: file.id,
        index: 1,
      }),
    ]);
  }

  return { storage, project };
}

describe("file batch", () => {
  it("previews no-op and missing files", async () => {
    const { storage, project } = await createFileBatchStorage();
    const actor = createMember(["owner"]);

    const preview = await previewFileBatchFromStorage(storage, {
      fileIds: ["file-1", "missing"],
      operation: "unhide",
      actor,
      project,
    });

    expect(preview.applicableFileIds).toEqual([]);
    expect(preview.skippedReasonCounts).toEqual([
      { reason: "文件已经显示", count: 1 },
      { reason: "文件不存在或已被删除", count: 1 },
    ]);
  });

  it("updates multiple files and appends one event per file", async () => {
    const { storage, project } = await createFileBatchStorage();
    const actor = createMember(["owner"]);

    const result = await executeFileBatchFromStorage(storage, {
      fileIds: ["file-1", "file-2"],
      operation: "lock",
      actor,
      project,
    });

    expect(
      result.project.files
        .filter((file) => file.id !== "file-3")
        .every((file) => file.locked),
    ).toBe(true);
    expect(await storage.readJsonl("logs/events.jsonl")).toHaveLength(2);
  });

  it("normalizes group names and merges files into an existing group", async () => {
    const { storage, project } = await createFileBatchStorage();
    const actor = createMember(["owner"]);
    const groupedProject: ProjectConfig = {
      ...project,
      files: project.files.map((file) =>
        file.id === "file-1"
          ? { ...file, folder: " Main " }
          : file.id === "file-2"
            ? { ...file, folder: "Side" }
            : file,
      ),
    };

    await storage.writeJson("project.json", groupedProject);

    const noOpPreview = await previewFileBatchFromStorage(storage, {
      fileIds: ["file-1"],
      operation: "move_folder",
      actor,
      project: groupedProject,
      folder: "Main",
    });
    const result = await executeFileBatchFromStorage(storage, {
      fileIds: ["file-2"],
      operation: "move_folder",
      actor,
      project: groupedProject,
      folder: " Main ",
    });

    expect(noOpPreview.applicableFileIds).toEqual([]);
    expect(noOpPreview.skippedReasonCounts).toEqual([
      { reason: "文件已经在指定分组", count: 1 },
    ]);
    expect(
      result.project.files.find((file) => file.id === "file-2")?.folder,
    ).toBe("Main");
  });

  it("keeps a shared source while another file still references it", async () => {
    const { storage, project } = await createFileBatchStorage();
    const actor = createMember(["owner"]);

    await executeFileBatchFromStorage(storage, {
      fileIds: ["file-1"],
      operation: "delete",
      actor,
      project,
    });

    await expect(storage.readText("source/shared.txt")).resolves.toBe("Shared");
    await expect(storage.fileExists("entries/file-1")).resolves.toBe(false);
  });

  it("keeps a shared entries directory while another file still references it", async () => {
    const { storage, project } = await createFileBatchStorage();
    const actor = createMember(["owner"]);
    const sharedEntriesProject: ProjectConfig = {
      ...project,
      files: project.files.map((file) =>
        file.id === "file-2"
          ? { ...file, entries_path: "entries/file-1" }
          : file,
      ),
    };

    await storage.writeJson("project.json", sharedEntriesProject);

    const preview = await previewFileBatchFromStorage(storage, {
      fileIds: ["file-1"],
      operation: "delete",
      actor,
      project: sharedEntriesProject,
    });
    await executeFileBatchFromStorage(storage, {
      fileIds: ["file-1"],
      operation: "delete",
      actor,
      project: sharedEntriesProject,
    });

    expect(preview.affectedEntryCount).toBe(0);
    await expect(storage.fileExists("entries/file-1")).resolves.toBe(true);
  });

  it("deletes shared source once when all referencing files are selected", async () => {
    const { storage, project } = await createFileBatchStorage();
    const actor = createMember(["owner"]);

    const result = await executeFileBatchFromStorage(storage, {
      fileIds: ["file-1", "file-2"],
      operation: "delete",
      actor,
      project,
    });

    expect(result.project.files.map((file) => file.id)).toEqual(["file-3"]);
    await expect(storage.fileExists("source/shared.txt")).resolves.toBe(false);
  });

  it("restores all files when a batch deletion write fails", async () => {
    const { storage: baseStorage, project } = await createFileBatchStorage();
    const actor = createMember(["owner"]);
    const storage = new FailingProjectStorage(baseStorage, 4);

    await expect(
      executeFileBatchFromStorage(storage, {
        fileIds: ["file-1", "file-2"],
        operation: "delete",
        actor,
        project,
      }),
    ).rejects.toThrow("已尝试恢复原数据");

    await expect(baseStorage.fileExists("source/shared.txt")).resolves.toBe(true);
    await expect(baseStorage.fileExists("entries/file-1")).resolves.toBe(true);
    await expect(baseStorage.fileExists("entries/file-2")).resolves.toBe(true);
    await expect(baseStorage.readJson("project.json")).resolves.toEqual(project);
  });

  it("keeps file permission enforcement in the service", async () => {
    const { storage, project } = await createFileBatchStorage();
    const actor = createMember(["readonly"]);

    await expect(
      previewFileBatchFromStorage(storage, {
        fileIds: ["file-1"],
        operation: "lock",
        actor,
        project,
      }),
    ).rejects.toThrow("当前成员没有执行此操作的权限");
  });
});
