import { afterEach, describe, expect, it } from "vitest";
import { setCurrentUser } from "../../src/services/permissions";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import {
  exportProject,
  setExporterProjectStorage,
} from "../../src/services/exporter";
import { createEntry, createMember, createProject } from "./factories";

describe("export permissions", () => {
  afterEach(() => {
    setCurrentUser(null);
  });

  it("keeps release export permission checks in the service layer", async () => {
    const storage = createProjectStorage(createMemoryProjectDirectory({}));

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
            proofread_required: 0,
            review_required: false,
          },
        },
      }),
    );
    await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
      createEntry({ target: "Done", status: "translated" }),
    ]);
    setExporterProjectStorage(storage);
    setCurrentUser(createMember(["readonly"], { id: "reader-1" }));

    await expect(exportProject()).rejects.toThrow("Permission denied");
  });
});
