import { describe, expect, it } from "vitest";
import { recoverImportedNativeProjectRoot } from "../../src/services/project";
import {
  createMemoryProjectDirectory,
  type ProjectDirectoryHandle,
} from "../../src/services/projectFs";
import { createProject } from "./factories";

function createLegacyImportParent(
  childNames: string[],
): ProjectDirectoryHandle {
  const project = createProject({ project_id: "project-1" });
  const files = Object.fromEntries(
    childNames.map((name) => [
      `${name}/project.json`,
      JSON.stringify(project),
    ]),
  );
  const root = createMemoryProjectDirectory(files, "Imports");

  Object.defineProperty(root, "storageKind", {
    configurable: true,
    value: "native-folder",
  });

  return root;
}

describe("legacy imported project root recovery", () => {
  it("recovers the only matching imported child project", async () => {
    const root = createLegacyImportParent(["Demo-project1"]);

    const recovered = await recoverImportedNativeProjectRoot(root, "project-1");

    expect(recovered).not.toBe(root);
    expect(recovered.name).toBe("Demo-project1");
  });

  it("keeps the recorded root when matching children are ambiguous", async () => {
    const root = createLegacyImportParent([
      "Demo-project1",
      "Demo-project1-copy",
    ]);

    await expect(
      recoverImportedNativeProjectRoot(root, "project-1"),
    ).resolves.toBe(root);
  });
});
