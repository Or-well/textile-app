import { describe, expect, it } from "vitest";
import type { ChangePackageManifest } from "../../src/model/types";
import {
  completeChangePackageExport,
  setChangesProjectStorage,
  type ExportedChangePackage,
} from "../../src/services/changes";
import {
  createMemoryProjectDirectory,
  isPackedProjectDirty,
} from "../../src/services/projectFs";
import {
  completeProjectPackageExport,
  exportProjectPackage,
} from "../../src/services/projectPackage";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createProject } from "./factories";

function createManifest(): ChangePackageManifest {
  return {
    schema_version: 1,
    project_id: "project-1",
    package_id: "update-1",
    package_type: "project_update",
    user_id: "owner-1",
    user_name: "Owner",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("export completion", () => {
  it("does not advance a project revision until export completion is committed", async () => {
    const project = createProject({ revision: "revision-1" });
    const nextProject = {
      ...project,
      revision: "revision-2",
      revision_hash: "revision-2",
    };
    const root = createMemoryProjectDirectory(
      {
        "project.json": `${JSON.stringify(project, null, 2)}\n`,
      },
      "change-export.hproj",
    );
    const storage = createProjectStorage(root);
    const exported: ExportedChangePackage = {
      fileName: "update.zip",
      blob: new Blob(),
      manifest: createManifest(),
      completion: {
        kind: "project_update",
        projectId: project.project_id,
        baseRevision: "revision-1",
        targetRevision: "revision-2",
        projectJson: `${JSON.stringify(nextProject, null, 2)}\n`,
      },
    };

    setChangesProjectStorage(storage);

    await expect(storage.readJson("project.json")).resolves.toEqual(project);
    await expect(completeChangePackageExport(exported)).resolves.toEqual(
      nextProject,
    );
    await expect(storage.readJson("project.json")).resolves.toEqual(nextProject);
  });

  it("keeps a packed project dirty until its backup is confirmed saved", async () => {
    const project = createProject();
    const root = createMemoryProjectDirectory(
      {
        "project.json": `${JSON.stringify(project, null, 2)}\n`,
      },
      "backup-export.hproj",
    );
    const storage = createProjectStorage(root);

    await storage.writeText("source/file.txt", "changed");
    expect(isPackedProjectDirty(root)).toBe(true);

    await exportProjectPackage(root);
    expect(isPackedProjectDirty(root)).toBe(true);

    completeProjectPackageExport(root);
    expect(isPackedProjectDirty(root)).toBe(false);
  });
});
