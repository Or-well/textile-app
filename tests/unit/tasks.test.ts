import type { Entry } from "../../src/model/types";
import { setCurrentUser } from "../../src/services/permissions";
import { describe, expect, it, afterEach } from "vitest";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import {
  completeTask,
  createTask,
  getTaskProgress,
  loadTasks,
  setTasksProjectStorage,
  submitTask,
} from "../../src/services/tasks";
import { createEntry, createMember, createProject } from "./factories";

async function createTaskProjectStorage(options: {
  enableTasks?: boolean;
  entries?: Entry[];
} = {}) {
  const root = createMemoryProjectDirectory({}, "tasks.hproj");
  const storage = createProjectStorage(root);
  const entries =
    options.entries ??
    [
      createEntry({ id: "entry-1", index: 1 }),
      createEntry({ id: "entry-2", index: 2 }),
    ];

  await storage.writeJson(
    "project.json",
    createProject({
      files: [
        {
          id: "file-1",
          name: "script.txt",
          source_path: "source/file-1.txt",
          entries_path: "entries/file-1",
          type: "txt",
          hidden: false,
          locked: false,
        },
      ],
      settings: {
        workflow: {
          enable_tasks: options.enableTasks ?? true,
          proofread_required: 0,
          review_required: false,
        },
      },
    }),
  );
  await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", entries);
  setTasksProjectStorage(storage);
  setCurrentUser(createMember(["owner"], { id: "owner-1" }));

  return storage;
}

describe("task storage integrity", () => {
  afterEach(() => {
    setCurrentUser(null);
  });

  it("treats a missing task file as an empty task list", async () => {
    const root = createMemoryProjectDirectory({}, "tasks-empty.hproj");
    const storage = createProjectStorage(root);

    setTasksProjectStorage(storage);

    await expect(loadTasks()).resolves.toEqual([]);
  });

  it("reports malformed task data instead of caching an empty list", async () => {
    const root = createMemoryProjectDirectory(
      {
        "tasks/tasks.jsonl": "{\"id\":\"task-1\"}\nnot-json\n",
      },
      "tasks-corrupt.hproj",
    );
    const storage = createProjectStorage(root);

    setTasksProjectStorage(storage);

    await expect(loadTasks()).rejects.toThrow(
      "为避免覆盖原任务，当前项目已停止任务写入",
    );
    await expect(loadTasks()).rejects.toThrow(
      "为避免覆盖原任务，当前项目已停止任务写入",
    );
    await expect(storage.readText("tasks/tasks.jsonl")).resolves.toContain(
      "not-json",
    );
  });

  it("blocks task writes when project tasks are disabled", async () => {
    await createTaskProjectStorage({ enableTasks: false });

    await expect(
      createTask(
        {
          title: "Translate",
          type: "translate",
          file_id: "file-1",
          range_start: 1,
          range_end: 1,
        },
        "owner-1",
      ),
    ).rejects.toThrow("未启用任务");
  });

  it("requires workflow actions to follow the task status transition table", async () => {
    await createTaskProjectStorage();
    const task = await createTask(
      {
        title: "Translate",
        type: "translate",
        file_id: "file-1",
        range_start: 1,
        range_end: 1,
        assignee: "owner-1",
      },
      "owner-1",
    );

    await expect(completeTask(task.id)).rejects.toThrow("assigned");

    const submitted = await submitTask(task.id);
    expect(submitted.status).toBe("submitted");

    const completed = await completeTask(task.id);
    expect(completed.status).toBe("completed");
  });

  it("calculates progress for entry-id tasks without a file id", async () => {
    await createTaskProjectStorage({
      entries: [
        createEntry({
          id: "entry-1",
          index: 1,
          target: "Done",
          status: "translated",
        }),
        createEntry({ id: "entry-2", index: 2 }),
        createEntry({ id: "entry-3", index: 3 }),
      ],
    });
    const task = await createTask(
      {
        title: "Selected entries",
        type: "translate",
        file_id: "",
        range_start: 1,
        range_end: 1,
        entry_ids: ["entry-1", "entry-2"],
      },
      "owner-1",
    );

    const progress = await getTaskProgress(task.id);

    expect(progress.totalEntries).toBe(2);
    expect(progress.translatedEntries).toBe(1);
    expect(progress.untranslatedEntries).toBe(1);
  });

  it("rejects task scopes that reference missing entries", async () => {
    await createTaskProjectStorage();

    await expect(
      createTask(
        {
          title: "Broken scope",
          type: "translate",
          file_id: "",
          range_start: 1,
          range_end: 1,
          entry_ids: ["missing-entry"],
        },
        "owner-1",
      ),
    ).rejects.toThrow("do not exist");
  });
});
