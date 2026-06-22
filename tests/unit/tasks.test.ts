import type {
  Entry,
  ProjectConfig,
  ProjectFile,
} from "../../src/model/types";
import { setCurrentUser } from "../../src/services/permissions";
import { describe, expect, it, afterEach } from "vitest";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import {
  completeTask,
  createTask,
  getTaskFilesEntrySummary,
  getTaskOpenTargets,
  getTaskProgress,
  resolveTaskRangeEntryIds,
  loadTasks,
  setTasksProjectStorage,
  submitTask,
} from "../../src/services/tasks";
import { createEntry, createMember, createProject } from "./factories";

async function createTaskProjectStorage(options: {
  enableTasks?: boolean;
  entries?: Entry[];
  entriesByFile?: Record<string, Entry[]>;
  files?: ProjectFile[];
  workflow?: ProjectConfig["settings"]["workflow"];
} = {}) {
  const root = createMemoryProjectDirectory({}, "tasks.hproj");
  const storage = createProjectStorage(root);
  const entries =
    options.entries ??
    [
      createEntry({ id: "entry-1", index: 1 }),
      createEntry({ id: "entry-2", index: 2 }),
    ];

  const files =
    options.files ??
    [
      {
        id: "file-1",
        name: "script.txt",
        source_path: "source/file-1.txt",
        entries_path: "entries/file-1",
        type: "txt",
        hidden: false,
        locked: false,
      },
    ];
  const entriesByFile = options.entriesByFile ?? {
    "file-1": entries,
  };

  await storage.writeJson(
    "project.json",
    createProject({
      files,
      settings: {
        workflow: {
          enable_tasks: options.enableTasks ?? true,
          proofread_required: 0,
          review_required: false,
          ...options.workflow,
        },
      },
    }),
  );
  for (const [fileId, fileEntries] of Object.entries(entriesByFile)) {
    await storage.writeJsonl(
      `entries/${fileId}/chunk_0001.jsonl`,
      fileEntries,
    );
  }
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

  it("resolves a continuous range across multiple selected files", async () => {
    await createTaskProjectStorage({
      files: [
        {
          id: "file-1",
          name: "first.txt",
          source_path: "source/file-1.txt",
          entries_path: "entries/file-1",
          type: "txt",
          hidden: false,
          locked: false,
        },
        {
          id: "file-2",
          name: "second.txt",
          source_path: "source/file-2.txt",
          entries_path: "entries/file-2",
          type: "txt",
          hidden: false,
          locked: false,
        },
      ],
      entriesByFile: {
        "file-1": [
          createEntry({ id: "file-1-entry-1", file_id: "file-1", index: 1 }),
          createEntry({ id: "file-1-entry-2", file_id: "file-1", index: 2 }),
        ],
        "file-2": [
          createEntry({ id: "file-2-entry-1", file_id: "file-2", index: 1 }),
          createEntry({ id: "file-2-entry-2", file_id: "file-2", index: 2 }),
        ],
      },
    });

    await expect(
      getTaskFilesEntrySummary(["file-1", "file-2"]),
    ).resolves.toMatchObject({
      fileCount: 2,
      totalEntries: 4,
    });
    await expect(
      resolveTaskRangeEntryIds(["file-1", "file-2"], 2, 3),
    ).resolves.toEqual(["file-1-entry-2", "file-2-entry-1"]);
  });

  it("calculates progress by the selected task type", async () => {
    await createTaskProjectStorage({
      workflow: {
        proofread_required: 2,
        review_required: true,
      },
      entries: [
        createEntry({
          id: "translated",
          index: 1,
          target: "Translated",
          status: "translated",
        }),
        createEntry({
          id: "proofread-once",
          index: 2,
          target: "Proofread once",
          status: "proofread",
          proofread_count: 1,
          proofread_by: ["proofreader-1"],
        }),
        createEntry({
          id: "reviewed",
          index: 3,
          target: "Reviewed",
          status: "reviewed",
          proofread_count: 2,
          proofread_by: ["proofreader-1", "proofreader-2"],
          reviewed_by: "reviewer-1",
        }),
      ],
    });
    const baseDraft = {
      file_ids: ["file-1"],
      range_start: 1,
      range_end: 3,
    };
    const translateTask = await createTask(
      {
        ...baseDraft,
        title: "Translate",
        type: "translate",
      },
      "owner-1",
    );
    const proofreadTask = await createTask(
      {
        ...baseDraft,
        title: "Proofread",
        type: "proofread",
        proofread_round: 2,
      },
      "owner-1",
    );
    const reviewTask = await createTask(
      {
        ...baseDraft,
        title: "Review",
        type: "review",
      },
      "owner-1",
    );
    const termTask = await createTask(
      {
        ...baseDraft,
        title: "Terms",
        type: "term",
      },
      "owner-1",
    );

    await expect(getTaskProgress(translateTask.id)).resolves.toMatchObject({
      progressAvailable: true,
      completedEntries: 3,
      progressPercent: 100,
    });
    await expect(getTaskProgress(proofreadTask.id)).resolves.toMatchObject({
      progressAvailable: true,
      completedEntries: 1,
      progressPercent: 33,
    });
    await expect(getTaskProgress(reviewTask.id)).resolves.toMatchObject({
      progressAvailable: true,
      completedEntries: 1,
      progressPercent: 33,
    });
    await expect(getTaskProgress(termTask.id)).resolves.toMatchObject({
      progressAvailable: false,
      completedEntries: 0,
      progressPercent: 0,
    });
  });

  it("returns one open target for each file covered by the task", async () => {
    await createTaskProjectStorage({
      files: [
        {
          id: "file-1",
          name: "First",
          source_path: "source/file-1.txt",
          entries_path: "entries/file-1",
          type: "txt",
          hidden: false,
          locked: false,
        },
        {
          id: "file-2",
          name: "Second",
          source_path: "source/file-2.txt",
          entries_path: "entries/file-2",
          type: "txt",
          hidden: false,
          locked: false,
        },
      ],
      entriesByFile: {
        "file-1": [
          createEntry({ id: "first-2", file_id: "file-1", index: 2 }),
        ],
        "file-2": [
          createEntry({ id: "second-3", file_id: "file-2", index: 3 }),
          createEntry({ id: "second-4", file_id: "file-2", index: 4 }),
        ],
      },
    });
    const task = await createTask(
      {
        title: "Selected entries",
        type: "translate",
        file_ids: ["file-1", "file-2"],
        range_start: 1,
        range_end: 3,
        entry_ids: ["second-4", "first-2", "second-3"],
      },
      "owner-1",
    );

    await expect(getTaskOpenTargets(task.id)).resolves.toEqual([
      {
        fileId: "file-1",
        fileName: "First",
        entryId: "first-2",
        entryIndex: 2,
        entryCount: 1,
      },
      {
        fileId: "file-2",
        fileName: "Second",
        entryId: "second-3",
        entryIndex: 3,
        entryCount: 2,
      },
    ]);
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

  it("stores new task deadlines as UTC with their source timezone", async () => {
    const storage = await createTaskProjectStorage();
    const task = await createTask(
      {
        title: "Timed task",
        type: "translate",
        file_id: "file-1",
        range_start: 1,
        range_end: 1,
        due_at: "2026-06-21T18:00:00+09:00",
        due_time_zone: "Asia/Tokyo",
      },
      "owner-1",
    );

    expect(task).toMatchObject({
      due_at: "2026-06-21T09:00:00.000Z",
      due_time_zone: "Asia/Tokyo",
    });
    await expect(
      storage.readJsonl("tasks/tasks.jsonl"),
    ).resolves.toMatchObject([
      {
        due_at: "2026-06-21T09:00:00.000Z",
        due_time_zone: "Asia/Tokyo",
      },
    ]);
  });

  it("rejects new timezone-free task deadlines", async () => {
    await createTaskProjectStorage();

    await expect(
      createTask(
        {
          title: "Ambiguous task",
          type: "translate",
          file_id: "file-1",
          range_start: 1,
          range_end: 1,
          due_at: "2026-06-21T18:00",
          due_time_zone: "Asia/Tokyo",
        },
        "owner-1",
      ),
    ).rejects.toThrow("UTC ISO");
  });

  it("keeps legacy timezone-free deadlines readable until edited", async () => {
    const root = createMemoryProjectDirectory(
      {
        "tasks/tasks.jsonl": `${JSON.stringify({
          id: "legacy-task",
          title: "Legacy",
          type: "translate",
          file_id: "",
          range_start: 1,
          range_end: 1,
          entry_ids: [],
          assignee: "",
          status: "unassigned",
          target: "",
          submit_method: "change_package",
          created_by: "owner-1",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          due_at: "2026-06-21T18:00",
        })}\n`,
      },
      "tasks-legacy.hproj",
    );

    setTasksProjectStorage(createProjectStorage(root));

    await expect(loadTasks()).resolves.toMatchObject([
      {
        id: "legacy-task",
        due_at: "2026-06-21T18:00",
      },
    ]);
  });
});
