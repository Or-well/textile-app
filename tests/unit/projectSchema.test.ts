import { describe, expect, it } from "vitest";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { loadProjectFromStorage, saveProjectToStorage } from "../../src/services/project";
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
    expect(loaded.settings.chunk_size).toBe(250);
    expect(projectRequiresSignedChangePackages(loaded)).toBe(false);
  });

  it("ignores unused settings without changing stored input until an explicit save", async () => {
    const storage = createProjectStorage(createMemoryProjectDirectory({}));
    const raw = {
      ...createProject(),
      settings: {
        chunk_size: 250,
        auto_save: false,
        allow_change_package: false,
        export: {
          default_format: "csv", only_reviewed: true, include_source: false, include_key: false,
          include_report: true, include_manifest: true,
        },
      },
    };
    await storage.writeJson("project.json", raw);
    const bytes = await storage.readText("project.json");
    const loaded = await loadProjectFromStorage(storage);
    expect(loaded.settings).not.toHaveProperty("auto_save");
    expect(loaded.settings).not.toHaveProperty("allow_change_package");
    expect(loaded.settings.export).toEqual({
      default_format: "csv", only_reviewed: true, include_source: false, include_key: false,
    });
    expect(await storage.readText("project.json")).toBe(bytes);
    await saveProjectToStorage(storage, loaded);
    expect((await storage.readJson<{ settings: unknown }>("project.json")).settings).toEqual({
      chunk_size: 250, permission_schema_version: 1,
      export: { default_format: "csv", only_reviewed: true, include_source: false, include_key: false },
    });
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
