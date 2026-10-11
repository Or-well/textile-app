import { afterEach, describe, expect, it } from "vitest";
import { saveEntry, setEntriesProjectStorage } from "../../src/services/entries";
import { previewEntryBatch, setEntryBatchProjectStorage } from "../../src/services/entryBatch";
import { executeEntryReplace, setEntryReplaceProjectStorage } from "../../src/services/entryReplace";
import { applyChangePackage, exportChangePackage, readChangePackage, setChangesProjectStorage } from "../../src/services/changes";
import { setCurrentUser, setPermissionProject } from "../../src/services/permissions";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { loadProjectFromStorage } from "../../src/services/project";
import { setTasksProjectStorage } from "../../src/services/tasks";
import { generateOwnSigningKey } from "../../src/services/keyManager";
import { exportProject, setExporterProjectStorage } from "../../src/services/exporter";
import { ensureWorkspaceBaseline } from "../../src/services/workspaceBaseline";
import type { Entry, Task } from "../../src/model/types";
import { createEntry, createMember, createProject } from "./factories";

async function fixture(actor = createMember(["translator"], { id: "member-1" })) {
  const project = createProject({ files: [{
    id: "file-1", name: "File", source_path: "source/file.txt",
    entries_path: "entries/file-1", type: "txt", hidden: false, locked: false,
  }], settings: { workflow: { enable_tasks: true }, collaboration: { require_signed_change_packages: false } } });
  const entry = createEntry({ id: "file-1:1", index: 1, target: "Original", status: "translated", translated_by: "translator-original" });
  const root = createMemoryProjectDirectory({
    "project.json": JSON.stringify(project),
    "members.json": JSON.stringify({ schema_version: 1, members: [actor] }),
    "logs/events.jsonl": "", "tasks/tasks.jsonl": "",
    "entries/file-1/chunk_0001.jsonl": `${JSON.stringify(entry)}\n`,
  }, "audit.hproj");
  const storage = createProjectStorage(root);
  setEntriesProjectStorage(storage);
  setEntryBatchProjectStorage(storage);
  setEntryReplaceProjectStorage(storage);
  setTasksProjectStorage(storage);
  setChangesProjectStorage(storage);
  setPermissionProject(project);
  setCurrentUser(actor);
  return { storage, project, entry, actor };
}

afterEach(() => { setCurrentUser(null); setPermissionProject(undefined); });

describe("collaboration edit and submission consistency", () => {
  it("allows local single and batch editing outside tasks while exports remain scoped", async () => {
    const { storage, project, entry, actor } = await fixture();
    expect((await previewEntryBatch({ project, actor, entryIds: [entry.id], operation: "set_disputed" })).applicableEntryIds)
      .toEqual([entry.id]);
    await expect(saveEntry({ ...entry, target: "Changed" }, { actor, workflow: project.settings.workflow }))
      .resolves.toMatchObject({ target: "Changed" });
    await expect(exportChangePackage(actor.id, { actor, mode: "member_changes", sign: false }))
      .rejects.toThrow("没有可提交的修改");
    expect((await storage.readJsonl("entries/file-1/chunk_0001.jsonl"))[0]).toMatchObject({ target: "Changed" });
  });

  it("rejects proofread using stale caller settings after the project disables it", async () => {
    const { storage, project, entry, actor } = await fixture(createMember(["owner"]));
    project.settings.workflow = { enable_tasks: false, proofread_required: 0 };
    await storage.writeJson("project.json", project);
    setPermissionProject(project);
    const staleWorkflow = { enable_tasks: false, proofread_required: 1 as const };
    expect((await previewEntryBatch({ project, actor, entryIds: [entry.id], operation: "set_proofread" })).skipped)
      .toMatchObject([{ reason: "当前项目未启用校对流程。" }]);
    await expect(saveEntry({ ...entry, status: "proofread", proofread_by: [actor.id], proofread_count: 1 }, { actor, workflow: staleWorkflow }))
      .rejects.toThrow("未启用校对");
    expect((await storage.readJsonl("entries/file-1/chunk_0001.jsonl"))[0]).toMatchObject({ status: "translated" });
    expect(await storage.readJsonl("logs/events.jsonl")).toEqual([]);
  });

  it("exports and imports unsigned manager work outside assigned tasks", async () => {
    const { entry, actor } = await fixture(createMember(["owner"]));
    await saveEntry({ ...entry, target: "Manager work" }, { actor });
    const exported = await exportChangePackage(actor.id, { actor, mode: "member_changes", sign: false });
    const pkg = await readChangePackage(new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob);
    const receiver = await fixture(actor);
    await expect(applyChangePackage(pkg, [], { actor })).resolves.toMatchObject({ appliedEntries: 1 });
    expect(await receiver.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"))
      .toMatchObject([{ target: "Manager work" }]);
  });

  it.each(["legacy", "baseline"])(
    "does not include other members' tasks in ordinary member submissions when tasks are disabled in a %s workspace",
    async (workspace) => {
      const { storage, project, entry, actor } = await fixture();
      project.settings.workflow = { enable_tasks: false };
      await storage.writeJson("project.json", project);
      const task: Task = {
        id: "other-task", type: "translate", title: "Other member", description: "",
        file_id: entry.file_id, range_start: 1, range_end: 1, entry_ids: [],
        assignee: "another-member", status: "assigned", target: "", submit_method: "change_package",
        created_by: actor.id, created_at: entry.updated_at, updated_at: entry.updated_at, due_at: "",
      };
      await storage.writeJsonl("tasks/tasks.jsonl", [task]);
      if (workspace === "baseline") await ensureWorkspaceBaseline(storage, project);
      await storage.writeJsonl("tasks/tasks.jsonl", [{ ...task, status: "in_progress" }]);
      await saveEntry({ ...entry, target: "Member work" }, { actor });
      const exported = await exportChangePackage(actor.id, { actor, mode: "member_changes", sign: false });
      const pkg = await readChangePackage(new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob);
      expect(Object.values(pkg.tasks).flat()).toEqual([]);
      expect(Object.values(pkg.base?.tasks ?? {}).flat()).toEqual([]);
      const owner = createMember(["owner"], { id: "owner-1" });
      await storage.writeJson("members.json", { schema_version: 1, members: [actor, owner] });
      await expect(applyChangePackage(pkg, [], { actor: owner })).resolves.toMatchObject({ importedTasks: 0 });
    },
  );

  it("uses the current proofread requirement when the caller has an older one", async () => {
    const { storage, project, entry, actor } = await fixture(createMember(["proofreader"]));
    project.settings.workflow = { proofread_required: 2 };
    await storage.writeJson("project.json", project);
    const saved = await saveEntry({
      ...entry, status: "proofread", proofread_by: [actor.id], proofread_count: 1,
    }, { actor, workflow: { proofread_required: 1 } });
    expect(saved).toMatchObject({ status: "translated", proofread_count: 1 });
    expect(await storage.readJsonl("logs/events.jsonl"))
      .toMatchObject([{ detail: { after_status: "translated", after_proofread_count: 1 } }]);
  });

  it("saves and exports an old project without persisted settings using the project defaults", async () => {
    const { storage, project, entry, actor } = await fixture(createMember(["owner"]));
    const { settings: _settings, ...legacyProject } = project;
    await storage.writeJson("project.json", legacyProject);
    const loaded = await loadProjectFromStorage(storage);
    expect(loaded.settings.chunk_size).toBe(500);
    await expect(saveEntry({ ...entry, target: "Legacy edit" }, { actor }))
      .resolves.toMatchObject({ target: "Legacy edit", status: "translated" });
    await expect(exportChangePackage(actor.id, { actor, mode: "member_changes", sign: false }))
      .resolves.toMatchObject({ signature: undefined });
    setExporterProjectStorage(storage);
    await expect(exportProject()).resolves.toMatchObject({ summary: { exportEntries: 1 } });
  });

  it("rejects review after the project disables it despite stale caller settings", async () => {
    const { storage, project, entry, actor } = await fixture(createMember(["reviewer"]));
    const proofreadEntry = { ...entry, status: "proofread" as const, proofread_by: ["another-member"], proofread_count: 1 };
    await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [proofreadEntry]);
    project.settings.workflow = { proofread_required: 1, review_required: false };
    await storage.writeJson("project.json", project);
    await expect(saveEntry({ ...proofreadEntry, status: "reviewed", reviewed_by: actor.id }, {
      actor, workflow: { proofread_required: 1, review_required: true },
    })).rejects.toThrow("未启用审核");
    expect(await storage.readJsonl("entries/file-1/chunk_0001.jsonl"))
      .toMatchObject([{ status: "proofread", reviewed_by: "" }]);
    expect(await storage.readJsonl("logs/events.jsonl")).toEqual([]);
  });

  it("exports and imports signed manager work outside assigned tasks", async () => {
    const { storage, entry, actor } = await fixture(createMember(["owner"]));
    const signingActor = (await generateOwnSigningKey(storage.root, [actor], actor)).member;
    await saveEntry({ ...entry, target: "Manager work" }, { actor: signingActor });
    const exported = await exportChangePackage(actor.id, { actor: signingActor, mode: "member_changes", sign: true });
    const pkg = await readChangePackage(new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob);
    expect(Object.values(pkg.entries).flat()).toMatchObject([{ target: "Manager work" }]);
    const receiver = await fixture(signingActor);
    await expect(applyChangePackage(pkg, [], { actor: signingActor }))
      .resolves.toMatchObject({ appliedEntries: 1 });
    expect(await receiver.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"))
      .toMatchObject([{ target: "Manager work" }]);
  });

  it.each(["legacy", "baseline"])(
    "keeps task-external local replacements out of submissions in a %s workspace",
    async (workspace) => {
      const { storage, project, entry, actor } = await fixture();
      const outsideEntry = createEntry({ ...entry, id: "file-1:2", index: 2 });
      const task: Task = {
        id: "task-1", type: "translate", title: "Own scope", description: "",
        file_id: entry.file_id, range_start: 1, range_end: 1, entry_ids: [],
        assignee: actor.id, status: "submitted", target: "", submit_method: "change_package",
        created_by: "owner-1", created_at: entry.updated_at, updated_at: entry.updated_at, due_at: "",
      };
      await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [entry, outsideEntry]);
      await storage.writeJsonl("tasks/tasks.jsonl", [task]);
      if (workspace === "baseline") await ensureWorkspaceBaseline(storage, project);
      const replaced = await executeEntryReplace({
        actor, project, entryIds: [entry.id, outsideEntry.id], findText: "Original", replaceText: "Changed",
      });
      expect(replaced.updatedEntries.map((row) => row.id)).toEqual([entry.id, outsideEntry.id]);
      const exported = await exportChangePackage(actor.id, { actor, mode: "member_changes", sign: false });
      const pkg = await readChangePackage(new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob);
      expect(Object.values(pkg.entries).flat()).toMatchObject([{ id: entry.id, target: "Changed" }]);

      const receiver = await fixture(actor);
      await receiver.storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [entry, outsideEntry]);
      await receiver.storage.writeJsonl("tasks/tasks.jsonl", [task]);
      if (workspace === "baseline") await ensureWorkspaceBaseline(receiver.storage, receiver.project);
      const owner = createMember(["owner"], { id: "owner-1" });
      await receiver.storage.writeJson("members.json", { schema_version: 1, members: [actor, owner] });
      await expect(applyChangePackage(pkg, [{ entryId: entry.id, action: "use_package" }], { actor: owner }))
        .resolves.toMatchObject({ appliedEntries: 1 });
      expect(await receiver.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"))
        .toMatchObject([{ id: entry.id, target: "Changed" }, { id: outsideEntry.id, target: "Original" }]);
    },
  );
});
