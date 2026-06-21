import { describe, expect, it } from "vitest";
import type {
  ChangePackageManifest,
  ChangePackageType,
  Comment,
  Entry,
  Member,
  ProjectConfig,
  ProjectEvent,
  Task,
} from "../../src/model/types";
import { generateOwnSigningKey } from "../../src/services/keyManager";
import {
  calculateChangePackageContentHash,
  type ChangePackagePayload,
} from "../../src/services/changePackageHash";
import {
  applyChangePackage,
  exportChangePackage,
  readChangePackage,
  setChangesProjectStorage,
  type ReadChangePackage,
} from "../../src/services/changes";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createEntry, createMember, createProject } from "./factories";
import { FailingProjectStorage } from "./failingProjectStorage";

async function createChangePackageFixture(options: {
  packageEntry?: Partial<Entry>;
  originalTask?: Task;
  packageTask?: Task;
  packageType?: ChangePackageType;
  requireSignedChangePackages?: boolean;
  packageOperation?:
    | "translation_edit"
    | "proofread"
    | "review";
} = {}): Promise<{
  storage: ReturnType<typeof createProjectStorage>;
  actor: Member;
  originalEntry: Entry;
  changePackage: ReadChangePackage;
}> {
  const project = createProject({
    settings: {
      collaboration: {
        require_signed_change_packages:
          options.requireSignedChangePackages === true,
      },
    },
  });
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
    ...options.packageEntry,
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
  const tasks = options.packageTask
    ? {
        "tasks/tasks.jsonl": [options.packageTask],
      }
    : {};
  const events = options.packageOperation
    ? [
        {
          id: "source-entry-event",
          type: "entry.updated",
          user_id: contributor.id,
          entry_id: originalEntry.id,
          file_id: originalEntry.file_id,
          created_at: packageEntry.updated_at,
          detail: {
            before_target: originalEntry.target,
            after_target: packageEntry.target,
            before_status: originalEntry.status,
            after_status: packageEntry.status,
            before_translated_by: originalEntry.translated_by,
            after_translated_by: packageEntry.translated_by,
            before_proofread_by: originalEntry.proofread_by,
            after_proofread_by: packageEntry.proofread_by,
            before_proofread_count: originalEntry.proofread_count,
            after_proofread_count: packageEntry.proofread_count,
            before_reviewed_by: originalEntry.reviewed_by,
            after_reviewed_by: packageEntry.reviewed_by,
            operation: options.packageOperation,
          },
        } satisfies ProjectEvent,
      ]
    : [];
  const payload: ChangePackagePayload = {
    entries,
    comments,
    terms: {},
    contexts: {},
    sourceFiles: {},
    tasks,
    projectFiles: {},
    memberFiles: {},
    events,
  };
  const manifest: ChangePackageManifest = {
    schema_version: 1,
    project_id: project.project_id,
    package_id: "change-1",
    package_type: options.packageType ?? "member_changes",
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
  if (options.originalTask) {
    await storage.writeJsonl("tasks/tasks.jsonl", [options.originalTask]);
  }

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
      tasks,
      projectFiles: {},
      memberFiles: {},
      events,
    },
  };
}

async function createProjectUpdateFixture() {
  const baseProject = createProject({
    revision: "base-revision",
    revision_hash: "base-revision",
    files: [
      {
        id: "file-1",
        name: "dialog.txt",
        source_path: "source/dialog.txt",
        entries_path: "entries/file-1",
        type: "txt",
        hidden: false,
        locked: false,
      },
    ],
  });
  const receiverProject: ProjectConfig = {
    ...baseProject,
    files: [
      ...baseProject.files,
      {
        id: "file-old",
        name: "old.txt",
        source_path: "source/old.txt",
        entries_path: "entries/file-old",
        type: "txt",
        hidden: false,
        locked: false,
      },
    ],
  };
  const owner = createMember(["owner"], { id: "owner-1", name: "Owner" });
  const sourceRoot = createMemoryProjectDirectory(
    {
      "project.json": `${JSON.stringify(baseProject, null, 2)}\n`,
      "members.json": `${JSON.stringify(
        { schema_version: 1, members: [owner] },
        null,
        2,
      )}\n`,
      "source/dialog.txt": "Updated source",
      "entries/file-1/chunk_0001.jsonl": `${JSON.stringify(
        createEntry({
          id: "file-1:1",
          file_id: "file-1",
          index: 1,
          target: "Updated",
          status: "translated",
          updated_by: "owner-1",
        }),
      )}\n`,
      "logs/events.jsonl": "",
    },
    "project-update-source.hproj",
  );
  const sourceStorage = createProjectStorage(sourceRoot);
  const keyResult = await generateOwnSigningKey(sourceRoot, [owner], owner);
  const signingOwner = keyResult.member;

  setChangesProjectStorage(sourceStorage);

  const exported = await exportChangePackage(signingOwner.id, {
    mode: "project_update",
    sign: true,
    actor: signingOwner,
  });
  const packageBytes = new Uint8Array(await exported.blob.arrayBuffer());
  const changePackage = await readChangePackage(packageBytes as unknown as Blob);
  const receiverOwner: Member = {
    ...signingOwner,
    password_hash: "local-password-hash",
    password_salt: "local-password-salt",
    password_updated_at: "2026-01-05T00:00:00.000Z",
  };
  const receiverRoot = createMemoryProjectDirectory(
    {
      "project.json": `${JSON.stringify(receiverProject, null, 2)}\n`,
      "members.json": `${JSON.stringify(
        { schema_version: 1, members: [receiverOwner] },
        null,
        2,
      )}\n`,
      "source/dialog.txt": "Old source",
      "source/old.txt": "Stale source",
      "entries/file-1/chunk_0001.jsonl": `${JSON.stringify(
        createEntry({
          id: "file-1:1",
          file_id: "file-1",
          index: 1,
          target: "Old",
          status: "translated",
          updated_by: "member-2",
        }),
      )}\n`,
      "entries/file-old/chunk_0001.jsonl": `${JSON.stringify(
        createEntry({
          id: "file-old:1",
          file_id: "file-old",
          index: 1,
          target: "Stale",
          status: "translated",
          updated_by: "member-2",
        }),
      )}\n`,
      "comments/file-old/000001.jsonl": "",
      "logs/events.jsonl": "",
    },
    "project-update-receiver.hproj",
  );

  return {
    changePackage,
    receiverOwner,
    receiverProject,
    receiverStorage: createProjectStorage(receiverRoot),
  };
}

async function createExportFixture(options: {
  requireSignedChangePackages?: boolean;
} = {}) {
  const project = createProject({
    settings: {
      collaboration: {
        require_signed_change_packages:
          options.requireSignedChangePackages === true,
      },
    },
    files: [
      {
        id: "file-1",
        name: "dialog.txt",
        source_path: "source/dialog.txt",
        entries_path: "entries/file-1",
        type: "txt",
        hidden: false,
        locked: false,
      },
    ],
  });
  const owner = createMember(["owner"], { id: "owner-1", name: "Owner" });
  const contributor = createMember(["translator"], {
    id: "member-2",
    name: "Contributor",
  });
  const root = createMemoryProjectDirectory(
    {
      "project.json": `${JSON.stringify(project, null, 2)}\n`,
      "members.json": `${JSON.stringify(
        {
          schema_version: 1,
          members: [owner, contributor],
        },
        null,
        2,
      )}\n`,
      "entries/file-1/chunk_0001.jsonl": `${JSON.stringify(
        createEntry({
          id: "file-1:1",
          file_id: "file-1",
          index: 1,
          target: "Translated",
          status: "translated",
          translated_by: contributor.id,
          updated_by: contributor.id,
        }),
      )}\n`,
      "logs/events.jsonl": "",
    },
    "change-package-export-test.hproj",
  );

  return {
    root,
    storage: createProjectStorage(root),
    members: [owner, contributor],
    contributor,
  };
}

describe("ordinary change-package write plan", () => {
  it("rejects unsigned member package export when project requires signatures", async () => {
    const fixture = await createExportFixture({
      requireSignedChangePackages: true,
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      exportChangePackage(fixture.contributor.id, {
        mode: "member_changes",
        sign: false,
        actor: fixture.contributor,
      }),
    ).rejects.toThrow("创建身份密钥");
  });

  it("exports signed member packages after generating a signing key", async () => {
    const fixture = await createExportFixture({
      requireSignedChangePackages: true,
    });
    const keyResult = await generateOwnSigningKey(
      fixture.root,
      fixture.members,
      fixture.contributor,
    );

    setChangesProjectStorage(fixture.storage);

    const exported = await exportChangePackage(keyResult.member.id, {
      mode: "member_changes",
      sign: false,
      actor: keyResult.member,
    });

    expect(exported.signature).toMatchObject({
      user_id: keyResult.member.id,
      key_id: keyResult.member.key_id,
    });
  });

  it("rejects unsigned package import when project requires signatures", async () => {
    const fixture = await createChangePackageFixture({
      requireSignedChangePackages: true,
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).rejects.toThrow("有效成员签名");
  });

  it("keeps accepting unsigned package import when signatures are optional", async () => {
    const fixture = await createChangePackageFixture();

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).resolves.toMatchObject({
      appliedEntries: 1,
    });
  });

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

  it("resets downstream workflow when a package changes target", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: {
        target: "Package changed",
        status: "reviewed",
        translated_by: "member-2",
        proofread_by: ["proofreader-1"],
        proofread_count: 1,
        reviewed_by: "reviewer-1",
      },
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(
        fixture.changePackage,
        [
          {
            entryId: fixture.originalEntry.id,
            action: "use_package",
          },
        ],
        {
          actor: fixture.actor,
        },
      ),
    ).resolves.toMatchObject({
      appliedEntries: 1,
    });
    await expect(
      fixture.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([
      {
        target: "Package changed",
        status: "translated",
        translated_by: "member-2",
        proofread_by: [],
        proofread_count: 0,
        reviewed_by: "",
      },
    ]);
  });

  it("preserves proofread progress when package history identifies a proofread edit", async () => {
    const fixture = await createChangePackageFixture({
      packageOperation: "proofread",
      packageEntry: {
        target: "Proofread package edit",
        status: "proofread",
        translated_by: "member-2",
        proofread_by: ["member-2"],
        proofread_count: 1,
        reviewed_by: "",
      },
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(
        fixture.changePackage,
        [
          {
            entryId: fixture.originalEntry.id,
            action: "use_package",
          },
        ],
        {
          actor: fixture.actor,
        },
      ),
    ).resolves.toMatchObject({ appliedEntries: 1 });
    await expect(
      fixture.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([
      {
        target: "Proofread package edit",
        status: "proofread",
        translated_by: "member-2",
        proofread_by: ["member-2"],
        proofread_count: 1,
        reviewed_by: "",
      },
    ]);

    const events = await fixture.storage.readJsonl<ProjectEvent>(
      "logs/events.jsonl",
    );
    const localVersionEvent = events.find(
      (event) =>
        event.type === "entry.updated" &&
        event.detail?.source_event_id === "source-entry-event",
    );

    expect(localVersionEvent).toMatchObject({
      user_id: "member-2",
      detail: {
        operation: "proofread",
        package_id: "change-1",
        source_event_id: "source-entry-event",
        after_target: "Proofread package edit",
        after_proofread_by: ["member-2"],
      },
    });
    expect(events.filter((event) => event.id === "source-entry-event")).toHaveLength(0);
  });

  it("rejects protected entry field changes in ordinary packages", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: {
        target: "Package changed",
        locked: true,
      },
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).rejects.toThrow("受保护字段");
    await expect(
      fixture.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([{ target: "Original", locked: false }]);
  });

  it("requires conflict resolution for workflow audit field changes", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: {
        proofread_by: ["proofreader-1"],
        proofread_count: 1,
      },
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).rejects.toThrow("冲突");
    await expect(
      applyChangePackage(
        fixture.changePackage,
        [
          {
            entryId: fixture.originalEntry.id,
            action: "use_package",
          },
        ],
        {
          actor: fixture.actor,
        },
      ),
    ).resolves.toMatchObject({ appliedEntries: 1 });
    await expect(
      fixture.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([
      {
        proofread_by: ["proofreader-1"],
        proofread_count: 1,
        assignee: "",
      },
    ]);
  });

  it("rejects protected task field changes in ordinary packages", async () => {
    const originalTask: Task = {
      id: "task-1",
      type: "translate",
      title: "Translate chapter",
      description: "",
      file_id: "file-1",
      range_start: 1,
      range_end: 10,
      entry_ids: [],
      assignee: "member-2",
      status: "assigned",
      target: "",
      submit_method: "change_package",
      created_by: "owner-1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      due_at: "",
    };
    const fixture = await createChangePackageFixture({
      originalTask,
      packageTask: {
        ...originalTask,
        title: "Forged title",
        status: "submitted",
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).rejects.toThrow("任务受保护字段");
    await expect(
      fixture.storage.readJsonl<Task>("tasks/tasks.jsonl"),
    ).resolves.toMatchObject([
      { title: "Translate chapter", status: "assigned" },
    ]);
  });

  it("merges only task execution status from ordinary packages", async () => {
    const originalTask: Task = {
      id: "task-1",
      type: "translate",
      title: "Translate chapter",
      description: "",
      file_id: "file-1",
      range_start: 1,
      range_end: 10,
      entry_ids: [],
      assignee: "member-2",
      status: "assigned",
      target: "",
      submit_method: "change_package",
      created_by: "owner-1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      due_at: "",
    };
    const fixture = await createChangePackageFixture({
      originalTask,
      packageTask: {
        ...originalTask,
        status: "submitted",
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).resolves.toMatchObject({ importedTasks: 1 });
    await expect(
      fixture.storage.readJsonl<Task>("tasks/tasks.jsonl"),
    ).resolves.toMatchObject([
      { title: "Translate chapter", status: "submitted", assignee: "member-2" },
    ]);
  });

  it("rejects changed timezone-free deadlines in maintenance packages", async () => {
    const originalTask: Task = {
      id: "task-1",
      type: "translate",
      title: "Translate chapter",
      description: "",
      file_id: "file-1",
      range_start: 1,
      range_end: 10,
      entry_ids: [],
      assignee: "member-2",
      status: "assigned",
      target: "",
      submit_method: "change_package",
      created_by: "owner-1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      due_at: "",
    };
    const fixture = await createChangePackageFixture({
      packageType: "maintenance_changes",
      originalTask,
      packageTask: {
        ...originalTask,
        updated_at: "2026-02-01T00:00:00.000Z",
        due_at: "2026-06-21T18:00",
        due_time_zone: "Asia/Tokyo",
      },
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
        confirmMaintenance: true,
      }),
    ).rejects.toThrow("未记录明确时区");
  });

  it("normalizes maintenance package deadlines to UTC before writing", async () => {
    const originalTask: Task = {
      id: "task-1",
      type: "translate",
      title: "Translate chapter",
      description: "",
      file_id: "file-1",
      range_start: 1,
      range_end: 10,
      entry_ids: [],
      assignee: "member-2",
      status: "assigned",
      target: "",
      submit_method: "change_package",
      created_by: "owner-1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      due_at: "",
    };
    const fixture = await createChangePackageFixture({
      packageType: "maintenance_changes",
      originalTask,
      packageTask: {
        ...originalTask,
        updated_at: "2026-02-01T00:00:00.000Z",
        due_at: "2026-06-21T18:00:00+09:00",
        due_time_zone: "Asia/Tokyo",
      },
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
        confirmMaintenance: true,
      }),
    ).resolves.toMatchObject({ importedTasks: 1 });
    await expect(
      fixture.storage.readJsonl<Task>("tasks/tasks.jsonl"),
    ).resolves.toMatchObject([
      {
        due_at: "2026-06-21T09:00:00.000Z",
        due_time_zone: "Asia/Tokyo",
      },
    ]);
  });
});

describe("project update package write plan", () => {
  it("applies authoritative content, removes stale files, and preserves local credentials", async () => {
    const fixture = await createProjectUpdateFixture();

    setChangesProjectStorage(fixture.receiverStorage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.receiverOwner,
      }),
    ).resolves.toMatchObject({
      appliedEntries: 1,
      importedMembers: 1,
      importedProjectSettings: 1,
    });
    await expect(
      fixture.receiverStorage.readJson<ProjectConfig>("project.json"),
    ).resolves.toMatchObject({
      revision: fixture.changePackage.manifest.target_revision,
      files: [{ id: "file-1" }],
    });
    await expect(
      fixture.receiverStorage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([{ target: "Updated" }]);
    await expect(
      fixture.receiverStorage.fileExists("source/old.txt"),
    ).resolves.toBe(false);
    await expect(
      fixture.receiverStorage.fileExists("entries/file-old/chunk_0001.jsonl"),
    ).resolves.toBe(false);
    await expect(
      fixture.receiverStorage.fileExists("comments/file-old/000001.jsonl"),
    ).resolves.toBe(false);
    await expect(
      fixture.receiverStorage.readJson<{ members: Member[] }>("members.json"),
    ).resolves.toMatchObject({
      members: [
        {
          id: fixture.receiverOwner.id,
          password_hash: "local-password-hash",
          password_salt: "local-password-salt",
        },
      ],
    });
    await expect(
      fixture.receiverStorage.readJsonl("logs/events.jsonl"),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "change_package.applied" }),
      ]),
    );
  });

  it("restores project update writes when a later write fails", async () => {
    const fixture = await createProjectUpdateFixture();
    const failingStorage = new FailingProjectStorage(fixture.receiverStorage, 2);

    setChangesProjectStorage(failingStorage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.receiverOwner,
      }),
    ).rejects.toThrow("已尝试恢复原数据");
    await expect(
      fixture.receiverStorage.readJson<ProjectConfig>("project.json"),
    ).resolves.toMatchObject({ revision: fixture.receiverProject.revision });
    await expect(
      fixture.receiverStorage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([{ target: "Old" }]);
    await expect(
      fixture.receiverStorage.fileExists("source/old.txt"),
    ).resolves.toBe(true);
  });
});
