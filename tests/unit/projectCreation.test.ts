import { describe, expect, it } from "vitest";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectInStorage } from "../../src/services/project";
import { createProjectStorage } from "../../src/services/projectStorage";
import { FailingProjectStorage } from "./failingProjectStorage";

const input = {
  name: "Test Project",
  description: "",
  sourceLanguage: "en",
  targetLanguage: "zh-CN",
  enableTasks: true,
  enableProofread: true,
  enableReview: true,
  proofreadRequired: 1 as const,
  progressWeights: {
    translation: 40,
    proofread: 30,
    review: 30,
  },
  ownerName: "Owner",
  ownerPassword: "password",
};

function createEmptyStorage() {
  return createProjectStorage(
    createMemoryProjectDirectory({}, "creation-test.hproj"),
  );
}

describe("createProjectInStorage", () => {
  it("writes project.json after the other initial files", async () => {
    const storage = createEmptyStorage();

    const result = await createProjectInStorage(storage, input);

    await expect(storage.readJson("project.json")).resolves.toMatchObject({
      project_id: result.project.config.project_id,
      name: input.name,
      settings: {
        collaboration: {
          require_signed_change_packages: true,
        },
      },
    });
    await expect(storage.readJson("members.json")).resolves.toMatchObject({
      members: [{ id: result.owner.id, roles: ["owner"] }],
    });
  });

  it("removes all created files and directories when initialization fails", async () => {
    const baseStorage = createEmptyStorage();
    const storage = new FailingProjectStorage(baseStorage, 12);

    await expect(createProjectInStorage(storage, input)).rejects.toThrow(
      "已尝试恢复原数据",
    );

    for (const path of [
      "project.json",
      "members.json",
      "terms",
      "tasks",
      "logs",
      "source",
      "entries",
      "comments",
      "exports",
      "changes",
    ]) {
      await expect(baseStorage.fileExists(path)).resolves.toBe(false);
    }
  });

  it("can create a project that allows unsigned change packages", async () => {
    const storage = createEmptyStorage();

    await createProjectInStorage(storage, {
      ...input,
      requireSignedChangePackages: false,
    });

    await expect(storage.readJson("project.json")).resolves.toMatchObject({
      settings: {
        collaboration: {
          require_signed_change_packages: false,
        },
      },
    });
  });
});
