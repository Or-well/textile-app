import { describe, expect, it } from "vitest";
import type { Entry, ProjectEvent } from "../../src/model/types";
import {
  restoreEntryVersion,
  saveEntry,
  setEntriesProjectStorage,
} from "../../src/services/entries";
import {
  deriveEntryWorkflowAudit,
  isEntryVersionEvent,
} from "../../src/services/history";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createEntry, createMember, createProject } from "./factories";
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
      "project.json": JSON.stringify(
        createProject({
          files: [
            {
              id: "file-1",
              name: "File",
              source_path: "source/file.txt",
              entries_path: "entries/file-1",
              type: "txt",
              hidden: false,
              locked: false,
            },
          ],
        }),
      ),
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

  it("resets proofread and review audit fields when target changes", async () => {
    const { storage, entry } = await createEntryStorage({
      status: "proofread",
      proofread_by: ["proofreader-1"],
      proofread_count: 1,
      reviewed_by: "",
    });
    const actor = createMember(["owner"], { id: "owner-1" });

    setEntriesProjectStorage(storage);

    await expect(
      saveEntry({ ...entry, target: "Changed" }, { actor }),
    ).resolves.toMatchObject({
      target: "Changed",
      status: "translated",
      translated_by: actor.id,
      proofread_by: [],
      proofread_count: 0,
      reviewed_by: "",
    });
  });

  it("requires reviewed entries to be rolled back before editing target", async () => {
    const { storage, entry } = await createEntryStorage({
      status: "reviewed",
      proofread_by: ["proofreader-1"],
      proofread_count: 1,
      reviewed_by: "reviewer-1",
    });
    const actor = createMember(["owner"], { id: "owner-1" });

    setEntriesProjectStorage(storage);

    await expect(
      saveEntry({ ...entry, target: "Changed" }, { actor }),
    ).rejects.toThrow("必须先退回校对");
    await expect(
      storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([{ target: "Original", status: "reviewed" }]);
  });

  it("ignores protected fields supplied through ordinary target save", async () => {
    const { storage, entry } = await createEntryStorage();
    const actor = createMember(["owner"], { id: "owner-1" });

    setEntriesProjectStorage(storage);

    await expect(
      saveEntry(
        {
          ...entry,
          target: "Changed",
          locked: true,
          hidden: true,
          assignee: "other-member",
        },
        { actor },
      ),
    ).resolves.toMatchObject({
      target: "Changed",
      locked: false,
      hidden: false,
      assignee: "",
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

  it("blocks review by the current proofread round first proofreader at the service boundary", async () => {
    const actor = createMember(["reviewer"], { id: "reviewer-1" });
    const { storage, entry } = await createEntryStorage({
      status: "proofread",
      translated_by: "translator-1",
      proofread_by: [actor.id, "proofreader-2"],
      proofread_count: 2,
    });

    setEntriesProjectStorage(storage);

    await expect(
      saveEntry(
        {
          ...entry,
          status: "reviewed",
          reviewed_by: actor.id,
        },
        {
          actor,
          workflow: {
            proofread_required: 2,
            review_required: true,
            allow_self_review: false,
          },
        },
      ),
    ).rejects.toThrow("首位校对者");
  });

  it("allows the translator to review when another member proofread last", async () => {
    const actor = createMember(["reviewer"], { id: "reviewer-1" });
    const { storage, entry } = await createEntryStorage({
      status: "proofread",
      translated_by: actor.id,
      proofread_by: ["proofreader-1"],
      proofread_count: 1,
    });

    setEntriesProjectStorage(storage);

    await expect(
      saveEntry(
        {
          ...entry,
          status: "reviewed",
          reviewed_by: actor.id,
        },
        {
          actor,
          workflow: {
            proofread_required: 1,
            review_required: true,
            allow_self_review: false,
          },
        },
      ),
    ).resolves.toMatchObject({
      status: "reviewed",
      translated_by: actor.id,
      proofread_by: ["proofreader-1"],
      reviewed_by: actor.id,
    });
  });

  it("treats a normal edit during partial proofread as a new translation", async () => {
    const { storage, entry } = await createEntryStorage({
      status: "translated",
      proofread_by: ["proofreader-1"],
      proofread_count: 1,
    });
    const actor = createMember(["owner"], { id: "owner-1" });

    setEntriesProjectStorage(storage);

    await expect(
      saveEntry(
        {
          ...entry,
          target: "Ordinary edit",
        },
        {
          actor,
          workflow: { proofread_required: 2 },
        },
      ),
    ).resolves.toMatchObject({
      target: "Ordinary edit",
      status: "translated",
      translated_by: actor.id,
      proofread_by: [],
      proofread_count: 0,
      reviewed_by: "",
    });
  });

  it("records proofread target edits without resetting workflow", async () => {
    const actor = createMember(["proofreader"], { id: "proofreader-1" });
    const { storage, entry } = await createEntryStorage();

    setEntriesProjectStorage(storage);

    const saved = await saveEntry(
      {
        ...entry,
        target: "Proofread edit",
        status: "proofread",
        proofread_by: [actor.id],
        proofread_count: 1,
      },
      {
        actor,
        workflow: { proofread_required: 1 },
      },
    );
    const events = await storage.readJsonl<ProjectEvent>("logs/events.jsonl");

    expect(saved).toMatchObject({
      target: "Proofread edit",
      status: "proofread",
      translated_by: "translator-1",
      proofread_by: [actor.id],
      proofread_count: 1,
      reviewed_by: "",
    });
    expect(events).toMatchObject([
      {
        type: "entry.updated",
        detail: {
          operation: "proofread",
          before_target: "Original",
          after_target: "Proofread edit",
          after_translated_by: "translator-1",
          after_proofread_by: [actor.id],
          after_proofread_count: 1,
        },
      },
    ]);
  });

  it("records review target edits without resetting proofread records", async () => {
    const actor = createMember(["reviewer"], { id: "reviewer-1" });
    const { storage, entry } = await createEntryStorage({
      status: "proofread",
      proofread_by: ["proofreader-1"],
      proofread_count: 1,
    });

    setEntriesProjectStorage(storage);

    const saved = await saveEntry(
      {
        ...entry,
        target: "Review edit",
        status: "reviewed",
        reviewed_by: actor.id,
      },
      {
        actor,
        workflow: {
          proofread_required: 1,
          review_required: true,
        },
      },
    );

    expect(saved).toMatchObject({
      target: "Review edit",
      status: "reviewed",
      translated_by: "translator-1",
      proofread_by: ["proofreader-1"],
      proofread_count: 1,
      reviewed_by: actor.id,
    });
    await expect(
      storage.readJsonl<ProjectEvent>("logs/events.jsonl"),
    ).resolves.toMatchObject([
      {
        detail: {
          operation: "review",
          after_proofread_by: ["proofreader-1"],
          after_reviewed_by: actor.id,
        },
      },
    ]);
  });

  it("records partial proofread progress even when the main status is unchanged", async () => {
    const actor = createMember(["proofreader"], { id: "proofreader-1" });
    const { storage, entry } = await createEntryStorage();

    setEntriesProjectStorage(storage);

    await saveEntry(
      {
        ...entry,
        status: "translated",
        proofread_by: [actor.id],
        proofread_count: 1,
      },
      {
        actor,
        workflow: { proofread_required: 2 },
      },
    );

    const events = await storage.readJsonl<ProjectEvent>("logs/events.jsonl");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      detail: {
        operation: "proofread",
        before_status: "translated",
        after_status: "translated",
        after_proofread_count: 1,
      },
    });
  });

  it("derives current audit fields from the matching latest history event", () => {
    const entry = createEntry({
      id: "entry-1",
      updated_at: "2026-02-01T00:00:00.000Z",
      translated_by: "stale-translator",
      proofread_by: [],
      proofread_count: 0,
    });
    const event: ProjectEvent = {
      id: "event-1",
      type: "entry.updated",
      user_id: "proofreader-1",
      entry_id: entry.id,
      file_id: entry.file_id,
      created_at: entry.updated_at,
      detail: {
        before_target: "Before",
        after_target: entry.target,
        before_status: "translated",
        after_status: "proofread",
        after_translated_by: "translator-1",
        after_proofread_by: ["proofreader-1"],
        after_proofread_count: 1,
        after_reviewed_by: "",
      },
    };

    expect(deriveEntryWorkflowAudit(entry, [event])).toEqual({
      translatedBy: "translator-1",
      proofreadBy: ["proofreader-1"],
      proofreadCount: 1,
      reviewedBy: "",
    });
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
        before_translated_by: actor.id,
        after_translated_by: actor.id,
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
    expect(restored.translated_by).toBe("translator-1");
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

  it("does not attribute legacy restored versions to the restorer", async () => {
    const { storage, entry } = await createEntryStorage();
    const actor = createMember(["owner"], { id: "owner-1" });
    const legacyVersionEvent: ProjectEvent = {
      id: "legacy-version-event",
      type: "entry.updated",
      user_id: "translator-1",
      entry_id: entry.id,
      file_id: entry.file_id,
      created_at: "2026-01-01T00:00:00.000Z",
      detail: {
        before_target: "Older",
        after_target: "Legacy version",
        before_status: "translated",
        after_status: "translated",
      },
    };

    await storage.writeJsonl("logs/events.jsonl", [legacyVersionEvent]);
    setEntriesProjectStorage(storage);

    const restored = await restoreEntryVersion(
      entry.id,
      legacyVersionEvent.id,
      { actor },
    );

    expect(restored.target).toBe("Legacy version");
    expect(restored.translated_by).toBe("");
    expect(restored.updated_by).toBe(actor.id);
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
