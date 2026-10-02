import { describe, expect, it, vi } from "vitest";
import type { Entry } from "../../src/model/types";
import {
  cacheEntriesForFile,
  clearCachedEntriesForFile,
  loadEntries,
  loadEntriesFresh,
  saveEntry,
  setEntriesProjectStorage,
  writeEntriesForFile,
  writeEntriesForFileToStorage,
} from "../../src/services/entries";
import { getCachedEntryLocation } from "../../src/services/entryReadModel";
import { executeEntryReplace, setEntryReplaceProjectStorage } from "../../src/services/entryReplace";
import { executeEntryBatch, setEntryBatchProjectStorage } from "../../src/services/entryBatch";
import { loadDisputedEntries, markDisputed, setCommentsProjectStorage } from "../../src/services/comments";
import { createEntryVersionEvent, loadEntryWorkflowAudit, setHistoryProjectStorage } from "../../src/services/history";
import { loadProjectEventLogTail, planReplaceProjectEvents } from "../../src/services/eventLog";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createProjectWritePlan } from "../../src/services/projectWritePlan";
import { setCurrentUser, setPermissionProject } from "../../src/services/permissions";
import { createEntry, createMember, createProject } from "./factories";

async function fixture(count = 12) {
  const storage = createProjectStorage(createMemoryProjectDirectory({}));
  const actor = createMember(["owner"], { id: "owner-1" });
  const entries = Array.from({ length: count }, (_, index) => createEntry({
    id: `file-1:${String(index + 1).padStart(6, "0")}`,
    file_id: "file-1", index: index + 1, target: "old", status: "translated",
  }));
  const project = createProject({
    files: [{ id: "file-1", name: "file.txt", source_path: "source/file.txt", entries_path: "entries/file-1", type: "txt", hidden: false, locked: false }],
    settings: { chunk_size: 500, workflow: { enable_tasks: false }, auto_save: true, allow_change_package: true },
  });
  await storage.writeJson("project.json", project);
  for (const [index, entry] of entries.entries()) {
    await storage.writeJsonl(`entries/file-1/chunk_${String(index + 1).padStart(4, "0")}.jsonl`, [entry]);
  }
  await storage.writeJsonl("logs/events.jsonl", []);
  setEntriesProjectStorage(storage);
  setEntryReplaceProjectStorage(storage);
  setEntryBatchProjectStorage(storage);
  setCommentsProjectStorage(storage);
  setHistoryProjectStorage(storage);
  setPermissionProject(project);
  setCurrentUser(actor);
  return { storage, actor, entries, project };
}

describe("storage read/write regressions", () => {
  it("does not let an invalidated in-flight read replace a fresh snapshot", async () => {
    const { storage } = await fixture(1);
    const read = storage.readJsonl.bind(storage);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.spyOn(storage, "readJsonl").mockImplementationOnce(async (path) => {
      const rows = await read<Entry>(path);
      entered();
      await gate;
      return rows;
    });
    const old = loadEntries("file-1");
    await started;
    await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [createEntry({ id: "file-1:000001", file_id: "file-1", target: "fresh" })]);
    expect((await loadEntriesFresh("file-1"))[0]!.target).toBe("fresh");
    release();
    await old;
    expect((await loadEntries("file-1"))[0]!.target).toBe("fresh");
  });

  it("keeps a committed write when an older read finishes later", async () => {
    const { storage } = await fixture(1);
    const read = storage.readJsonl.bind(storage);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.spyOn(storage, "readJsonl").mockImplementationOnce(async (path) => {
      const rows = await read<Entry>(path);
      entered();
      await gate;
      return rows;
    });
    const old = loadEntries("file-1");
    await started;
    await writeEntriesForFile("file-1", [createEntry({ id: "file-1:000001", file_id: "file-1", target: "committed" })]);
    release();
    await old;
    expect((await loadEntries("file-1"))[0]!.target).toBe("committed");
  });

  it("preserves chunk positions when refreshing an unchanged file layout", async () => {
    const { storage, actor, entries } = await fixture();
    cacheEntriesForFile("file-1", await loadEntries("file-1"));
    const read = vi.spyOn(storage, "readJsonl");
    await saveEntry({ ...entries[11]!, target: "new" }, { actor });
    expect(read.mock.calls.filter(([path]) => path.startsWith("entries/"))).toEqual([["entries/file-1/chunk_0012.jsonl"]]);
  });

  it("does not change the current project cache when another project's write completes", async () => {
    const previous = await fixture(1);
    const current = await fixture(1);
    await loadEntries("file-1");
    const read = vi.spyOn(current.storage, "readJsonl");
    await writeEntriesForFileToStorage(previous.storage, "file-1", [{ ...previous.entries[0]!, target: "other project" }]);
    clearCachedEntriesForFile("file-1", previous.storage);
    expect((await loadEntries("file-1"))[0]!.target).toBe("old");
    expect(read).not.toHaveBeenCalled();
  });

  it("rebuilds chunk positions after rechunking", async () => {
    const { storage, actor, entries } = await fixture();
    await loadEntries("file-1");
    await writeEntriesForFile("file-1", entries, { chunkSize: 2 });
    expect(getCachedEntryLocation(entries[11]!.id)).toEqual({ chunkPath: "entries/file-1/chunk_0006.jsonl", rowIndex: 1 });
    const read = vi.spyOn(storage, "readJsonl");
    await saveEntry({ ...entries[11]!, target: "new" }, { actor });
    expect(read.mock.calls.filter(([path]) => path.startsWith("entries/"))).toHaveLength(1);
  });

  it("bounds chunk reads within a large file", async () => {
    const { storage } = await fixture(24);
    const read = storage.readJsonl.bind(storage);
    let active = 0;
    let peak = 0;
    vi.spyOn(storage, "readJsonl").mockImplementation(async (path) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      try { return await read(path); } finally { active--; }
    });
    expect(await loadEntries("file-1")).toHaveLength(24);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("reads sealed archives once across first edits of different entries", async () => {
    const { storage, actor, entries } = await fixture(2);
    for (let index = 1; index <= 8; index++) {
      await storage.writeJsonl(`logs/events/chunk_${String(index).padStart(6, "0")}.jsonl`, [{ id: `event-${index}`, type: "other", user_id: actor.id, created_at: "2020-01-01T00:00:00Z", detail: {} }]);
    }
    await loadEntries("file-1");
    const read = vi.spyOn(storage, "readJsonl");
    for (const entry of entries) await saveEntry({ ...entry, target: "new" }, { actor });
    expect(read.mock.calls.filter(([path]) => path.startsWith("logs/events/"))).toHaveLength(8);
  });

  it("keeps archived audits authoritative and invalidates them after log replacement", async () => {
    const { storage, entries } = await fixture(1);
    const entry = entries[0]!;
    const version = createEntryVersionEvent(entry, { ...entry, translated_by: "historical", proofread_by: ["proofreader"], proofread_count: 1 }, "owner-1");
    await storage.writeJsonl("logs/events/chunk_000001.jsonl", [version]);
    expect(await loadEntryWorkflowAudit(storage, entry, await loadProjectEventLogTail(storage))).toMatchObject({ translatedBy: "historical", proofreadCount: 1 });
    const plan = createProjectWritePlan(storage);
    await planReplaceProjectEvents(plan, storage, []);
    await plan.execute();
    expect(await loadEntryWorkflowAudit(storage, entry, await loadProjectEventLogTail(storage))).toMatchObject({ translatedBy: entry.translated_by, proofreadCount: entry.proofread_count });
  });

  it("coalesces archive indexing and handles newly sealed and legacy version events", async () => {
    const { storage, entries } = await fixture(1);
    const entry = entries[0]!;
    const version = createEntryVersionEvent(entry, { ...entry, translated_by: "", proofread_count: 1 }, "owner-1");
    await storage.writeJsonl("logs/events/chunk_000001.jsonl", [version]);
    const read = vi.spyOn(storage, "readJsonl");
    const tail = await loadProjectEventLogTail(storage);
    const audits = await Promise.all(Array.from({ length: 4 }, () => loadEntryWorkflowAudit(storage, entry, tail)));
    expect(audits.every((audit) => audit.translatedBy === "")).toBe(true);
    expect(read.mock.calls.filter(([path]) => path.startsWith("logs/events/"))).toHaveLength(1);
    const legacyVersion = createEntryVersionEvent(entry, { ...entry, proofread_count: 2 }, "owner-1");
    delete legacyVersion.detail.after_translated_by;
    await storage.writeJsonl("logs/events/chunk_000002.jsonl", [legacyVersion]);
    expect(await loadEntryWorkflowAudit(storage, entry, await loadProjectEventLogTail(storage))).toMatchObject({ translatedBy: entry.translated_by, proofreadCount: 2 });
    expect(read.mock.calls.filter(([path]) => path.startsWith("logs/events/"))).toHaveLength(2);
  });

  it("writes only the affected chunk for batch replace and subsequent workflow updates", async () => {
    const { storage, entries, actor, project } = await fixture();
    const write = vi.spyOn(storage, "writeBinary");
    await executeEntryReplace({ entryIds: [entries[11]!.id], findText: "old", replaceText: "new", actor, project });
    expect(write.mock.calls.filter(([path]) => path.startsWith("entries/")).map(([path]) => path)).toEqual(["entries/file-1/chunk_0012.jsonl"]);
    expect(await loadEntries("file-1")).toHaveLength(12);
    write.mockClear();
    const result = await executeEntryBatch({ entryIds: [entries[11]!.id], operation: "set_disputed", actor, project });
    expect(result.updatedEntries).toHaveLength(1);
    expect(write.mock.calls.filter(([path]) => path.startsWith("entries/")).map(([path]) => path)).toEqual(["entries/file-1/chunk_0012.jsonl"]);
  });

  it("reuses snapshots for disputed lists and reads one chunk for dispute updates", async () => {
    const { storage, entries } = await fixture();
    await loadEntries("file-1");
    const read = vi.spyOn(storage, "readJsonl");
    expect(await loadDisputedEntries()).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    await markDisputed(entries[11]!, "");
    expect(read.mock.calls.filter(([path]) => path.startsWith("entries/"))).toHaveLength(1);
    expect((await loadDisputedEntries()).map((entry) => entry.id)).toEqual([entries[11]!.id]);
  });

  it("retains read errors rather than hiding a damaged indexed chunk", async () => {
    const { storage, actor, entries } = await fixture();
    await loadEntries("file-1");
    await storage.writeText("entries/file-1/chunk_0012.jsonl", "broken json");
    await expect(saveEntry({ ...entries[11]!, target: "new" }, { actor })).rejects.toThrow("格式有问题");
    clearCachedEntriesForFile("file-1");
    await expect(loadEntries("file-1")).rejects.toThrow("无法读取");
    expect(await storage.readText("entries/file-1/chunk_0012.jsonl")).toBe("broken json");
  });
});
