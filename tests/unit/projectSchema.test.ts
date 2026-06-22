import { describe, expect, it } from "vitest";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { loadProjectFromStorage } from "../../src/services/project";
import { projectRequiresSignedChangePackages } from "../../src/services/collaboration";
import { createProject } from "./factories";

describe("project schema compatibility", () => {
  it("normalizes a missing or invalid trust epoch to zero", async () => {
    const storage = createProjectStorage(createMemoryProjectDirectory({}));

    await storage.writeJson("project.json", {
      schema_version: 1,
      project_id: "project-trust-epoch",
      trust_epoch: -5,
      name: "Project",
      source_language: "ja",
      target_language: "zh-Hans",
      files: [],
      settings: {
        chunk_size: 500,
        auto_save: true,
        allow_change_package: true,
      },
    });

    await expect(loadProjectFromStorage(storage)).resolves.toMatchObject({
      trust_epoch: 0,
    });
  });

  it("normalizes old v1 projects with missing optional settings", async () => {
    const storage = createProjectStorage(createMemoryProjectDirectory({}));
    const project = createProject();

    await storage.writeJson("project.json", {
      ...project,
      schema_version: undefined,
      settings: {
        chunk_size: 250,
      },
    });

    const loaded = await loadProjectFromStorage(storage);

    expect(loaded.schema_version).toBe(1);
    expect(loaded.settings.auto_save).toBe(true);
    expect(loaded.settings.allow_change_package).toBe(true);
    expect(projectRequiresSignedChangePackages(loaded)).toBe(false);
  });

  it("rejects projects from unsupported future schemas", async () => {
    const storage = createProjectStorage(createMemoryProjectDirectory({}));

    await storage.writeJson("project.json", {
      ...createProject(),
      schema_version: 99,
    });

    await expect(loadProjectFromStorage(storage)).rejects.toThrow(
      "schema_version 99 is not supported",
    );
  });
});
