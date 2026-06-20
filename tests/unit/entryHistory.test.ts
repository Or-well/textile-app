import { describe, expect, it } from "vitest";
import type { Entry, ProjectEvent } from "../../src/model/types";
import {
  restoreEntryVersion,
  saveEntry,
  setEntriesProjectStorage,
} from "../../src/services/entries";
import {
  isEntryVersionEvent,
} from "../../src/services/history";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createEntry, createMember } from "./factories";
import { FailingProjectStorage } from "./failingProjectStorage";

async function createEntryStorage(entryOverrides: Partial<Entry> = {}) {
  const entry = createEntry({
    id: "file-1:1",
    file_id: "file-1",
    index: 1,
    target: "Original",
    status: "translated",
    translated_by: "translator-1",
    ...entryOverrides,
  });
  const root = createMemoryProjectDirectory(
    {
      "logs/events.jsonl": "\n",
    },
    "entry-history.hproj",
  );
  const storage = createProjectStorage(root);

  await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [entry]);

  return { storage, entry };
}

describe("entry version history", () => {
  it("records target changes with before and after snapshots", async () => {
    const { storage, entry } = await createEntryStorage();
    const actor = createMember(["owner"], { id: "owner-1" });

    setEntriesProjectStorage(storage);

    const saved = await saveEntry(
      {
        ...entry,
        target: "Changed",
      },
      { actor },
    );
    const events = await storage.readJsonl<ProjectEvent>("logs/events.jsonl");

    expect(saved.target).toBe("Changed");
    expect(events).toHaveLength(1);
    expect(isEntryVersionEvent(events[0]!)).toBe(true);
    expect(events[0]).toMatchObject({
      type: "entry.updated",
      entry_id: entry.id,
      file_id: entry.file_id,
      user_id: actor.id,
      detail: {
        before_target: "Original",
        after_target: "Changed",
        before_status: "translated",
        after_status: "translated",
      },
    });
  });

  it("does not create a history event for an unchanged save", async () => {
    const { storage, entry } = await createEntryStorage();
    const actor = createMember(["owner"], { id: "owner-1" });

    setEntriesProjectStorage(storage);
    await saveEntry(entry, { actor });

    await expect(
      storage.readJsonl("logs/events.jsonl"),
    ).resolves.toEqual([]);
  });

  it("rolls back the entry when the history log write fails", async () => {
    const { storage: baseStorage, entry } = await createEntryStorage();
    const storage = new FailingProjectStorage(baseStorage, 2);
    const actor = createMember(["owner"], { id: "owner-1" });

    setEntriesProjectStorage(storage);

    await expect(
      saveEntry(
        {
          ...entry,
          target: "Changed",
        },
        { actor },
      ),
    ).rejects.toThrow("已尝试恢复原数据");
    await expect(
      baseStorage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([{ target: "Original" }]);
    await expect(
      baseStorage.readJsonl("logs/events.jsonl"),
    ).resolves.toEqual([]);
  });

  it("restores a version as a new event and resets downstream workflow", async () => {
    const { storage, entry } = await createEntryStorage();
    const actor = createMember(["owner"], { id: "owner-1" });

    setEntriesProjectStorage(storage);

    const firstSaved = await saveEntry(
      {
        ...entry,
        target: "First version",
      },
      { actor },
    );
    await saveEntry(
      {
        ...firstSaved,
        target: "Reviewed version",
      },
      { actor },
    );
    const [currentEntry] = await storage.readJsonl<Entry>(
      "entries/file-1/chunk_0001.jsonl",
    );

    await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
      {
        ...currentEntry!,
        status: "reviewed",
        proofread_by: ["proofreader-1"],
        proofread_count: 1,
        reviewed_by: "reviewer-1",
        disputed: true,
      },
    ]);

    const beforeRestoreEvents = await storage.readJsonl<ProjectEvent>(
      "logs/events.jsonl",
    );
    const firstVersionEvent = beforeRestoreEvents.find(
      (event) =>
        isEntryVersionEvent(event) &&
        event.detail.after_target === "First version",
    );

    expect(firstVersionEvent).toBeDefined();

    const restored = await restoreEntryVersion(
      entry.id,
      firstVersionEvent!.id,
      { actor },
    );
    const events = await storage.readJsonl<ProjectEvent>("logs/events.jsonl");
    const restoreEvent = events.at(-1);

    expect(restored).toMatchObject({
      target: "First version",
      status: "translated",
      translated_by: actor.id,
      proofread_by: [],
      proofread_count: 0,
      reviewed_by: "",
      disputed: true,
      updated_by: actor.id,
    });
    expect(restoreEvent).toMatchObject({
      type: "entry.restored",
      detail: {
        before_target: "Reviewed version",
        after_target: "First version",
        restored_from_event_id: firstVersionEvent!.id,
        restored_from_snapshot: "after",
      },
    });
  });

  it("can restore the version from before the first recorded edit", async () => {
    const { storage, entry } = await createEntryStorage();
    const actor = createMember(["owner"], { id: "owner-1" });

    setEntriesProjectStorage(storage);
    await saveEntry({ ...entry, target: "Changed" }, { actor });
    const [versionEvent] = await storage.readJsonl<ProjectEvent>(
      "logs/events.jsonl",
    );

    const restored = await restoreEntryVersion(entry.id, versionEvent!.id, {
      actor,
      snapshot: "before",
    });

    expect(restored.target).toBe("Original");
    await expect(
      storage.readJsonl<ProjectEvent>("logs/events.jsonl"),
    ).resolves.toMatchObject([
      {},
      {
        type: "entry.restored",
        detail: {
          after_target: "Original",
          restored_from_event_id: versionEvent!.id,
          restored_from_snapshot: "before",
        },
      },
    ]);
  });

  it("rolls back a restore when the history log write fails", async () => {
    const { storage: baseStorage, entry } = await createEntryStorage();
    const actor = createMember(["owner"], { id: "owner-1" });

    setEntriesProjectStorage(baseStorage);
    await saveEntry({ ...entry, target: "Changed" }, { actor });
    const [versionEvent] = await baseStorage.readJsonl<ProjectEvent>(
      "logs/events.jsonl",
    );
    const storage = new FailingProjectStorage(baseStorage, 2);

    setEntriesProjectStorage(storage);

    await expect(
      restoreEntryVersion(entry.id, versionEvent!.id, {
        actor,
        snapshot: "before",
      }),
    ).rejects.toThrow("已尝试恢复原数据");
    await expect(
      baseStorage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([{ target: "Changed" }]);
    await expect(
      baseStorage.readJsonl<ProjectEvent>("logs/events.jsonl"),
    ).resolves.toHaveLength(1);
  });

  it("rejects restoration without edit or translate permission", async () => {
    const { storage, entry } = await createEntryStorage();
    const owner = createMember(["owner"], { id: "owner-1" });
    const readonly = createMember(["readonly"], { id: "reader-1" });

    setEntriesProjectStorage(storage);
    await saveEntry({ ...entry, target: "Changed" }, { actor: owner });
    const [versionEvent] = await storage.readJsonl<ProjectEvent>(
      "logs/events.jsonl",
    );

    await expect(
      restoreEntryVersion(entry.id, versionEvent!.id, { actor: readonly }),
    ).rejects.toThrow("没有恢复译文历史版本的权限");
  });

  it("does not treat legacy audit events as restorable versions", async () => {
    const { storage, entry } = await createEntryStorage();
    const actor = createMember(["owner"], { id: "owner-1" });
    const legacyEvent: ProjectEvent = {
      id: "legacy-event",
      type: "entry.updated",
      user_id: actor.id,
      entry_id: entry.id,
      file_id: entry.file_id,
      created_at: "2026-01-01T00:00:00.000Z",
    };

    await storage.writeJsonl("logs/events.jsonl", [legacyEvent]);
    setEntriesProjectStorage(storage);

    await expect(
      restoreEntryVersion(entry.id, legacyEvent.id, { actor }),
    ).rejects.toThrow("没有找到可恢复的译文历史版本");
  });
});
