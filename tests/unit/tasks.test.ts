import { describe, expect, it } from "vitest";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import {
  loadTasks,
  setTasksProjectStorage,
} from "../../src/services/tasks";

describe("task storage integrity", () => {
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
});
