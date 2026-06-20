import { describe, expect, it } from "vitest";
import type {
  ChangePackageManifest,
  Comment,
  Entry,
  Member,
} from "../../src/model/types";
import {
  calculateChangePackageContentHash,
  type ChangePackagePayload,
} from "../../src/services/changePackageHash";
import {
  applyChangePackage,
  setChangesProjectStorage,
  type ReadChangePackage,
} from "../../src/services/changes";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createEntry, createMember, createProject } from "./factories";
import { FailingProjectStorage } from "./failingProjectStorage";

async function createChangePackageFixture(): Promise<{
  storage: ReturnType<typeof createProjectStorage>;
  actor: Member;
  originalEntry: Entry;
  changePackage: ReadChangePackage;
}> {
  const project = createProject();
  const actor = createMember(["owner"], { id: "owner-1", name: "Owner" });
  const contributor = createMember(["translator"], {
    id: "member-2",
    name: "Contributor",
  });
  const originalEntry = createEntry({
    id: "file-1:1",
    file_id: "file-1",
    index: 1,
    key: "line_000001",
    target: "Original",
    status: "translated",
    updated_by: actor.id,
  });
  const packageEntry = {
    ...originalEntry,
    updated_at: "2026-02-01T00:00:00.000Z",
    updated_by: contributor.id,
  };
  const comment: Comment = {
    id: "comment-1",
    entry_id: originalEntry.id,
    file_id: originalEntry.file_id,
    user_id: contributor.id,
    body: "Imported comment",
    reply_to: null,
    created_at: "2026-02-01T00:00:00.000Z",
  };
  const entries = {
    "entries/file-1/chunk_0001.jsonl": [packageEntry],
  };
  const comments = {
    "comments/file-1/1.jsonl": [comment],
  };
  const payload: ChangePackagePayload = {
    entries,
    comments,
    terms: {},
    contexts: {},
    sourceFiles: {},
    tasks: {},
    projectFiles: {},
    memberFiles: {},
    events: [],
  };
  const manifest: ChangePackageManifest = {
    schema_version: 1,
    project_id: project.project_id,
    package_id: "change-1",
    package_type: "member_changes",
    user_id: contributor.id,
    user_name: contributor.name,
    created_at: "2026-02-01T00:00:00.000Z",
    content_hash: await calculateChangePackageContentHash(payload),
  };
  const root = createMemoryProjectDirectory(
    {
      "project.json": `${JSON.stringify(project, null, 2)}\n`,
      "members.json": `${JSON.stringify(
        {
          schema_version: 1,
          members: [actor, contributor],
        },
        null,
        2,
      )}\n`,
      "logs/events.jsonl": "",
    },
    "change-package-test.hproj",
  );
  const storage = createProjectStorage(root);

  await storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
    originalEntry,
  ]);

  return {
    storage,
    actor,
    originalEntry,
    changePackage: {
      manifest,
      files: {},
      entries,
      comments,
      terms: {},
      contexts: {},
      sourceFiles: {},
      tasks: {},
      projectFiles: {},
      memberFiles: {},
      events: [],
    },
  };
}

describe("ordinary change-package write plan", () => {
  it("commits merged content and one import log entry", async () => {
    const fixture = await createChangePackageFixture();

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).resolves.toMatchObject({
      appliedEntries: 1,
      importedComments: 1,
      importedEvents: 0,
    });

    await expect(
      fixture.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([{ updated_by: "member-2" }]);
    await expect(
      fixture.storage.readJsonl<Comment>("comments/file-1/1.jsonl"),
    ).resolves.toMatchObject([{ id: "comment-1" }]);
    await expect(
      fixture.storage.readJsonl("logs/events.jsonl"),
    ).resolves.toMatchObject([{ type: "change_package.applied" }]);
  });

  it("restores earlier files when a later package write fails", async () => {
    const fixture = await createChangePackageFixture();
    const failingStorage = new FailingProjectStorage(fixture.storage, 2);

    setChangesProjectStorage(failingStorage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).rejects.toThrow("已尝试恢复原数据");

    await expect(
      fixture.storage.readJsonl("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toEqual([fixture.originalEntry]);
    await expect(
      fixture.storage.fileExists("comments/file-1/1.jsonl"),
    ).resolves.toBe(false);
    await expect(
      fixture.storage.readJsonl("logs/events.jsonl"),
    ).resolves.toEqual([]);
  });
});
