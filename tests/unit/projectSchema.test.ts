import { describe, expect, it } from "vitest";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { loadProjectFromStorage } from "../../src/services/project";
import { projectRequiresSignedChangePackages } from "../../src/services/collaboration";
import { createProject } from "./factories";

describe("project schema compatibility", () => {
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
