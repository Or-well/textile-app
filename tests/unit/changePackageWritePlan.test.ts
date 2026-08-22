import { describe, expect, it, vi } from "vitest";
import type {
  ChangePackageManifest,
  ChangePackageType,
  Comment,
  Entry,
  Member,
  ProjectConfig,
  ProjectEvent,
  Task,
  Term,
  TermDeletion,
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
  completeChangePackageExport,
  detectConflicts,
  exportChangePackage,
  getChangePackageSuggestedFileName,
  readChangePackage,
  setChangesProjectStorage,
  type ReadChangePackage,
} from "../../src/services/changes";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { ensureWorkspaceBaseline } from "../../src/services/workspaceBaseline";
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
    termDeletions: changePackage.termDeletions,
    contexts: changePackage.contexts,
      sourceFiles: changePackage.sourceFiles,
      tasks: changePackage.tasks,
      projectFiles: changePackage.projectFiles,
      memberFiles: changePackage.memberFiles,
      events: changePackage.events,
      baseFiles: changePackage.base
        ? {
            "base/changes.json": `${JSON.stringify(changePackage.base, null, 2)}\n`,
          }
        : {},
    });
}

function createTerm(overrides: Partial<Term> = {}): Term {
  return {
    id: "term-1",
    source: "魔術回路",
    target: "魔术回路",
    part_of_speech: "名词",
    note: "",
    variants: [],
    case_sensitive: false,
    created_by: "owner-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createTermDeletion(
  term: Term,
  overrides: Partial<TermDeletion> = {},
): TermDeletion {
  return {
    id: `term-delete-${term.id}`,
    term_id: term.id,
    term,
    deleted_by: "member-2",
    deleted_at: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

async function createProjectUpdateFixture(options: {
  requireSignedChangePackages?: boolean;
  sign?: boolean;
  projectUpdateMembers?: (owner: Member) => Member[];
} = {}) {
  const baseProject = createProject({
    revision: "base-revision",
    revision_hash: "base-revision",
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
  const signingOwner =
    options.sign === false
      ? owner
      : (await generateOwnSigningKey(sourceRoot, [owner], owner)).member;

  setChangesProjectStorage(sourceStorage);

  const exported = await exportChangePackage(signingOwner.id, {
    mode: "project_update",
    sign: options.sign !== false,
    actor: signingOwner,
    projectUpdateMembers: options.projectUpdateMembers?.(signingOwner),
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
    exported,
    sourceStorage,
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
    ).rejects.toThrow("已选择给本次导出签名");
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

  it("exports a task comment even when the entry text was not changed", async () => {
    const fixture = await createExportFixture();
    const project = await fixture.storage.readJson<ProjectConfig>("project.json");
    const comment: Comment = {
      id: "comment-only-1",
      entry_id: "file-1:1",
      file_id: "file-1",
      user_id: fixture.contributor.id,
      body: "Comment without editing the translation",
      reply_to: null,
      status: "open",
      created_at: "2026-02-01T00:00:00.000Z",
    };

    await ensureWorkspaceBaseline(fixture.storage, project);
    await fixture.storage.writeJsonl("comments/file-1/000001.jsonl", [comment]);
    setChangesProjectStorage(fixture.storage);

    const exported = await exportChangePackage(fixture.contributor.id, {
      mode: "member_changes",
      sign: false,
      actor: fixture.contributor,
    });
    const changePackage = await readChangePackage(
      new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob,
    );

    expect(changePackage.comments).toEqual({
      "comments/file-1/000001.jsonl": [comment],
    });
    expect(changePackage.entries).toEqual({});
  });

  it("exports only the selected task changes without treating the workspace as clean", async () => {
    const fixture = await createExportFixture();
    const project = await fixture.storage.readJson<ProjectConfig>("project.json");
    const entries = await fixture.storage.readJsonl<Entry>(
      "entries/file-1/chunk_0001.jsonl",
    );
    const tasks = await fixture.storage.readJsonl<Task>("tasks/tasks.jsonl");
    const secondEntry = createEntry({
      id: "file-1:2",
      file_id: "file-1",
      index: 2,
      target: "Second baseline",
      status: "translated",
      translated_by: fixture.contributor.id,
      updated_by: fixture.contributor.id,
    });
    const secondTask: Task = {
      ...tasks[0]!,
      id: "task-2",
      title: "Translate second entry",
      range_start: 2,
      range_end: 2,
    };

    await fixture.storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
      ...entries,
      secondEntry,
    ]);
    await fixture.storage.writeJsonl("tasks/tasks.jsonl", [
      ...tasks,
      secondTask,
    ]);
    await ensureWorkspaceBaseline(fixture.storage, project);
    await fixture.storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
      { ...entries[0]!, target: "First local change" },
      { ...secondEntry, target: "Second local change" },
    ]);
    setChangesProjectStorage(fixture.storage);

    const selectedExport = await exportChangePackage(fixture.contributor.id, {
      mode: "task_changes",
      taskId: "task-1",
      taskIds: ["task-1"],
      sign: false,
      actor: fixture.contributor,
    });
    const selectedPackage = await readChangePackage(
      new Uint8Array(await selectedExport.blob.arrayBuffer()) as unknown as Blob,
    );
    const allExport = await exportChangePackage(fixture.contributor.id, {
      mode: "member_changes",
      sign: false,
      actor: fixture.contributor,
    });
    const allPackage = await readChangePackage(
      new Uint8Array(await allExport.blob.arrayBuffer()) as unknown as Blob,
    );

    expect(Object.values(selectedPackage.entries).flat().map((entry) => entry.id)).toEqual([
      "file-1:1",
    ]);
    expect(
      Object.values(selectedPackage.base?.entries ?? {}).flat(),
    ).toMatchObject([{ id: "file-1:1", target: entries[0]!.target }]);
    expect(Object.values(allPackage.entries).flat().map((entry) => entry.id)).toEqual([
      "file-1:1",
      "file-1:2",
    ]);
  });

  it("scans project entries once when resolving multiple selected task scopes", async () => {
    const fixture = await createExportFixture();
    const project = await fixture.storage.readJson<ProjectConfig>("project.json");
    const entries = await fixture.storage.readJsonl<Entry>(
      "entries/file-1/chunk_0001.jsonl",
    );
    const tasks = await fixture.storage.readJsonl<Task>("tasks/tasks.jsonl");
    const secondEntry = createEntry({
      id: "file-1:2",
      file_id: "file-1",
      index: 2,
      target: "Second baseline",
      status: "translated",
      translated_by: fixture.contributor.id,
      updated_by: fixture.contributor.id,
    });
    const secondTask: Task = {
      ...tasks[0]!,
      id: "task-2",
      title: "Translate second entry",
      range_start: 2,
      range_end: 2,
    };

    await fixture.storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
      ...entries,
      secondEntry,
    ]);
    await fixture.storage.writeJsonl("tasks/tasks.jsonl", [
      ...tasks,
      secondTask,
    ]);
    await ensureWorkspaceBaseline(fixture.storage, project);
    await fixture.storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
      { ...entries[0]!, target: "First local change" },
      { ...secondEntry, target: "Second local change" },
    ]);
    const readJsonl = vi.spyOn(fixture.storage, "readJsonl");
    setChangesProjectStorage(fixture.storage);

    await exportChangePackage(fixture.contributor.id, {
      mode: "task_changes",
      taskId: "task-1",
      taskIds: ["task-1", "task-2"],
      sign: false,
      actor: fixture.contributor,
    });

    const entryReads = readJsonl.mock.calls.filter(
      ([path]) => path === "entries/file-1/chunk_0001.jsonl",
    );
    expect(entryReads).toHaveLength(2);
  });

  it("exports attributed pre-upgrade work instead of treating it as the baseline", async () => {
    const fixture = await createExportFixture();
    const project = await fixture.storage.readJson<ProjectConfig>("project.json");

    await ensureWorkspaceBaseline(
      fixture.storage,
      project,
      fixture.contributor.id,
    );
    setChangesProjectStorage(fixture.storage);

    const exported = await exportChangePackage(fixture.contributor.id, {
      mode: "member_changes",
      sign: false,
      actor: fixture.contributor,
    });
    const changePackage = await readChangePackage(
      new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob,
    );

    expect(Object.values(changePackage.entries).flat()).toMatchObject([
      { id: "file-1:1", target: "Translated" },
    ]);
    expect(changePackage.base).toBeUndefined();
  });

  it("round-trips an exported ordinary package through the verified project base", async () => {
    const fixture = await createExportFixture();
    const project = await fixture.storage.readJson<ProjectConfig>("project.json");
    const path = "entries/file-1/chunk_0001.jsonl";
    const [baseEntry] = await fixture.storage.readJsonl<Entry>(path);
    await ensureWorkspaceBaseline(fixture.storage, project);
    await fixture.storage.writeJsonl(path, [
      {
        ...baseEntry!,
        target: "Member change",
        updated_by: fixture.contributor.id,
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    ]);
    setChangesProjectStorage(fixture.storage);
    const exported = await exportChangePackage(fixture.contributor.id, {
      mode: "member_changes",
      sign: false,
      actor: fixture.contributor,
    });
    const changePackage = await readChangePackage(
      new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob,
    );
    await fixture.storage.writeJsonl(path, [baseEntry!]);
    await expect(detectConflicts(changePackage)).resolves.toEqual([]);
    await expect(
      applyChangePackage(changePackage, [], { actor: fixture.members[0] }),
    ).resolves.toMatchObject({ appliedEntries: 1 });
    await expect(fixture.storage.readJsonl<Entry>(path)).resolves.toMatchObject([
      { target: "Member change" },
    ]);
  });

  it("rejects unsigned package import when project requires signatures", async () => {
    const fixture = await createChangePackageFixture({
      requireSignedChangePackages: true,
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(
        fixture.changePackage,
        [],
        { actor: fixture.actor },
      ),
    ).rejects.toThrow("有效成员签名");
  });

  it("keeps accepting unsigned package import when signatures are optional", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: { target: "Package changed" },
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

    await fixture.storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
      fixture.originalEntry,
      {
        ...fixture.originalEntry,
        id: "file-1:2",
        index: 2,
        target: "Outside scope",
      },
    ]);

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).rejects.toThrow("任务范围外");
  });

  it("rejects package entries that are missing from the declared target file", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: {
        id: "file-1:missing",
        index: 2,
        target: "Missing",
      },
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).rejects.toThrow("不能静默跳过");
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

  it("does not export own credential changes unless explicitly requested", async () => {
    const fixture = await createExportFixture();
    const contributor: Member = {
      ...fixture.contributor,
      password_hash: "new-password-hash",
      password_salt: "new-password-salt",
      password_updated_at: "2026-02-01T00:00:00.000Z",
    };

    await fixture.storage.writeJson("members.json", {
      schema_version: 1,
      members: [fixture.members[0]!, contributor],
    });
    setChangesProjectStorage(fixture.storage);

    const exported = await exportChangePackage(contributor.id, {
      mode: "member_changes",
      sign: false,
      actor: contributor,
    });
    const changePackage = await readChangePackage(
      new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob,
    );

    expect(changePackage.memberFiles).toEqual({});
    expect(changePackage.manifest.summary?.changed_credentials).toBe(0);
  });

  it("exports only the current member credential patch when requested", async () => {
    const fixture = await createExportFixture();
    const contributor: Member = {
      ...fixture.contributor,
      password_hash: "new-password-hash",
      password_salt: "new-password-salt",
      password_updated_at: "2026-02-01T00:00:00.000Z",
    };

    await fixture.storage.writeJson("members.json", {
      schema_version: 1,
      members: [fixture.members[0]!, contributor],
    });
    setChangesProjectStorage(fixture.storage);

    const exported = await exportChangePackage(contributor.id, {
      mode: "member_changes",
      sign: false,
      actor: contributor,
      includeOwnCredentials: true,
    });
    const changePackage = await readChangePackage(
      new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob,
    );
    const memberFile = JSON.parse(changePackage.memberFiles["members/members.json"]!);

    expect(memberFile.members).toEqual([
      {
        id: contributor.id,
        password_hash: "new-password-hash",
        password_salt: "new-password-salt",
        password_updated_at: "2026-02-01T00:00:00.000Z",
      },
    ]);
    expect(changePackage.manifest.summary).toMatchObject({
      changed_credentials: 1,
      changed_members: 0,
    });
  });

  it("exports member term edits and deletions in the change package", async () => {
    const fixture = await createExportFixture();
    const contributor: Member = {
      ...fixture.contributor,
      roles: ["translator", "term_manager"],
    };
    const editedTerm = createTerm({
      id: "term-edited",
      target: "魔术线路",
      updated_by: contributor.id,
      updated_at: "2026-02-01T00:00:00.000Z",
    });
    const deletedTerm = createTerm({
      id: "term-deleted",
      source: "使い魔",
      target: "使魔",
    });
    const deletion = createTermDeletion(deletedTerm, {
      deleted_by: contributor.id,
    });

    await fixture.storage.writeJson("members.json", {
      schema_version: 1,
      members: [fixture.members[0]!, contributor],
    });
    await fixture.storage.writeJsonl("terms/terms.jsonl", [editedTerm]);
    await fixture.storage.writeJsonl("changes/term-deletions.jsonl", [
      deletion,
    ]);
    setChangesProjectStorage(fixture.storage);

    const exported = await exportChangePackage(contributor.id, {
      mode: "member_changes",
      sign: false,
      actor: contributor,
    });
    const changePackage = await readChangePackage(
      new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob,
    );

    expect(changePackage.manifest.schema_version).toBe(2);
    expect(changePackage.manifest.summary?.changed_terms).toBe(2);
    expect(changePackage.terms["terms/terms.jsonl"]).toEqual([editedTerm]);
    expect(changePackage.termDeletions?.["term-changes/deletions.jsonl"])
      .toEqual([deletion]);
  });

  it("merges ordinary credential patches without replacing member records", async () => {
    const fixture = await createChangePackageFixture();
    const membersFile = await fixture.storage.readJson<{ members: Member[] }>(
      "members.json",
    );
    const nextMembers = membersFile.members.map((member) =>
      member.id === "member-2"
        ? {
            ...member,
            password_hash: "old-password-hash",
            password_salt: "old-password-salt",
            password_updated_at: "2026-01-01T00:00:00.000Z",
          }
        : member,
    );

    await fixture.storage.writeJson("members.json", {
      schema_version: 1,
      members: nextMembers,
    });
    fixture.changePackage.entries = {};
    fixture.changePackage.comments = {};
    fixture.changePackage.memberFiles = {
      "members/members.json": `${JSON.stringify(
        {
          schema_version: 1,
          members: [
            {
              id: "member-2",
              password_hash: "new-password-hash",
              password_salt: "new-password-salt",
              password_updated_at: "2026-02-01T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      )}\n`,
    };
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
        confirmMaintenance: true,
      }),
    ).resolves.toMatchObject({ importedMembers: 1 });
    await expect(
      fixture.storage.readJson<{ members: Member[] }>("members.json"),
    ).resolves.toMatchObject({
      members: [
        expect.objectContaining({ id: "owner-1", roles: ["owner"] }),
        expect.objectContaining({
          id: "member-2",
          roles: ["translator"],
          password_hash: "new-password-hash",
          password_salt: "new-password-salt",
        }),
      ],
    });
  });

  it("rejects member role fields in ordinary credential patches", async () => {
    const fixture = await createChangePackageFixture();

    fixture.changePackage.entries = {};
    fixture.changePackage.comments = {};
    fixture.changePackage.memberFiles = {
      "members/members.json": `${JSON.stringify(
        {
          schema_version: 1,
          members: [
            {
              id: "member-2",
              roles: ["owner"],
              password_hash: "new-password-hash",
              password_salt: "new-password-salt",
            },
          ],
        },
        null,
        2,
      )}\n`,
    };
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
        confirmMaintenance: true,
      }),
    ).rejects.toThrow("账户信息");
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

  it("commits merged content and authoritative import logs", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: { target: "Package changed" },
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(
        fixture.changePackage,
        [{ entryId: fixture.originalEntry.id, action: "use_package" }],
        { actor: fixture.actor },
      ),
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
    ).resolves.toMatchObject([
      { type: "entry.updated" },
      { type: "change_package.applied" },
    ]);
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

  it("applies an unchanged-base comment status update without a false conflict", async () => {
    const fixture = await createChangePackageFixture();
    const path = "comments/file-1/1.jsonl";
    const baseComment: Comment = {
      ...fixture.changePackage.comments[path][0]!,
      status: "open",
      resolved: false,
      updated_at: "2026-02-01T00:00:00.000Z",
      resolved_at: "",
      resolved_by: "",
    };
    const packageComment: Comment = {
      ...baseComment,
      status: "resolved",
      resolved: true,
      updated_at: "2026-02-02T00:00:00.000Z",
      updated_by: "member-2",
      resolved_at: "2026-02-02T00:00:00.000Z",
      resolved_by: "member-2",
    };
    fixture.changePackage.comments[path] = [packageComment];
    fixture.changePackage.base = {
      schema_version: 1,
      entries: {},
      comments: { [path]: [baseComment] },
      terms: {},
      tasks: {},
    };
    await fixture.storage.writeJsonl(path, [baseComment]);
    await ensureWorkspaceBaseline(
      fixture.storage,
      await fixture.storage.readJson<ProjectConfig>("project.json"),
    );
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([]);
    await expect(
      applyChangePackage(fixture.changePackage, [], { actor: fixture.actor }),
    ).resolves.toMatchObject({ importedComments: 1 });
  });

  it("treats translation workflow fields as one merge unit", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: { target: "Package translation" },
    });
    const path = "entries/file-1/chunk_0001.jsonl";
    fixture.changePackage.base = {
      schema_version: 1,
      entries: { [path]: [fixture.originalEntry] },
      comments: {},
      terms: {},
      tasks: {},
    };
    await ensureWorkspaceBaseline(
      fixture.storage,
      await fixture.storage.readJson<ProjectConfig>("project.json"),
    );
    await fixture.storage.writeJsonl(path, [
      {
        ...fixture.originalEntry,
        status: "reviewed",
        reviewed_by: fixture.actor.id,
        updated_by: fixture.actor.id,
      },
    ]);
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([
      expect.objectContaining({
        kind: "entry",
        reasons: expect.arrayContaining(["target", "status"]),
      }),
    ]);
  });

  it("rejects a changed existing record when the new package omits its base", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: { target: "Package translation" },
    });
    fixture.changePackage.base = {
      schema_version: 1,
      entries: {},
      comments: {},
      terms: {},
      tasks: {},
    };
    await ensureWorkspaceBaseline(
      fixture.storage,
      await fixture.storage.readJson<ProjectConfig>("project.json"),
    );
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(detectConflicts(fixture.changePackage)).rejects.toThrow(
      "词条缺少共同基线",
    );
  });

  it("preserves concurrent task details while applying a based status change", async () => {
    const baseTask: Task = {
      id: "task-based-status",
      type: "translate",
      title: "Original title",
      description: "Original description",
      file_id: "file-1",
      range_start: 1,
      range_end: 1,
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
      originalTask: baseTask,
      packageTask: {
        ...baseTask,
        status: "submitted",
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    });
    fixture.changePackage.base = {
      schema_version: 1,
      entries: {},
      comments: {},
      terms: {},
      tasks: { "tasks/tasks.jsonl": [baseTask] },
    };
    await ensureWorkspaceBaseline(
      fixture.storage,
      await fixture.storage.readJson<ProjectConfig>("project.json"),
    );
    await fixture.storage.writeJsonl("tasks/tasks.jsonl", [
      { ...baseTask, title: "Manager clarified title" },
    ]);
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([]);
    await applyChangePackage(fixture.changePackage, [], { actor: fixture.actor });
    await expect(
      fixture.storage.readJsonl<Task>("tasks/tasks.jsonl"),
    ).resolves.toMatchObject([
      { title: "Manager clarified title", status: "submitted" },
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
      applyChangePackage(
        fixture.changePackage,
        [
          {
            conflictId: `comment-delete:${path}:${parentComment.id}`,
            action: "use_package",
          },
        ],
        { actor: fixture.actor },
      ),
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

  it("detects a reply added after an ordinary comment deletion was exported", async () => {
    const fixture = await createChangePackageFixture();
    const path = "comments/file-1/1.jsonl";
    const parentComment: Comment = {
      ...fixture.changePackage.comments[path][0]!,
      status: "open",
      resolved: false,
    };
    const concurrentReply: Comment = {
      ...parentComment,
      id: "concurrent-reply",
      body: "Added after export",
      reply_to: parentComment.id,
      user_id: "owner-1",
    };
    fixture.changePackage.comments = {};
    fixture.changePackage.base = {
      schema_version: 1,
      entries: {},
      comments: { [path]: [parentComment] },
      terms: {},
      tasks: {},
    };
    fixture.changePackage.events = [
      {
        id: "comment-delete-event",
        type: "comment.deleted",
        user_id: "member-2",
        entry_id: fixture.originalEntry.id,
        file_id: fixture.originalEntry.file_id,
        created_at: "2026-02-03T00:00:00.000Z",
        detail: { comment_id: parentComment.id },
      },
    ];
    await fixture.storage.writeJsonl(path, [parentComment]);
    await ensureWorkspaceBaseline(
      fixture.storage,
      await fixture.storage.readJson<ProjectConfig>("project.json"),
    );
    await fixture.storage.writeJsonl(path, [parentComment, concurrentReply]);
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([
      expect.objectContaining({
        kind: "comment",
        conflictId: `comment-delete:${path}:${parentComment.id}`,
        reasons: ["deleted"],
      }),
    ]);
  });

  it("imports ordinary package term deletions", async () => {
    const fixture = await createChangePackageFixture();
    const membersFile = await fixture.storage.readJson<{ members: Member[] }>(
      "members.json",
    );
    const nextMembers = membersFile.members.map((member) =>
      member.id === "member-2"
        ? { ...member, roles: ["translator", "term_manager"] }
        : member,
    );
    const deletedTerm = createTerm({ id: "term-delete-1" });
    const deletion = createTermDeletion(deletedTerm);

    await fixture.storage.writeJson("members.json", {
      schema_version: 1,
      members: nextMembers,
    });
    await fixture.storage.writeJsonl("terms/terms.jsonl", [deletedTerm]);
    fixture.changePackage.manifest.schema_version = 2;
    fixture.changePackage.entries = {};
    fixture.changePackage.comments = {};
    fixture.changePackage.termDeletions = {
      "term-changes/deletions.jsonl": [deletion],
    };
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).resolves.toMatchObject({ importedTerms: 1 });
    await expect(
      fixture.storage.readJsonl<Term>("terms/terms.jsonl"),
    ).resolves.toEqual([]);
  });

  it("detects term conflicts before applying ordinary package term changes", async () => {
    const fixture = await createChangePackageFixture();
    const membersFile = await fixture.storage.readJson<{ members: Member[] }>(
      "members.json",
    );
    const nextMembers = membersFile.members.map((member) =>
      member.id === "member-2"
        ? { ...member, roles: ["translator", "term_manager"] }
        : member,
    );
    const mainTerm = createTerm({
      id: "term-conflict",
      target: "主项目译名",
    });
    const packageTerm = createTerm({
      id: mainTerm.id,
      target: "修改包译名",
      updated_by: "member-2",
      updated_at: "2026-02-01T00:00:00.000Z",
    });

    await fixture.storage.writeJson("members.json", {
      schema_version: 1,
      members: nextMembers,
    });
    await fixture.storage.writeJsonl("terms/terms.jsonl", [mainTerm]);
    fixture.changePackage.manifest.schema_version = 2;
    fixture.changePackage.entries = {};
    fixture.changePackage.comments = {};
    fixture.changePackage.terms = {
      "terms/terms.jsonl": [packageTerm],
    };
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([
      expect.objectContaining({
        kind: "term",
        termId: "term-conflict",
        reasons: ["target"],
      }),
    ]);
    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).rejects.toThrow("仍有冲突未处理");
  });

  it("applies an unchanged-base term edit without a false conflict", async () => {
    const fixture = await createChangePackageFixture();
    const membersFile = await fixture.storage.readJson<{ members: Member[] }>(
      "members.json",
    );
    await fixture.storage.writeJson("members.json", {
      schema_version: 1,
      members: membersFile.members.map((member) =>
        member.id === "member-2"
          ? { ...member, roles: ["translator", "term_manager"] }
          : member,
      ),
    });
    const baseTerm = createTerm({ id: "term-three-way", target: "旧译名" });
    const packageTerm = {
      ...baseTerm,
      target: "新译名",
      updated_by: "member-2",
      updated_at: "2026-02-01T00:00:00.000Z",
    };
    fixture.changePackage.entries = {};
    fixture.changePackage.comments = {};
    fixture.changePackage.terms = { "terms/terms.jsonl": [packageTerm] };
    fixture.changePackage.base = {
      schema_version: 1,
      entries: {},
      comments: {},
      terms: { "terms/terms.jsonl": [baseTerm] },
      tasks: {},
    };
    await fixture.storage.writeJsonl("terms/terms.jsonl", [baseTerm]);
    await ensureWorkspaceBaseline(
      fixture.storage,
      await fixture.storage.readJson<ProjectConfig>("project.json"),
    );
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([]);
    await expect(
      applyChangePackage(fixture.changePackage, [], { actor: fixture.actor }),
    ).resolves.toMatchObject({ importedTerms: 1 });
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

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([]);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
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

  it("auto-applies a continuous translation and proofread event chain", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: {
        target: "Proofread final",
        status: "proofread",
        translated_by: "member-2",
        proofread_by: ["member-2"],
        proofread_count: 1,
        reviewed_by: "",
      },
    });
    const packageEntry = Object.values(fixture.changePackage.entries)[0]![0]!;
    const draftEntry: Entry = {
      ...fixture.originalEntry,
      target: "Translation draft",
      status: "translated",
      translated_by: "member-2",
      proofread_by: [],
      proofread_count: 0,
      reviewed_by: "",
    };

    fixture.changePackage.events = [
      {
        id: "translation-event",
        type: "entry.updated",
        user_id: "member-2",
        entry_id: fixture.originalEntry.id,
        file_id: fixture.originalEntry.file_id,
        created_at: "2026-01-15T00:00:00.000Z",
        detail: {
          before_target: fixture.originalEntry.target,
          after_target: draftEntry.target,
          before_status: fixture.originalEntry.status,
          after_status: draftEntry.status,
          before_translated_by: fixture.originalEntry.translated_by,
          after_translated_by: draftEntry.translated_by,
          before_proofread_by: fixture.originalEntry.proofread_by ?? [],
          after_proofread_by: draftEntry.proofread_by,
          before_proofread_count: fixture.originalEntry.proofread_count ?? 0,
          after_proofread_count: draftEntry.proofread_count,
          before_reviewed_by: fixture.originalEntry.reviewed_by,
          after_reviewed_by: draftEntry.reviewed_by,
          operation: "translation_edit",
        },
      },
      {
        id: "proofread-event",
        type: "entry.updated",
        user_id: "member-2",
        entry_id: fixture.originalEntry.id,
        file_id: fixture.originalEntry.file_id,
        created_at: packageEntry.updated_at,
        detail: {
          before_target: draftEntry.target,
          after_target: packageEntry.target,
          before_status: draftEntry.status,
          after_status: packageEntry.status,
          before_translated_by: draftEntry.translated_by,
          after_translated_by: packageEntry.translated_by,
          before_proofread_by: draftEntry.proofread_by,
          after_proofread_by: packageEntry.proofread_by,
          before_proofread_count: draftEntry.proofread_count,
          after_proofread_count: packageEntry.proofread_count,
          before_reviewed_by: draftEntry.reviewed_by,
          after_reviewed_by: packageEntry.reviewed_by,
          operation: "proofread",
        },
      },
    ];
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([]);
    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).resolves.toMatchObject({ appliedEntries: 1, keptEntries: 0 });
    await expect(
      fixture.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([
      {
        target: "Proofread final",
        status: "proofread",
        proofread_by: ["member-2"],
        proofread_count: 1,
      },
    ]);
  });

  it("three-way merges ordinary entry fields from the packaged base", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: { target: "Package translation" },
    });
    const path = "entries/file-1/chunk_0001.jsonl";
    fixture.changePackage.base = {
      schema_version: 1,
      entries: { [path]: [fixture.originalEntry] },
      comments: {},
      terms: {},
      tasks: {},
    };
    await ensureWorkspaceBaseline(
      fixture.storage,
      await fixture.storage.readJson<ProjectConfig>("project.json"),
    );
    await fixture.storage.writeJsonl(path, [
      { ...fixture.originalEntry, context: "Main-only context" },
    ]);
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([]);
    await applyChangePackage(fixture.changePackage, [], {
      actor: fixture.actor,
    });
    await expect(fixture.storage.readJsonl<Entry>(path)).resolves.toMatchObject([
      { target: "Package translation", context: "Main-only context" },
    ]);
  });

  it("does not let dispute metadata turn a safe legacy translation into a conflict", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: {
        target: "Package translation",
        disputed: true,
        dispute_reason: "",
        dispute_resolved_at: "",
        dispute_resolved_by: "",
      },
      packageOperation: "translation_edit",
    });
    fixture.changePackage.events.push({
      id: "mark-disputed-event",
      type: "entry.mark_disputed",
      user_id: "member-2",
      entry_id: fixture.originalEntry.id,
      file_id: fixture.originalEntry.file_id,
      created_at: "2026-02-01T00:00:01.000Z",
      detail: { reason: "", status: "translated" },
    });
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([]);
  });

  it("reports a legacy task status regression instead of applying it silently", async () => {
    const submittedTask: Task = {
      id: "task-1",
      type: "translate",
      title: "Translate chapter",
      description: "",
      file_id: "file-1",
      range_start: 1,
      range_end: 1,
      entry_ids: [],
      assignee: "member-2",
      status: "submitted",
      target: "",
      submit_method: "change_package",
      created_by: "owner-1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-02T00:00:00.000Z",
      due_at: "",
    };
    const fixture = await createChangePackageFixture({
      originalTask: submittedTask,
      packageTask: { ...submittedTask, status: "assigned" },
    });
    setChangesProjectStorage(fixture.storage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([
      expect.objectContaining({
        kind: "task",
        conflictId: "task:task-1",
        reasons: ["status"],
      }),
    ]);
  });

  it("keeps a real divergence as an explicit conflict", async () => {
    const fixture = await createChangePackageFixture({
      packageOperation: "proofread",
      packageEntry: {
        target: "Proofread package edit",
        status: "proofread",
        translated_by: "translator-1",
        proofread_by: ["member-2"],
        proofread_count: 1,
      },
    });

    await fixture.storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
      {
        ...fixture.originalEntry,
        target: "Independent main edit",
      },
    ]);
    setChangesProjectStorage(fixture.storage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([
      expect.objectContaining({
        kind: "entry",
        entryId: fixture.originalEntry.id,
      }),
    ]);
  });

  it("does not submit a task when its entry changes are kept or skipped", async () => {
    const originalTask: Task = {
      id: "task-1",
      type: "proofread",
      title: "Proofread chapter",
      description: "",
      file_id: "file-1",
      range_start: 1,
      range_end: 1,
      entry_ids: [],
      assignee: "member-2",
      status: "in_progress",
      target: "",
      submit_method: "change_package",
      proofread_round: 1,
      created_by: "owner-1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      due_at: "",
    };
    const fixture = await createChangePackageFixture({
      originalTask,
      packageTask: { ...originalTask, status: "submitted" },
      packageEntry: { target: "Package changed" },
    });

    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(
        fixture.changePackage,
        [{ entryId: fixture.originalEntry.id, action: "keep_main" }],
        { actor: fixture.actor },
      ),
    ).rejects.toThrow("不能同时标记为已提交");
    await expect(
      fixture.storage.readJsonl<Task>("tasks/tasks.jsonl"),
    ).resolves.toMatchObject([{ status: "in_progress" }]);
  });

  it("resets workflow safely when an entry conflict is manually merged", async () => {
    const fixture = await createChangePackageFixture({
      packageEntry: {
        target: "Reviewed package target",
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
            action: "manual_merge",
            target: "Manual target",
            status: "reviewed",
          },
        ],
        { actor: fixture.actor },
      ),
    ).resolves.toMatchObject({ appliedEntries: 1 });
    await expect(
      fixture.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"),
    ).resolves.toMatchObject([
      {
        target: "Manual target",
        status: "translated",
        proofread_by: [],
        proofread_count: 0,
        reviewed_by: "",
      },
    ]);
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
  it("rejects unsigned project update export when project requires signatures", async () => {
    await expect(
      createProjectUpdateFixture({
        requireSignedChangePackages: true,
        sign: false,
      }),
    ).rejects.toThrow("创建身份密钥");
  });

  it("exports and applies unsigned project updates when signatures are optional", async () => {
    const fixture = await createProjectUpdateFixture({ sign: false });

    expect(fixture.changePackage.manifest.package_type).toBe("project_update");
    expect(fixture.changePackage.signature).toBeUndefined();

    setChangesProjectStorage(fixture.receiverStorage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.receiverOwner,
      }),
    ).resolves.toMatchObject({
      appliedEntries: 1,
      importedProjectSettings: 1,
    });
  });

  it("rebases directly onto a newer signed snapshot when intermediate updates were skipped", async () => {
    const fixture = await createProjectUpdateFixture();
    const receiverProject = {
      ...fixture.receiverProject,
      revision: "skipped-intermediate-revision",
      revision_hash: "skipped-intermediate-revision",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    await fixture.receiverStorage.writeJson("project.json", receiverProject);
    await ensureWorkspaceBaseline(fixture.receiverStorage, receiverProject);
    const path = "entries/file-1/chunk_0001.jsonl";
    const [entry] = await fixture.receiverStorage.readJsonl<Entry>(path);
    await fixture.receiverStorage.writeJsonl(path, [
      {
        ...entry!,
        context: "Unsubmitted local context",
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    ]);
    setChangesProjectStorage(fixture.receiverStorage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([]);
    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.receiverOwner,
      }),
    ).resolves.toMatchObject({ appliedEntries: 1 });
    await expect(
      fixture.receiverStorage.readJson<ProjectConfig>("project.json"),
    ).resolves.toMatchObject({
      revision: fixture.changePackage.manifest.target_revision,
    });
    await expect(fixture.receiverStorage.readJsonl<Entry>(path)).resolves.toMatchObject([
      { target: "Updated", context: "Unsubmitted local context" },
    ]);
  });

  it("treats an already applied project update as an idempotent no-op", async () => {
    const fixture = await createProjectUpdateFixture();
    setChangesProjectStorage(fixture.receiverStorage);

    await applyChangePackage(fixture.changePackage, [], {
      actor: fixture.receiverOwner,
    });
    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.receiverOwner,
      }),
    ).resolves.toMatchObject({
      alreadyApplied: true,
      appliedEntries: 0,
      importedTasks: 0,
    });
  });

  it("rejects a stale signed snapshot instead of rolling the project back", async () => {
    const fixture = await createProjectUpdateFixture();
    const receiverProject = {
      ...fixture.receiverProject,
      revision: "newer-local-authority",
      revision_hash: "newer-local-authority",
      updated_at: "2099-01-01T00:00:00.000Z",
    };
    await fixture.receiverStorage.writeJson("project.json", receiverProject);
    await ensureWorkspaceBaseline(fixture.receiverStorage, receiverProject);
    setChangesProjectStorage(fixture.receiverStorage);

    await expect(detectConflicts(fixture.changePackage)).rejects.toThrow(
      "为避免回滚已拒绝导入",
    );
  });

  it("keeps publisher trust transitions on the strict revision chain", async () => {
    const fixture = await createProjectUpdateFixture({
      projectUpdateMembers: (owner) => [
        {
          ...owner,
          public_key: `${owner.public_key}-rotated`,
          key_id: "rotated-key",
        },
      ],
    });
    const receiverProject = {
      ...fixture.receiverProject,
      revision: "skipped-trust-transition-base",
      revision_hash: "skipped-trust-transition-base",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    await fixture.receiverStorage.writeJson("project.json", receiverProject);
    await ensureWorkspaceBaseline(fixture.receiverStorage, receiverProject);
    setChangesProjectStorage(fixture.receiverStorage);

    await expect(detectConflicts(fixture.changePackage)).rejects.toThrow(
      "必须按顺序接收",
    );
  });

  it("uses unique suggested names for multiple exports on the same day", () => {
    const first = getChangePackageSuggestedFileName(
      "寿司盒子酱",
      { mode: "project_update" },
      "2026-08-22T10:01:51.236Z",
    );
    const second = getChangePackageSuggestedFileName(
      "寿司盒子酱",
      { mode: "project_update" },
      "2026-08-22T10:22:25.671Z",
    );

    expect(first).not.toBe(second);
    expect(first).toContain("项目更新-寿司盒子酱");
    expect(first).not.toContain("owner-1");
    expect(first).toContain("20260822100151236");
    expect(second).toContain("20260822102225671");
  });

  it("does not publish an update when project content changes after generation", async () => {
    const fixture = await createProjectUpdateFixture({ sign: false });
    const [entry] = await fixture.sourceStorage.readJsonl<Entry>(
      "entries/file-1/chunk_0001.jsonl",
    );

    await fixture.sourceStorage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
      { ...entry!, target: "Changed after export" },
    ]);
    setChangesProjectStorage(fixture.sourceStorage);

    await expect(
      completeChangePackageExport(fixture.exported),
    ).rejects.toThrow("项目内容在更新包生成后发生了变化");
    await expect(
      fixture.sourceStorage.readJson<ProjectConfig>("project.json"),
    ).resolves.toMatchObject({ revision: "base-revision" });
  });

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

  it("rebases local entry fields onto a project update", async () => {
    const fixture = await createProjectUpdateFixture();

    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);
    const [localEntry] = await fixture.receiverStorage.readJsonl<Entry>(
      "entries/file-1/chunk_0001.jsonl",
    );
    await fixture.receiverStorage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
      {
        ...localEntry!,
        context: "Local context",
        updated_by: "member-2",
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    ]);
    setChangesProjectStorage(fixture.receiverStorage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.receiverOwner,
      }),
    ).resolves.toMatchObject({ appliedEntries: 1 });
    await expect(
      fixture.receiverStorage.readJsonl<Entry>(
        "entries/file-1/chunk_0001.jsonl",
      ),
    ).resolves.toMatchObject([
      {
        target: "Updated",
        context: "Local context",
      },
    ]);
  });

  it("keeps rebased local attribution so the work remains exportable", async () => {
    const fixture = await createProjectUpdateFixture();
    const path = "entries/file-1/chunk_0001.jsonl";

    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);
    const [localEntry] = await fixture.receiverStorage.readJsonl<Entry>(path);
    await fixture.receiverStorage.writeJsonl(path, [
      {
        ...localEntry!,
        context: "Still pending local work",
        updated_by: fixture.receiverOwner.id,
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    ]);
    setChangesProjectStorage(fixture.receiverStorage);
    await applyChangePackage(fixture.changePackage, [], {
      actor: fixture.receiverOwner,
    });

    const exported = await exportChangePackage(fixture.receiverOwner.id, {
      mode: "member_changes",
      sign: false,
      actor: fixture.receiverOwner,
    });
    const memberPackage = await readChangePackage(
      new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob,
    );

    expect(Object.values(memberPackage.entries).flat()).toMatchObject([
      {
        id: "file-1:1",
        context: "Still pending local work",
        updated_by: fixture.receiverOwner.id,
      },
    ]);
  });

  it("rebases the complete local task record when the update left it unchanged", async () => {
    const fixture = await createProjectUpdateFixture({ sign: false });
    const baseTask: Task = {
      id: "task-rebase",
      type: "translate",
      title: "Original task",
      description: "Original description",
      file_id: "file-1",
      range_start: 1,
      range_end: 1,
      entry_ids: [],
      assignee: fixture.receiverOwner.id,
      status: "assigned",
      target: "",
      submit_method: "change_package",
      created_by: fixture.receiverOwner.id,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      due_at: "2026-03-01T00:00:00.000Z",
    };
    fixture.changePackage.tasks = { "tasks/tasks.jsonl": [baseTask] };
    await fixture.receiverStorage.writeJsonl("tasks/tasks.jsonl", [baseTask]);
    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);
    await fixture.receiverStorage.writeJsonl("tasks/tasks.jsonl", [
      {
        ...baseTask,
        title: "Locally clarified task",
        description: "Keep every local task field",
        due_at: "2026-03-15T00:00:00.000Z",
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    ]);
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.receiverStorage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([]);
    await applyChangePackage(fixture.changePackage, [], {
      actor: fixture.receiverOwner,
    });
    await expect(
      fixture.receiverStorage.readJsonl<Task>("tasks/tasks.jsonl"),
    ).resolves.toMatchObject([
      {
        title: "Locally clarified task",
        description: "Keep every local task field",
        due_at: "2026-03-15T00:00:00.000Z",
      },
    ]);
  });

  it("ignores task audit timestamps when project update task content is equal", async () => {
    const fixture = await createProjectUpdateFixture({ sign: false });
    const baseTask: Task = {
      id: "task-timestamp-only",
      type: "proofread",
      title: "共同校对1、2",
      description: "Same task",
      file_id: "file-1",
      file_ids: ["file-1"],
      range_start: 1,
      range_end: 1,
      entry_ids: [],
      assignee: fixture.receiverOwner.id,
      status: "submitted",
      target: "",
      submit_method: "change_package",
      proofread_round: 1,
      created_by: fixture.receiverOwner.id,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      due_at: "2026-03-01T00:00:00.000Z",
      due_time_zone: "Asia/Tokyo",
    };
    fixture.changePackage.tasks = { "tasks/tasks.jsonl": [baseTask] };
    await fixture.receiverStorage.writeJsonl("tasks/tasks.jsonl", [baseTask]);
    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);
    await fixture.receiverStorage.writeJsonl("tasks/tasks.jsonl", [
      { ...baseTask, updated_at: "2026-02-01T00:00:00.000Z" },
    ]);
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.receiverStorage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([]);
    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.receiverOwner,
      }),
    ).resolves.toMatchObject({ importedTasks: 1 });
  });

  it("detects a reply added by the update before applying a local comment-tree deletion", async () => {
    const fixture = await createProjectUpdateFixture({ sign: false });
    const path = "comments/file-1/000001.jsonl";
    const parent: Comment = {
      id: "comment-parent",
      entry_id: "file-1:1",
      file_id: "file-1",
      user_id: fixture.receiverOwner.id,
      body: "Delete this thread locally",
      reply_to: null,
      status: "open",
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const incomingReply: Comment = {
      ...parent,
      id: "comment-incoming-reply",
      body: "Reply added in the project update",
      reply_to: parent.id,
      created_at: "2026-02-01T00:00:00.000Z",
    };
    fixture.changePackage.comments = { [path]: [parent, incomingReply] };
    await fixture.receiverStorage.writeJsonl(path, [parent]);
    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);
    await fixture.receiverStorage.writeJsonl(path, []);
    await fixture.receiverStorage.writeJsonl("logs/events.jsonl", [
      {
        id: "local-comment-delete",
        type: "comment.deleted",
        user_id: fixture.receiverOwner.id,
        entry_id: parent.entry_id,
        file_id: parent.file_id,
        created_at: "2026-02-02T00:00:00.000Z",
        detail: { comment_id: parent.id },
      },
    ]);
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.receiverStorage);

    await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([
      expect.objectContaining({
        kind: "comment",
        conflictId: `workspace:comment-delete:${parent.id}`,
        reasons: ["deleted"],
      }),
    ]);
    await applyChangePackage(
      fixture.changePackage,
      [
        {
          conflictId: `workspace:comment-delete:${parent.id}`,
          action: "use_package",
        },
      ],
      { actor: fixture.receiverOwner },
    );
    await expect(
      fixture.receiverStorage.readJsonl<Comment>(path),
    ).resolves.toEqual([]);
  });

  it("does not re-export a local comment deletion that was discarded during update", async () => {
    const fixture = await createProjectUpdateFixture({ sign: false });
    const path = "comments/file-1/000001.jsonl";
    const parent: Comment = {
      id: "comment-restored",
      entry_id: "file-1:1",
      file_id: "file-1",
      user_id: fixture.receiverOwner.id,
      body: "Keep this thread from the update",
      reply_to: null,
      status: "open",
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const reply: Comment = {
      ...parent,
      id: "comment-restored-reply",
      body: "Concurrent reply",
      reply_to: parent.id,
    };
    fixture.changePackage.comments = { [path]: [parent, reply] };
    await fixture.receiverStorage.writeJsonl(path, [parent]);
    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);
    await fixture.receiverStorage.writeJsonl(path, []);
    await fixture.receiverStorage.writeJsonl("logs/events.jsonl", [
      {
        id: "discarded-comment-delete",
        type: "comment.deleted",
        user_id: fixture.receiverOwner.id,
        entry_id: parent.entry_id,
        file_id: parent.file_id,
        created_at: "2026-02-02T00:00:00.000Z",
        detail: { comment_id: parent.id },
      },
    ]);
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.receiverStorage);
    await applyChangePackage(
      fixture.changePackage,
      [
        {
          conflictId: `workspace:comment-delete:${parent.id}`,
          action: "keep_main",
        },
      ],
      { actor: fixture.receiverOwner },
    );

    await expect(
      exportChangePackage(fixture.receiverOwner.id, {
        mode: "member_changes",
        sign: false,
        actor: fixture.receiverOwner,
      }),
    ).rejects.toThrow("没有可提交的修改");
  });

  it("protects attributed local work when an old project creates its first baseline", async () => {
    const fixture = await createProjectUpdateFixture();
    const [staleEntry] = await fixture.receiverStorage.readJsonl<Entry>(
      "entries/file-old/chunk_0001.jsonl",
    );
    await fixture.receiverStorage.writeJsonl(
      "entries/file-old/chunk_0001.jsonl",
      [{ ...staleEntry!, updated_by: "owner-1" }],
    );
    const [localEntry] = await fixture.receiverStorage.readJsonl<Entry>(
      "entries/file-1/chunk_0001.jsonl",
    );
    await fixture.receiverStorage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
      {
        ...localEntry!,
        target: "Pre-upgrade local translation",
        updated_by: "member-2",
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    ]);
    await ensureWorkspaceBaseline(
      fixture.receiverStorage,
      fixture.receiverProject,
      "member-2",
    );
    setChangesProjectStorage(fixture.receiverStorage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.receiverOwner,
      }),
    ).resolves.toMatchObject({ appliedEntries: 1 });
    await expect(
      fixture.receiverStorage.readJsonl<Entry>(
        "entries/file-1/chunk_0001.jsonl",
      ),
    ).resolves.toMatchObject([
      { target: "Pre-upgrade local translation" },
    ]);
  });

  it("removes stale authoritative comments but preserves comments created locally", async () => {
    const staleFixture = await createProjectUpdateFixture();
    const staleComment: Comment = {
      id: "stale-comment",
      entry_id: "file-1:1",
      file_id: "file-1",
      user_id: "member-2",
      body: "Already part of the old authoritative snapshot",
      reply_to: null,
      status: "open",
      created_at: "2026-01-01T00:00:00.000Z",
    };
    await staleFixture.receiverStorage.writeJsonl(
      "comments/file-1/000001.jsonl",
      [staleComment],
    );
    await ensureWorkspaceBaseline(
      staleFixture.receiverStorage,
      staleFixture.receiverProject,
    );
    setChangesProjectStorage(staleFixture.receiverStorage);
    await applyChangePackage(staleFixture.changePackage, [], {
      actor: staleFixture.receiverOwner,
    });
    await expect(
      staleFixture.receiverStorage.fileExists("comments/file-1/000001.jsonl"),
    ).resolves.toBe(false);

    const localFixture = await createProjectUpdateFixture();
    const localComment: Comment = {
      ...staleComment,
      id: "local-comment",
      body: "Created after the local baseline",
      created_at: "2026-02-01T00:00:00.000Z",
    };
    await ensureWorkspaceBaseline(
      localFixture.receiverStorage,
      localFixture.receiverProject,
    );
    await localFixture.receiverStorage.writeJsonl(
      "comments/file-1/000001.jsonl",
      [localComment],
    );
    setChangesProjectStorage(localFixture.receiverStorage);
    await applyChangePackage(localFixture.changePackage, [], {
      actor: localFixture.receiverOwner,
    });
    await expect(
      localFixture.receiverStorage.readJsonl<Comment>(
        "comments/file-1/000001.jsonl",
      ),
    ).resolves.toEqual([localComment]);
  });

  it("requires a choice when local and project update change the same entry field", async () => {
    const fixture = await createProjectUpdateFixture();

    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);
    const [localEntry] = await fixture.receiverStorage.readJsonl<Entry>(
      "entries/file-1/chunk_0001.jsonl",
    );
    await fixture.receiverStorage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
      {
        ...localEntry!,
        target: "Local translation",
        updated_by: "member-2",
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    ]);
    setChangesProjectStorage(fixture.receiverStorage);

    const conflicts = await detectConflicts(fixture.changePackage);

    expect(conflicts).toMatchObject([
      {
        kind: "entry",
        conflictId: "workspace:entry:file-1:1",
        reasons: expect.arrayContaining(["target"]),
      },
    ]);
    await expect(
      applyChangePackage(
        fixture.changePackage,
        [
          {
            conflictId: "workspace:entry:file-1:1",
            action: "use_package",
          },
        ],
        { actor: fixture.receiverOwner },
      ),
    ).resolves.toMatchObject({ appliedEntries: 1 });
    await expect(
      fixture.receiverStorage.readJsonl<Entry>(
        "entries/file-1/chunk_0001.jsonl",
      ),
    ).resolves.toMatchObject([{ target: "Local translation" }]);
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
