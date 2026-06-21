import { describe, expect, it } from "vitest";
import type { Entry, ProjectEvent, Task } from "../../src/model/types";
import {
  executeEntryBatch,
  previewEntryBatch,
  setEntryBatchProjectStorage,
} from "../../src/services/entryBatch";
import { setEntriesProjectStorage } from "../../src/services/entries";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { setPermissionProject } from "../../src/services/permissions";
import { createProjectStorage } from "../../src/services/projectStorage";
import { setTasksProjectStorage } from "../../src/services/tasks";
import { createEntry, createMember, createProject } from "./factories";
import { FailingProjectStorage } from "./failingProjectStorage";

async function createBatchStorage(entriesByFile: Record<string, Entry[]>, tasks: Task[] = []) {
  const root = createMemoryProjectDirectory(
    {
      "logs/events.jsonl": "\n",
      "tasks/tasks.jsonl": "\n",
    },
    "entry-batch.hproj",
  );
  const storage = createProjectStorage(root);

  for (const [fileId, entries] of Object.entries(entriesByFile)) {
    await storage.writeJsonl(`entries/${fileId}/chunk_0001.jsonl`, entries);
  }

  await storage.writeJsonl("tasks/tasks.jsonl", tasks);

  return storage;
}

function configureBatchServices(
  storage: ReturnType<typeof createProjectStorage>,
  project: ReturnType<typeof createProject>,
) {
  setEntriesProjectStorage(storage);
  setTasksProjectStorage(storage);
  setEntryBatchProjectStorage(storage);
  setPermissionProject(project);
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    type: "proofread",
    title: "Proofread",
    description: "",
    file_id: "file-1",
    range_start: 1,
    range_end: 1,
    entry_ids: [],
    assignee: "proofreader-1",
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

describe("entry batch workflow", () => {
  it("rejects a request for a different project", async () => {
    const entry = createEntry({
      id: "file-1:1",
      file_id: "file-1",
      index: 1,
      target: "One",
      status: "translated",
    });
    const storage = await createBatchStorage({ "file-1": [entry] });
    const storedProject = createProject({
      settings: {
        chunk_size: 500,
        auto_save: true,
        allow_change_package: true,
        workflow: { enable_tasks: false },
      },
    });
    const requestProject = createProject({ project_id: "project-2" });

    configureBatchServices(storage, storedProject);
    await storage.writeJson("project.json", storedProject);

    await expect(
      previewEntryBatch({
        entryIds: [entry.id],
        operation: "mark_disputed",
        actor: createMember(["owner"], { id: "owner-1" }),
        project: requestProject,
      }),
    ).rejects.toThrow("批量操作目标不一致");
  });

  it("limits ordinary members to active tasks assigned to them", async () => {
    const entries = [
      createEntry({
        id: "file-1:1",
        file_id: "file-1",
        index: 1,
        target: "One",
        status: "translated",
        translated_by: "translator-1",
      }),
      createEntry({
        id: "file-1:2",
        file_id: "file-1",
        index: 2,
        target: "Two",
        status: "translated",
        translated_by: "translator-1",
      }),
    ];
    const storage = await createBatchStorage(
      { "file-1": entries },
      [createTask()],
    );
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
        workflow: {
          enable_tasks: true,
          proofread_required: 1,
        },
      },
    });
    const actor = createMember(["proofreader"], { id: "proofreader-1" });

    configureBatchServices(storage, project);
    await storage.writeJson("project.json", project);

    const preview = await previewEntryBatch({
      entryIds: entries.map((entry) => entry.id),
      operation: "proofread",
      actor,
      project,
    });

    expect(preview.applicableEntryIds).toEqual(["file-1:1"]);
    expect(preview.skipped).toEqual([
      {
        entryId: "file-1:2",
        reason: "不在当前成员可编辑的已分配任务范围内",
      },
    ]);
  });

  it("commits multiple files and version events through one batch", async () => {
    const first = createEntry({
      id: "file-1:1",
      file_id: "file-1",
      index: 1,
      target: "One",
      status: "translated",
      translated_by: "translator-1",
    });
    const second = createEntry({
      id: "file-2:1",
      file_id: "file-2",
      index: 1,
      target: "Two",
      status: "translated",
      translated_by: "translator-2",
    });
    const storage = await createBatchStorage({
      "file-1": [first],
      "file-2": [second],
    });
    const project = createProject({
      files: [
        {
          id: "file-1",
          name: "First",
          source_path: "source/file-1.json",
          entries_path: "entries/file-1",
          type: "json",
          hidden: false,
          locked: false,
        },
        {
          id: "file-2",
          name: "Second",
          source_path: "source/file-2.json",
          entries_path: "entries/file-2",
          type: "json",
          hidden: false,
          locked: false,
        },
      ],
      settings: {
        chunk_size: 500,
        auto_save: true,
        allow_change_package: true,
        workflow: {
          enable_tasks: true,
          proofread_required: 1,
        },
      },
    });
    const actor = createMember(["owner"], { id: "owner-1" });

    configureBatchServices(storage, project);
    await storage.writeJson("project.json", project);

    const result = await executeEntryBatch({
      entryIds: [first.id, second.id],
      operation: "proofread",
      actor,
      project,
    });
    const firstRows = await storage.readJsonl<Entry>(
      "entries/file-1/chunk_0001.jsonl",
    );
    const secondRows = await storage.readJsonl<Entry>(
      "entries/file-2/chunk_0001.jsonl",
    );
    const events = await storage.readJsonl<ProjectEvent>("logs/events.jsonl");

    expect(result.updatedEntries).toHaveLength(2);
    expect(firstRows[0]).toMatchObject({
      status: "proofread",
      proofread_by: [actor.id],
      proofread_count: 1,
    });
    expect(secondRows[0]).toMatchObject({
      status: "proofread",
      proofread_by: [actor.id],
      proofread_count: 1,
    });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.detail?.batch_id)).toEqual([
      result.batchId,
      result.batchId,
    ]);
  });

  it("writes dispute notes, entry changes and events together", async () => {
    const entry = createEntry({
      id: "file-1:1",
      file_id: "file-1",
      index: 1,
      target: "One",
      status: "translated",
    });
    const storage = await createBatchStorage({ "file-1": [entry] });
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
    const actor = createMember(["translator"], { id: "translator-1" });

    configureBatchServices(storage, project);
    await storage.writeJson("project.json", project);

    await executeEntryBatch({
      entryIds: [entry.id],
      operation: "mark_disputed",
      actor,
      project,
      note: "术语需要确认",
    });

    await expect(
      storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([{ disputed: true }]);
    await expect(
      storage.readJsonl("comments/file-1/000001.jsonl"),
    ).resolves.toMatchObject([
      {
        entry_id: entry.id,
        user_id: actor.id,
        body: "术语需要确认",
        disputed: true,
      },
    ]);
    await expect(
      storage.readJsonl<ProjectEvent>("logs/events.jsonl"),
    ).resolves.toHaveLength(2);
  });

  it("rolls back all affected paths when a later write fails", async () => {
    const first = createEntry({
      id: "file-1:1",
      file_id: "file-1",
      index: 1,
      target: "One",
      status: "translated",
      translated_by: "translator-1",
    });
    const second = createEntry({
      id: "file-2:1",
      file_id: "file-2",
      index: 1,
      target: "Two",
      status: "translated",
      translated_by: "translator-2",
    });
    const baseStorage = await createBatchStorage({
      "file-1": [first],
      "file-2": [second],
    });
    const storage = new FailingProjectStorage(baseStorage, 2);
    const project = createProject({
      files: [
        {
          id: "file-1",
          name: "First",
          source_path: "source/file-1.json",
          entries_path: "entries/file-1",
          type: "json",
          hidden: false,
          locked: false,
        },
        {
          id: "file-2",
          name: "Second",
          source_path: "source/file-2.json",
          entries_path: "entries/file-2",
          type: "json",
          hidden: false,
          locked: false,
        },
      ],
      settings: {
        chunk_size: 500,
        auto_save: true,
        allow_change_package: true,
        workflow: {
          enable_tasks: false,
          proofread_required: 1,
        },
      },
    });
    const actor = createMember(["owner"], { id: "owner-1" });

    setEntriesProjectStorage(storage);
    setTasksProjectStorage(storage);
    setEntryBatchProjectStorage(storage);
    setPermissionProject(project);
    await baseStorage.writeJson("project.json", project);

    await expect(
      executeEntryBatch({
        entryIds: [first.id, second.id],
        operation: "proofread",
        actor,
        project,
      }),
    ).rejects.toThrow("已尝试恢复原数据");
    await expect(
      baseStorage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([{ status: "translated" }]);
    await expect(
      baseStorage.readJsonl<Entry>("entries/file-2/chunk_0001.jsonl"),
    ).resolves.toMatchObject([{ status: "translated" }]);
    await expect(
      baseStorage.readJsonl<ProjectEvent>("logs/events.jsonl"),
    ).resolves.toEqual([]);
  });
});
