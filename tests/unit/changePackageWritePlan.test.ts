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
import {
  generateOwnSigningKey,
  prepareOwnSigningKeyRotation,
} from "../../src/services/keyManager";
import { prepareOwnerTransfer } from "../../src/services/auth";
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
  const defaultTask: Task = {
    id: "task-default",
    type: "translate",
    title: "Translate default scope",
    description: "",
    file_id: "file-1",
    range_start: 1,
    range_end: 1,
    entry_ids: [],
    assignee: contributor.id,
    status: "assigned",
    target: "",
    submit_method: "change_package",
    created_by: actor.id,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    due_at: "",
  };
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
  await storage.writeJsonl("tasks/tasks.jsonl", [
    options.originalTask ?? defaultTask,
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
      tasks,
      projectFiles: {},
      memberFiles: {},
      events,
    },
  };
}

async function refreshChangePackageHash(
  changePackage: ReadChangePackage,
): Promise<void> {
  changePackage.manifest.content_hash =
    await calculateChangePackageContentHash({
      entries: changePackage.entries,
      comments: changePackage.comments,
      terms: changePackage.terms,
      contexts: changePackage.contexts,
      sourceFiles: changePackage.sourceFiles,
      tasks: changePackage.tasks,
      projectFiles: changePackage.projectFiles,
      memberFiles: changePackage.memberFiles,
      events: changePackage.events,
    });
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
      "tasks/tasks.jsonl": `${JSON.stringify({
        id: "task-1",
        type: "translate",
        title: "Translate",
        description: "",
        file_id: "file-1",
        range_start: 1,
        range_end: 1,
        entry_ids: [],
        assignee: contributor.id,
        status: "assigned",
        target: "",
        submit_method: "change_package",
        created_by: owner.id,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        due_at: "",
      })}\n`,
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

  it("rejects optional signed package export when the signer key is not ready", async () => {
    const fixture = await createExportFixture();

    setChangesProjectStorage(fixture.storage);

    await expect(
      exportChangePackage(fixture.contributor.id, {
        mode: "member_changes",
        sign: true,
        actor: fixture.contributor,
      }),
    ).rejects.toThrow("已选择给修改包签名");
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
  });

  it("merges dispute fields from ordinary packages inside assigned task scope", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: {
        disputed: true,
        dispute_reason: "Needs wording check",
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
        disputed: true,
        dispute_reason: "Needs wording check",
      },
    ]);
  });

  it("rejects ordinary member packages outside assigned task scope", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: {
        id: "file-1:2",
        index: 2,
        target: "Outside scope",
      },
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).rejects.toThrow("任务范围外");
  });

  it("does not let unsigned packages forge a manager to bypass task scope", async () => {
    const fixture = await createChangePackageFixture();

    fixture.changePackage.manifest.user_id = fixture.actor.id;
    fixture.changePackage.manifest.user_name = fixture.actor.name;
    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).rejects.toThrow("任务范围外");
  });

  it("allows managers to export changes from another member's task", async () => {
    const fixture = await createExportFixture();

    setChangesProjectStorage(fixture.storage);

    const exported = await exportChangePackage("owner-1", {
      mode: "task_changes",
      taskIds: ["task-1"],
      actor: fixture.members[0],
    });
    const changePackage = await readChangePackage(
      new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob,
    );

    expect(changePackage.manifest.scopes).toEqual(["task:task-1"]);
    expect(Object.values(changePackage.entries).flat()).toMatchObject([
      {
        updated_by: fixture.contributor.id,
        target: "Translated",
      },
    ]);
  });

  it("rejects exporting another member's task for ordinary members", async () => {
    const fixture = await createExportFixture();

    setChangesProjectStorage(fixture.storage);

    await expect(
      exportChangePackage(fixture.contributor.id, {
        mode: "task_changes",
        taskIds: ["task-1"],
        actor: createMember(["translator"], {
          id: "member-3",
          name: "Other translator",
        }),
      }),
    ).rejects.toThrow("Login required");
    await expect(
      exportChangePackage("member-3", {
        mode: "task_changes",
        taskIds: ["task-1"],
        actor: createMember(["translator"], {
          id: "member-3",
          name: "Other translator",
        }),
      }),
    ).rejects.toThrow("普通成员只能导出分配给自己的任务修改");
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

  it("imports ordinary comment status updates", async () => {
    const fixture = await createChangePackageFixture();
    const path = "comments/file-1/1.jsonl";
    const existingComment: Comment = {
      ...fixture.changePackage.comments[path][0]!,
      status: "open",
      resolved: false,
      updated_at: "2026-02-01T00:00:00.000Z",
      updated_by: "member-2",
      resolved_at: "",
      resolved_by: "",
    };
    const packageComment: Comment = {
      ...existingComment,
      status: "resolved",
      resolved: true,
      updated_at: "2026-02-02T00:00:00.000Z",
      resolved_at: "2026-02-02T00:00:00.000Z",
      resolved_by: "member-2",
    };

    fixture.changePackage.comments[path] = [packageComment];
    await fixture.storage.writeJsonl(path, [existingComment]);
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(
        fixture.changePackage,
        [
          {
            conflictId: `comment:${path}:comment-1`,
            action: "use_package",
          },
        ],
        {
          actor: fixture.actor,
        },
      ),
    ).resolves.toMatchObject({
      importedComments: 1,
    });
    await expect(
      fixture.storage.readJsonl<Comment>(path),
    ).resolves.toMatchObject([
      {
        id: "comment-1",
        status: "resolved",
        resolved: true,
        resolved_at: "2026-02-02T00:00:00.000Z",
        resolved_by: "member-2",
      },
    ]);
  });

  it("imports ordinary comment deletion events", async () => {
    const fixture = await createChangePackageFixture();
    const path = "comments/file-1/1.jsonl";
    const parentComment: Comment = {
      ...fixture.changePackage.comments[path][0]!,
      status: "open",
      resolved: false,
    };
    const replyComment: Comment = {
      ...parentComment,
      id: "comment-reply",
      body: "Reply",
      reply_to: parentComment.id,
    };

    fixture.changePackage.comments = {};
    fixture.changePackage.events = [
      {
        id: "comment-delete-event",
        type: "comment.deleted",
        user_id: "member-2",
        entry_id: fixture.originalEntry.id,
        file_id: fixture.originalEntry.file_id,
        created_at: "2026-02-03T00:00:00.000Z",
        detail: { comment_id: parentComment.id, deleted_replies: 1 },
      },
    ];
    await fixture.storage.writeJsonl(path, [parentComment, replyComment]);
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).resolves.toMatchObject({
      importedComments: 2,
      importedEvents: 1,
    });
    await expect(
      fixture.storage.readJsonl<Comment>(path),
    ).resolves.toEqual([]);
    await expect(
      fixture.storage.readJsonl<ProjectEvent>("logs/events.jsonl"),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "comment-delete-event" }),
        expect.objectContaining({ type: "change_package.applied" }),
      ]),
    );
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
        translated_by: "translator-1",
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
        translated_by: "translator-1",
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
  it("applies an owner transfer package signed by the previous owner", async () => {
    const project = createProject({
      revision: "base-revision",
      revision_hash: "base-revision",
    });
    const previousOwner = createMember(["owner"], {
      id: "owner-1",
      name: "Owner",
    });
    const nextOwner = createMember(["admin"], {
      id: "owner-2",
      name: "Next Owner",
    });
    const sourceRoot = createMemoryProjectDirectory(
      {
        "project.json": `${JSON.stringify(project, null, 2)}\n`,
        "members.json": `${JSON.stringify(
          { schema_version: 1, members: [previousOwner, nextOwner] },
          null,
          2,
        )}\n`,
        "logs/events.jsonl": "",
      },
      "owner-transfer-source.hproj",
    );
    const sourceStorage = createProjectStorage(sourceRoot);
    const previousOwnerKey = await generateOwnSigningKey(
      sourceRoot,
      [previousOwner, nextOwner],
      previousOwner,
    );
    const nextOwnerKey = await generateOwnSigningKey(
      sourceRoot,
      previousOwnerKey.members,
      nextOwner,
    );
    const signingOwner = nextOwnerKey.members.find(
      (member) => member.id === previousOwner.id,
    )!;
    const preparedTransfer = prepareOwnerTransfer(
      nextOwnerKey.members,
      signingOwner,
      nextOwner.id,
    );

    setChangesProjectStorage(sourceStorage);

    const exported = await exportChangePackage(signingOwner.id, {
      mode: "project_update",
      sign: true,
      actor: signingOwner,
      signatureMember: signingOwner,
      projectUpdateMembers: preparedTransfer.members,
    });
    const packageBytes = new Uint8Array(await exported.blob.arrayBuffer());
    const changePackage = await readChangePackage(packageBytes as unknown as Blob);
    const receiverRoot = createMemoryProjectDirectory(
      {
        "project.json": `${JSON.stringify(project, null, 2)}\n`,
        "members.json": `${JSON.stringify(
          { schema_version: 1, members: nextOwnerKey.members },
          null,
          2,
        )}\n`,
        "logs/events.jsonl": "",
      },
      "owner-transfer-receiver.hproj",
    );
    const receiverStorage = createProjectStorage(receiverRoot);

    expect(changePackage.signature?.user_id).toBe(previousOwner.id);
    expect(changePackage.signature?.key_id).toBe(signingOwner.key_id);

    setChangesProjectStorage(receiverStorage);

    await expect(
      applyChangePackage(changePackage, [], { actor: signingOwner }),
    ).resolves.toMatchObject({
      importedMembers: 2,
      importedProjectSettings: 1,
    });
    await expect(
      receiverStorage.readJson<{ members: Member[] }>("members.json"),
    ).resolves.toMatchObject({
      members: [
        { id: previousOwner.id, roles: ["admin"] },
        expect.objectContaining({
          id: nextOwner.id,
          key_id: nextOwnerKey.member.key_id,
          roles: expect.arrayContaining(["owner", "admin"]),
        }),
      ],
    });
  });

  it("applies a maintainer key transition package signed by the previous key", async () => {
    const project = createProject({
      revision: "base-revision",
      revision_hash: "base-revision",
    });
    const owner = createMember(["owner"], { id: "owner-1", name: "Owner" });
    const sourceRoot = createMemoryProjectDirectory(
      {
        "project.json": `${JSON.stringify(project, null, 2)}\n`,
        "members.json": `${JSON.stringify(
          { schema_version: 1, members: [owner] },
          null,
          2,
        )}\n`,
        "logs/events.jsonl": "",
      },
      "key-transition-source.hproj",
    );
    const sourceStorage = createProjectStorage(sourceRoot);
    const previousKey = await generateOwnSigningKey(sourceRoot, [owner], owner);
    const rotation = await prepareOwnSigningKeyRotation(
      previousKey.members,
      previousKey.member,
    );

    setChangesProjectStorage(sourceStorage);

    const exported = await exportChangePackage(previousKey.member.id, {
      mode: "project_update",
      sign: true,
      actor: previousKey.member,
      signatureMember: previousKey.member,
      projectUpdateMembers: rotation.members,
    });
    const packageBytes = new Uint8Array(await exported.blob.arrayBuffer());
    const changePackage = await readChangePackage(packageBytes as unknown as Blob);
    const receiverOwner: Member = {
      ...previousKey.member,
      password_hash: "local-password-hash",
      password_salt: "local-password-salt",
    };
    const receiverRoot = createMemoryProjectDirectory(
      {
        "project.json": `${JSON.stringify(project, null, 2)}\n`,
        "members.json": `${JSON.stringify(
          { schema_version: 1, members: [receiverOwner] },
          null,
          2,
        )}\n`,
        "logs/events.jsonl": "",
      },
      "key-transition-receiver.hproj",
    );
    const receiverStorage = createProjectStorage(receiverRoot);

    expect(changePackage.signature?.key_id).toBe(previousKey.member.key_id);

    setChangesProjectStorage(receiverStorage);

    await expect(
      applyChangePackage(changePackage, [], { actor: receiverOwner }),
    ).resolves.toMatchObject({
      importedMembers: 1,
      importedProjectSettings: 1,
    });
    await expect(
      receiverStorage.readJson<{ members: Member[] }>("members.json"),
    ).resolves.toMatchObject({
      members: [
        {
          id: owner.id,
          key_id: rotation.member.key_id,
          public_key: rotation.member.public_key,
          password_hash: "local-password-hash",
          password_salt: "local-password-salt",
        },
      ],
    });
  });

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
