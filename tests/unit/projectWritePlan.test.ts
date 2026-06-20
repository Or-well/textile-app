import { describe, expect, it } from "vitest";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import {
  ProjectWritePlanError,
  createProjectWritePlan,
} from "../../src/services/projectWritePlan";
import {
  createProjectStorage,
} from "../../src/services/projectStorage";
import { FailingProjectStorage } from "./failingProjectStorage";

async function createStorage(files: Record<string, string>) {
  const root = createMemoryProjectDirectory(files, "test.hproj");

  return createProjectStorage(root);
}

describe("ProjectWritePlan", () => {
  it("applies writes and deletes in registration order", async () => {
    const storage = await createStorage({
      "data/existing.txt": "old",
      "data/delete.txt": "delete",
    });
    const plan = createProjectWritePlan(storage);

    plan.writeText("data/existing.txt", "new");
    plan.writeText("nested/new.txt", "created");
    plan.deleteFile("data/delete.txt");

    await expect(plan.execute()).resolves.toEqual({
      appliedPaths: [
        "data/existing.txt",
        "nested/new.txt",
        "data/delete.txt",
      ],
    });
    await expect(storage.readText("data/existing.txt")).resolves.toBe("new");
    await expect(storage.readText("nested/new.txt")).resolves.toBe("created");
    await expect(storage.fileExists("data/delete.txt")).resolves.toBe(false);
  });

  it.each([1, 2, 3])(
    "restores all file content when operation %i fails",
    async (failAt) => {
      const baseStorage = await createStorage({
        "data/existing.txt": "old",
        "data/delete.txt": "delete",
      });
      const storage = new FailingProjectStorage(baseStorage, failAt);
      const plan = createProjectWritePlan(storage);

      plan.writeText("data/existing.txt", "new");
      plan.writeText("nested/new.txt", "created");
      plan.deleteFile("data/delete.txt");

      await expect(plan.execute()).rejects.toBeInstanceOf(ProjectWritePlanError);
      await expect(baseStorage.readText("data/existing.txt")).resolves.toBe("old");
      await expect(baseStorage.readText("data/delete.txt")).resolves.toBe("delete");
      await expect(baseStorage.fileExists("nested/new.txt")).resolves.toBe(false);
      await expect(baseStorage.fileExists("nested")).resolves.toBe(false);
    },
  );

  it("restores a target when an operation fails after mutating it", async () => {
    const baseStorage = await createStorage({
      "data/existing.txt": "old",
    });
    let shouldFail = true;
    const storage = new Proxy(baseStorage, {
      get(target, property) {
        if (property === "writeBinary") {
          return async (path: string, content: Uint8Array) => {
            await target.writeBinary(path, content);

            if (shouldFail) {
              shouldFail = false;
              throw new Error("Injected post-write failure.");
            }
          };
        }

        const value = Reflect.get(target, property, target);

        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const plan = createProjectWritePlan(storage);

    plan.writeText("data/existing.txt", "new");

    await expect(plan.execute()).rejects.toBeInstanceOf(ProjectWritePlanError);
    await expect(baseStorage.readText("data/existing.txt")).resolves.toBe("old");
  });

  it("rejects duplicate target paths before execution", async () => {
    const storage = await createStorage({});
    const plan = createProjectWritePlan(storage);

    plan.writeText("data.txt", "first");

    expect(() => plan.deleteFile("data.txt")).toThrow(
      "同一写入计划不能重复操作路径",
    );
  });
});
