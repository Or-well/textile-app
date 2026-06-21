import { afterEach, describe, expect, it } from "vitest";
import type { Entry, ProjectEvent } from "../../src/model/types";
import {
  saveEntry,
  setEntriesProjectStorage,
  updateEntryAccess,
  updateEntryContext,
} from "../../src/services/entries";
import { setCurrentUser } from "../../src/services/permissions";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createEntry, createMember, createProject } from "./factories";

async function createStorage(options: {
  fileLocked?: boolean;
  fileHidden?: boolean;
  entry?: Entry;
} = {}) {
  const entry =
    options.entry ??
    createEntry({
      id: "file-1:1",
      file_id: "file-1",
      index: 1,
      target: "Original",
      status: "translated",
    });
  const root = createMemoryProjectDirectory(
    {
      "project.json": JSON.stringify(
        createProject({
          files: [
            {
              id: "file-1",
              name: "File",
              source_path: "source/file.txt",
              entries_path: "entries/file-1",
              type: "txt",
              hidden: options.fileHidden ?? false,
              locked: options.fileLocked ?? false,
            },
          ],
        }),
      ),
      "logs/events.jsonl": "\n",
    },
    "entry-access.hproj",
  );
  const storage = createProjectStorage(root);

  await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [entry]);
  setEntriesProjectStorage(storage);

  return { storage, entry };
}

describe("entry access", () => {
  afterEach(() => {
    setCurrentUser(null);
  });

  it("blocks entry saves when the containing file is locked", async () => {
    const { entry } = await createStorage({ fileLocked: true });
    const actor = createMember(["owner"], { id: "owner-1" });

    await expect(
      saveEntry({ ...entry, target: "Changed" }, { actor }),
    ).rejects.toThrow("所属文件已锁定");
  });

  it("updates entry lock state and appends an audit event atomically", async () => {
    const { storage, entry } = await createStorage();
    const actor = createMember(["owner"], { id: "owner-1" });

    await expect(updateEntryAccess(entry.id, { locked: true }, actor)).resolves.toMatchObject({
      locked: true,
      updated_by: actor.id,
    });
    await expect(
      storage.readJsonl<ProjectEvent>("logs/events.jsonl"),
    ).resolves.toEqual([
      expect.objectContaining({
        type: "entry.access_updated",
        user_id: actor.id,
        entry_id: entry.id,
        detail: expect.objectContaining({
          before_locked: false,
          after_locked: true,
        }),
      }),
    ]);
  });

  it("blocks context changes when the containing file is hidden", async () => {
    const { entry } = await createStorage({ fileHidden: true });
    const actor = createMember(["owner"], { id: "owner-1" });

    setCurrentUser(actor);

    await expect(
      updateEntryContext(entry.id, "Context", actor.id),
    ).rejects.toThrow("所属文件已隐藏");
  });

  it("rejects entry access changes without management permission", async () => {
    const { entry } = await createStorage();
    const actor = createMember(["translator"], { id: "translator-1" });

    await expect(
      updateEntryAccess(entry.id, { hidden: true }, actor),
    ).rejects.toThrow("没有执行此操作的权限");
  });
});
