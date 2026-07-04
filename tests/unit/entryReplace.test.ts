import { describe, expect, it } from "vitest";
import type { Entry, ProjectEvent, Task } from "../../src/model/types";
import { setEntriesProjectStorage } from "../../src/services/entries";
import {
  executeEntryReplace,
  previewEntryReplace,
  setEntryReplaceProjectStorage,
} from "../../src/services/entryReplace";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { setPermissionProject } from "../../src/services/permissions";
import { createProjectStorage } from "../../src/services/projectStorage";
import { setTasksProjectStorage } from "../../src/services/tasks";
import { createEntry, createMember, createProject } from "./factories";

async function createReplaceStorage(
  entriesByFile: Record<string, Entry[]>,
  tasks: Task[] = [],
) {
  const root = createMemoryProjectDirectory(
    {
      "logs/events.jsonl": "\n",
      "tasks/tasks.jsonl": "\n",
    },
    "entry-replace.hproj",
  );
  const storage = createProjectStorage(root);

  for (const [fileId, entries] of Object.entries(entriesByFile)) {
    await storage.writeJsonl(`entries/${fileId}/chunk_0001.jsonl`, entries);
  }

  await storage.writeJsonl("tasks/tasks.jsonl", tasks);

  return storage;
}

function configureReplaceServices(
  storage: ReturnType<typeof createProjectStorage>,
  project: ReturnType<typeof createProject>,
) {
  setEntriesProjectStorage(storage);
  setEntryReplaceProjectStorage(storage);
  setTasksProjectStorage(storage);
  setPermissionProject(project);
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    type: "translate",
    title: "Translate",
    description: "",
    file_id: "file-1",
    range_start: 1,
    range_end: 1,
    entry_ids: [],
    assignee: "translator-1",
    status: "in_progress",
    target: "",
    submit_method: "change_package",
    created_by: "owner-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    due_at: "",
    ...overrides,
  };
}

describe("entry replace", () => {
  it("replaces target text while preserving workflow status and audit fields", async () => {
    const reviewed = createEntry({
      id: "file-1:1",
      file_id: "file-1",
      index: 1,
      target: "Alice uses old term.",
      status: "reviewed",
      translated_by: "translator-1",
      proofread_by: ["proofreader-1"],
      proofread_count: 1,
      reviewed_by: "reviewer-1",
    });
    const proofread = createEntry({
      id: "file-1:2",
      file_id: "file-1",
      index: 2,
      target: "Another old term.",
      status: "proofread",
      translated_by: "translator-1",
      proofread_by: ["proofreader-1"],
      proofread_count: 1,
    });
    const storage = await createReplaceStorage({ "file-1": [reviewed, proofread] });
    const project = createProject({
      files: [
        {
          id: "file-1",
          name: "File",
          source_path: "source/file-1.json",
          entries_path: "entries/file-1",
          type: "json",
          hidden: false,
          locked: false,
        },
      ],
      settings: {
        chunk_size: 500,
        auto_save: true,
        allow_change_package: true,
        workflow: { enable_tasks: false },
      },
    });

    configureReplaceServices(storage, project);
    await storage.writeJson("project.json", project);

    const result = await executeEntryReplace({
      entryIds: [reviewed.id, proofread.id],
      findText: "old term",
      replaceText: "new term",
      actor: createMember(["owner"], { id: "owner-1" }),
      project,
    });

    const [nextReviewed, nextProofread] = await storage.readJsonl<Entry>(
      "entries/file-1/chunk_0001.jsonl",
    );
    const events = await storage.readJsonl<ProjectEvent>("logs/events.jsonl");

    expect(result.updatedEntries).toHaveLength(2);
    expect(nextReviewed).toMatchObject({
      target: "Alice uses new term.",
      status: "reviewed",
      translated_by: "translator-1",
      proofread_by: ["proofreader-1"],
      proofread_count: 1,
      reviewed_by: "reviewer-1",
      updated_by: "owner-1",
    });
    expect(nextProofread).toMatchObject({
      target: "Another new term.",
      status: "proofread",
      translated_by: "translator-1",
      proofread_by: ["proofreader-1"],
      proofread_count: 1,
      updated_by: "owner-1",
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "entry.target_replaced",
      entry_id: reviewed.id,
      detail: {
        before_status: "reviewed",
        after_status: "reviewed",
        match_count: 1,
        preserve_workflow: true,
      },
    });
  });

  it("can skip proofread and reviewed entries by option", async () => {
    const translated = createEntry({
      id: "file-1:1",
      file_id: "file-1",
      index: 1,
      target: "old term",
      status: "translated",
    });
    const reviewed = createEntry({
      id: "file-1:2",
      file_id: "file-1",
      index: 2,
      target: "old term",
      status: "reviewed",
    });
    const storage = await createReplaceStorage({ "file-1": [translated, reviewed] });
    const project = createProject({
      files: [
        {
          id: "file-1",
          name: "File",
          source_path: "source/file-1.json",
          entries_path: "entries/file-1",
          type: "json",
          hidden: false,
          locked: false,
        },
      ],
      settings: {
        chunk_size: 500,
        auto_save: true,
        allow_change_package: true,
        workflow: { enable_tasks: false },
      },
    });

    configureReplaceServices(storage, project);
    await storage.writeJson("project.json", project);

    const preview = await previewEntryReplace({
      entryIds: [translated.id, reviewed.id],
      findText: "old",
      replaceText: "new",
      actor: createMember(["owner"], { id: "owner-1" }),
      project,
      skipReviewedAndProofread: true,
    });

    expect(preview.replacements.map((item) => item.entryId)).toEqual([
      translated.id,
    ]);
    expect(preview.skipped).toEqual([
      {
        entryId: reviewed.id,
        reason: "已校对或已审核词条已按选项跳过",
      },
    ]);
  });

  it("limits ordinary members to active tasks assigned to them", async () => {
    const first = createEntry({
      id: "file-1:1",
      file_id: "file-1",
      index: 1,
      target: "old",
      status: "translated",
      assignee: "translator-1",
    });
    const second = createEntry({
      id: "file-1:2",
      file_id: "file-1",
      index: 2,
      target: "old",
      status: "translated",
      assignee: "translator-1",
    });
    const storage = await createReplaceStorage({ "file-1": [first, second] }, [
      createTask(),
    ]);
    const project = createProject({
      files: [
        {
          id: "file-1",
          name: "File",
          source_path: "source/file-1.json",
          entries_path: "entries/file-1",
          type: "json",
          hidden: false,
          locked: false,
        },
      ],
      settings: {
        chunk_size: 500,
        auto_save: true,
        allow_change_package: true,
        workflow: { enable_tasks: true },
      },
    });

    configureReplaceServices(storage, project);
    await storage.writeJson("project.json", project);

    const preview = await previewEntryReplace({
      entryIds: [first.id, second.id],
      findText: "old",
      replaceText: "new",
      actor: createMember(["translator"], { id: "translator-1" }),
      project,
    });

    expect(preview.replacements.map((item) => item.entryId)).toEqual([
      first.id,
    ]);
    expect(preview.skipped).toEqual([
      {
        entryId: second.id,
        reason: "不在当前成员可编辑的已分配任务范围内",
      },
    ]);
  });

  it("rejects empty find text", async () => {
    const entry = createEntry({
      id: "file-1:1",
      file_id: "file-1",
      index: 1,
      target: "old",
      status: "translated",
    });
    const storage = await createReplaceStorage({ "file-1": [entry] });
    const project = createProject({
      settings: {
        chunk_size: 500,
        auto_save: true,
        allow_change_package: true,
        workflow: { enable_tasks: false },
      },
    });

    configureReplaceServices(storage, project);
    await storage.writeJson("project.json", project);

    await expect(
      previewEntryReplace({
        entryIds: [entry.id],
        findText: "",
        replaceText: "new",
        actor: createMember(["owner"], { id: "owner-1" }),
        project,
      }),
    ).rejects.toThrow("请输入要查找的内容");
  });
});
