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
import { loadTasks, setTasksProjectStorage, submitTask, updateTask } from "../../src/services/tasks";
import { exportFile, setExporterProjectStorage } from "../../src/services/exporter";
import { loadEntries, setEntriesProjectStorage } from "../../src/services/entries";
import { loadTerms, setTermsProjectStorage, addTerm } from "../../src/services/terms";
import { setCurrentUser, setPermissionProject } from "../../src/services/permissions";
import { ensureWorkspaceBaseline } from "../../src/services/workspaceBaseline";
import { loadProjectFromStorage } from "../../src/services/project";
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
  const entries: Record<string, Entry[]> = options.packageType === "maintenance_changes" ? {} : {
    "entries/file-1/chunk_0001.jsonl": [packageEntry],
  };
  const comments: Record<string, Comment[]> = options.packageType === "maintenance_changes" ? {} : {
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
    user_id: options.packageType === "maintenance_changes" ? actor.id : contributor.id,
    user_name: options.packageType === "maintenance_changes" ? actor.name : contributor.name,
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
  it.each(["member_changes", "user_changes", "task_changes", "legacy"] as const)(
    "rejects project configuration in a %s package before writing",
    async (packageType) => {
      const fixture = await createChangePackageFixture({ packageType });
      const original = await fixture.storage.readText("project.json");
      fixture.changePackage.projectFiles = {
        "project/project.json": JSON.stringify({ ...JSON.parse(original), name: "Wrong snapshot", files: [] }),
      };
      await refreshChangePackageHash(fixture.changePackage);
      setChangesProjectStorage(fixture.storage);
      await expect(applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor, confirmMaintenance: true,
      })).rejects.toThrow("普通修改包不能携带");
      expect(await fixture.storage.readText("project.json")).toBe(original);
      expect(await fixture.storage.fileExists("logs/events.jsonl")).toBe(true);
      expect(await fixture.storage.readJsonl("logs/events.jsonl")).toEqual([]);
    },
  );

  it.each(["sourceFiles", "contexts"] as const)("rejects %s in an ordinary package", async (field) => {
    const fixture = await createChangePackageFixture();
    fixture.changePackage[field] = field === "sourceFiles"
      ? { "source/dialog.txt": "Unrelated source" }
      : { "contexts/other.txt": "Unrelated context" };
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);
    await expect(applyChangePackage(fixture.changePackage, [], { actor: fixture.actor }))
      .rejects.toThrow("普通修改包不能携带");
    expect(await fixture.storage.readJsonl("logs/events.jsonl")).toEqual([]);
  });

  it("rejects an unknown package type rather than treating it as maintenance", async () => {
    const fixture = await createChangePackageFixture();
    fixture.changePackage.manifest.package_type = "unknown" as ChangePackageType;
    setChangesProjectStorage(fixture.storage);
    await expect(applyChangePackage(fixture.changePackage, [], { actor: fixture.actor }))
      .rejects.toThrow("不支持的修改包类型");
    expect(await fixture.storage.readJsonl("logs/events.jsonl")).toEqual([]);
  });

  it.each(["user_changes", "task_changes", "legacy"] as const)(
    "requires signatures for the supported old %s package type when enabled",
    async (packageType) => {
      const fixture = await createChangePackageFixture({ packageType, requireSignedChangePackages: true });
      setChangesProjectStorage(fixture.storage);
      await expect(applyChangePackage(fixture.changePackage, [], { actor: fixture.actor }))
        .rejects.toThrow("有效成员签名");
      expect(await fixture.storage.readJsonl("logs/events.jsonl")).toEqual([]);
    },
  );

  it.each(["disabled", "removed", "readonly"])("rejects an ordinary submission from a currently %s exporter", async (state) => {
    const fixture = await createChangePackageFixture();
    const members = await fixture.storage.readJson<{ members: Member[] }>("members.json");
    members.members = state === "removed" ? [fixture.actor] : members.members.map((member) =>
      member.id === fixture.actor.id ? member : {
        ...member, active: state !== "disabled", roles: state === "readonly" ? ["readonly"] : member.roles,
      },
    );
    await fixture.storage.writeJson("members.json", members);
    setChangesProjectStorage(fixture.storage);
    await expect(applyChangePackage(fixture.changePackage, [], { actor: fixture.actor }))
      .rejects.toThrow("提交者没有发布这类修改包的权限");
    expect(await fixture.storage.readJsonl("logs/events.jsonl")).toEqual([]);
  });

  it("rejects maintenance published by a member without maintenance export permission", async () => {
    const fixture = await createChangePackageFixture({ packageType: "maintenance_changes" });
    fixture.changePackage.manifest.user_id = "member-2";
    setChangesProjectStorage(fixture.storage);
    await expect(applyChangePackage(fixture.changePackage, [], { actor: fixture.actor, confirmMaintenance: true }))
      .rejects.toThrow("提交者没有发布这类修改包的权限");
    expect(await fixture.storage.readJsonl("logs/events.jsonl")).toEqual([]);
  });

  it.each(["entries", "comments"] as const)("rejects %s in maintenance rather than applying a body snapshot", async (field) => {
    const fixture = await createChangePackageFixture({ packageType: "maintenance_changes" });
    if (field === "entries") fixture.changePackage.entries = {
      "entries/file-1/chunk_0001.jsonl": [{ ...fixture.originalEntry, source: "Wrong original", target: "Wrong snapshot" }],
    };
    else fixture.changePackage.comments = {
      "comments/file-1/000001.jsonl": [{
        id: "wrong-comment", entry_id: fixture.originalEntry.id, file_id: "file-1",
        user_id: fixture.actor.id, body: "Body snapshot", reply_to: null, created_at: "2026-02-01T00:00:00.000Z",
      }],
    };
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);
    await expect(applyChangePackage(fixture.changePackage, [], { actor: fixture.actor, confirmMaintenance: true }))
      .rejects.toThrow("维护包不能携带词条或批注正文");
    expect(await fixture.storage.readJsonl("logs/events.jsonl")).toEqual([]);
  });
  it.each(["legacy", "baseline"] as const)(
    "exports owned entries and comments without tasks in a %s workspace when tasks are disabled",
    async (workspace) => {
      const fixture = await createExportFixture();
      const project = await fixture.storage.readJson<ProjectConfig>("project.json");
      project.settings.workflow = { enable_tasks: false };
      await fixture.storage.writeJson("project.json", project);
      await fixture.storage.writeJsonl("tasks/tasks.jsonl", []);
      const entries = await fixture.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl");
      const otherEntry = createEntry({
        id: "file-1:2", file_id: "file-1", index: 2,
        updated_by: fixture.members[0]!.id,
      });
      await fixture.storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [...entries, otherEntry]);
      if (workspace === "baseline") {
        await ensureWorkspaceBaseline(fixture.storage, project);
      }
      await fixture.storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [
        { ...entries[0]!, target: "Owned local change" },
        { ...otherEntry, target: "Another member's change" },
      ]);
      await fixture.storage.writeJsonl("comments/file-1/000001.jsonl", [{
        id: "owned-comment", entry_id: "file-1:1", file_id: "file-1",
        user_id: fixture.contributor.id, body: "Local comment", reply_to: null,
        created_at: "2026-02-01T00:00:00.000Z",
      } satisfies Comment]);
      setChangesProjectStorage(fixture.storage);

      const exported = await exportChangePackage(fixture.contributor.id, {
        mode: "member_changes", sign: false, actor: fixture.contributor,
      });
      const pkg = await readChangePackage(new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob);
      expect(Object.values(pkg.entries).flat()).toMatchObject([
        { id: "file-1:1", target: "Owned local change" },
      ]);
      expect(Object.values(pkg.comments).flat()).toMatchObject([{ id: "owned-comment" }]);
    },
  );

  it("imports member entries and comments without assigned tasks when tasks are disabled", async () => {
    const fixture = await createChangePackageFixture({ packageEntry: { target: "Package changed" } });
    const project = await fixture.storage.readJson<ProjectConfig>("project.json");
    project.settings.workflow = { enable_tasks: false };
    await fixture.storage.writeJson("project.json", project);
    await fixture.storage.writeJsonl("tasks/tasks.jsonl", []);
    setChangesProjectStorage(fixture.storage);

    await expect(applyChangePackage(fixture.changePackage, [
      { entryId: fixture.originalEntry.id, action: "use_package" },
    ], { actor: fixture.actor })).resolves.toMatchObject({ appliedEntries: 1, importedComments: 1 });
    expect((await fixture.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl"))[0]?.target).toBe("Package changed");
  });

  it("still rejects another member's task status when tasks are disabled", async () => {
    const fixture = await createChangePackageFixture();
    const project = await fixture.storage.readJson<ProjectConfig>("project.json");
    project.settings.workflow = { enable_tasks: false };
    await fixture.storage.writeJson("project.json", project);
    const tasks = await fixture.storage.readJsonl<Task>("tasks/tasks.jsonl");
    const otherTask = { ...tasks[0]!, id: "other-task", assignee: fixture.actor.id };
    await fixture.storage.writeJsonl("tasks/tasks.jsonl", [...tasks, otherTask]);
    fixture.changePackage.tasks = { "tasks/tasks.jsonl": [{ ...otherTask, status: "submitted" }] };
    await refreshChangePackageHash(fixture.changePackage);
    const original = await fixture.storage.readText("tasks/tasks.jsonl");
    setChangesProjectStorage(fixture.storage);

    await expect(applyChangePackage(fixture.changePackage, [], { actor: fixture.actor })).rejects.toThrow("未分配给导出者");
    expect(await fixture.storage.readText("tasks/tasks.jsonl")).toBe(original);
  });

  it("keeps every chunk visible after importing a change to one chunk", async () => {
    const fixture = await createChangePackageFixture({ packageEntry: { target: "Package translation" } });
    const secondEntry = createEntry({ id: "file-1:2", file_id: "file-1", index: 2, key: "line_000002", target: "Unchanged" });
    await fixture.storage.writeJsonl("entries/file-1/chunk_0002.jsonl", [secondEntry]);
    setEntriesProjectStorage(fixture.storage);
    setChangesProjectStorage(fixture.storage);
    expect(await loadEntries("file-1")).toHaveLength(2);
    await applyChangePackage(fixture.changePackage, [{ entryId: fixture.originalEntry.id, action: "use_package" }], { actor: fixture.actor });
    expect(await loadEntries("file-1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fixture.originalEntry.id, target: "Package translation" }),
      expect.objectContaining({ id: secondEntry.id, target: "Unchanged" }),
    ]));
    expect(await loadEntries("file-1")).toHaveLength(2);
  });

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

  it("requires a valid signature even for manager packages when signatures are required", async () => {
    const fixture = await createChangePackageFixture({ requireSignedChangePackages: true });

    fixture.changePackage.manifest.user_id = fixture.actor.id;
    fixture.changePackage.manifest.user_name = fixture.actor.name;
    setChangesProjectStorage(fixture.storage);

    await expect(
      applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor,
      }),
    ).rejects.toThrow("有效成员签名");
  });

  it.each(["unsigned", "valid", "invalid"])("exports and imports another member's task with an optional %s signature", async (signatureStatus) => {
    const fixture = await createExportFixture();
    const sign = signatureStatus !== "unsigned";
    const signingOwner = sign ? (await generateOwnSigningKey(
      fixture.root, fixture.members, fixture.members[0]!,
    )).member : fixture.members[0]!;
    await fixture.storage.writeJsonl("comments/file-1/000001.jsonl", [{
      id: "task-comment", entry_id: "file-1:1", file_id: "file-1",
      user_id: fixture.contributor.id, body: "Contributor comment", reply_to: null,
      created_at: "2026-02-01T00:00:00.000Z",
    } satisfies Comment]);

    setChangesProjectStorage(fixture.storage);

    const exported = await exportChangePackage("owner-1", {
      mode: "task_changes",
      taskIds: ["task-1"],
      sign,
      actor: signingOwner,
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
    expect(Object.values(changePackage.comments).flat()).toMatchObject([{ id: "task-comment" }]);
    if (signatureStatus === "invalid") changePackage.signature!.signature = "AAAA";
    const receiver = await createExportFixture();
    await receiver.storage.writeJson("members.json", {
      schema_version: 1, members: [signingOwner, fixture.contributor],
    });
    setChangesProjectStorage(receiver.storage);
    await expect(applyChangePackage(changePackage, [], { actor: signingOwner }))
      .resolves.toMatchObject({ importedComments: 1 });
    expect(changePackage.validation?.signatureStatus).toBe(signatureStatus);
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

  it.each(["assigned", "submitted"] as const)(
    "treats legacy in_progress as assigned when importing %s task status",
    async (status) => {
      const legacyTask: Task = {
        id: "task-1", type: "translate", title: "Task", description: "",
        file_id: "file-1", range_start: 1, range_end: 1, entry_ids: [],
        assignee: "member-2", status: "in_progress", target: "", submit_method: "change_package",
        created_by: "owner-1", created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z", due_at: "",
      };
      const fixture = await createChangePackageFixture({
        originalTask: legacyTask, packageTask: { ...legacyTask, status },
      });
      setChangesProjectStorage(fixture.storage);
      await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([]);
      await expect(applyChangePackage(fixture.changePackage, [], { actor: fixture.actor }))
        .resolves.toMatchObject({ importedTasks: status === "submitted" ? 1 : 0 });
      setTasksProjectStorage(fixture.storage);
      expect((await loadTasks()).find(task => task.id === legacyTask.id)?.status).toBe(status);
    },
  );

  it.each([
    ["in_progress", "assigned", "submitted", "submitted", 1],
    ["in_progress", "submitted", "assigned", "submitted", 0],
    ["assigned", "submitted", "in_progress", "submitted", 0],
  ] as const)(
    "merges based task states %s / %s / %s without a false conflict",
    async (baseStatus, mainStatus, packageStatus, expectedStatus, importedTasks) => {
      const baseTask: Task = {
        id: "legacy-based-task", type: "translate", title: "Task", description: "",
        file_id: "file-1", range_start: 1, range_end: 1, entry_ids: [],
        assignee: "member-2", status: baseStatus, target: "", submit_method: "change_package",
        created_by: "owner-1", created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z", due_at: "",
      };
      const fixture = await createChangePackageFixture({
        originalTask: baseTask, packageTask: { ...baseTask, status: packageStatus },
      });
      fixture.changePackage.base = {
        schema_version: 1, entries: {}, comments: {}, terms: {},
        tasks: { "tasks/tasks.jsonl": [baseTask] },
      };
      await ensureWorkspaceBaseline(
        fixture.storage,
        await fixture.storage.readJson<ProjectConfig>("project.json"),
      );
      await fixture.storage.writeJsonl("tasks/tasks.jsonl", [{ ...baseTask, status: mainStatus }]);
      await refreshChangePackageHash(fixture.changePackage);
      const originalHash = fixture.changePackage.manifest.content_hash;
      setChangesProjectStorage(fixture.storage);
      await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([]);
      await expect(applyChangePackage(fixture.changePackage, [], { actor: fixture.actor }))
        .resolves.toMatchObject({ importedTasks });
      expect(await fixture.storage.readJsonl("tasks/tasks.jsonl"))
        .toMatchObject([{ status: expectedStatus }]);
      expect(fixture.changePackage.manifest.content_hash).toBe(originalHash);
      expect(fixture.changePackage.tasks["tasks/tasks.jsonl"]![0]!.status).toBe(packageStatus);
    },
  );

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
  it("validates and imports an old signed snapshot with unused settings without rewriting its signed content", async () => {
    const fixture = await createProjectUpdateFixture({ requireSignedChangePackages: true });
    const source = await fixture.sourceStorage.readJson<ProjectConfig>("project.json");
    await fixture.sourceStorage.writeJson("project.json", {
      ...source,
      settings: {
        ...source.settings, auto_save: false, allow_change_package: false,
        export: { default_format: "csv", include_source: false, include_key: true,
          include_report: true, include_manifest: true },
      },
    });
    setChangesProjectStorage(fixture.sourceStorage);
    const exported = await exportChangePackage(fixture.receiverOwner.id, {
      mode: "project_update", sign: true, actor: fixture.receiverOwner,
    });
    const pkg = await readChangePackage(new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob);
    const signedConfig = pkg.projectFiles["project/project.json"];
    const signedHash = pkg.manifest.content_hash;
    await expect(completeChangePackageExport(exported))
      .resolves.toMatchObject({ revision: pkg.manifest.target_revision });
    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);
    setChangesProjectStorage(fixture.receiverStorage);
    await applyChangePackage(pkg, [], { actor: fixture.receiverOwner });
    expect(pkg.validation).toMatchObject({ contentIntegrity: "passed", signatureStatus: "valid" });
    expect(pkg.projectFiles["project/project.json"]).toBe(signedConfig);
    expect(pkg.manifest.content_hash).toBe(signedHash);
    expect(await fixture.receiverStorage.readText("project.json")).toBe(signedConfig);
    const loaded = await loadProjectFromStorage(fixture.receiverStorage);
    expect(loaded.settings).not.toHaveProperty("auto_save");
    expect(loaded.settings).not.toHaveProperty("allow_change_package");
    expect(loaded.settings.export).toEqual({ default_format: "csv", include_source: false, include_key: true });
    await expect(applyChangePackage(pkg, [], { actor: fixture.receiverOwner }))
      .resolves.toMatchObject({ alreadyApplied: true });
    expect(pkg.validation).toMatchObject({ contentIntegrity: "passed", signatureStatus: "valid" });
  });

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
    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);

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

  it.each(["unsigned", "valid", "invalid"])("rebases directly onto a newer snapshot with an optional %s signature", async (signatureStatus) => {
    const sign = signatureStatus !== "unsigned";
    const fixture = await createProjectUpdateFixture({ sign });
    if (signatureStatus === "invalid") fixture.changePackage.signature!.signature = "AAAA";
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
    expect(fixture.changePackage.validation?.signatureStatus).toBe(signatureStatus);
  });

  it("treats an already applied project update as an idempotent no-op", async () => {
    const fixture = await createProjectUpdateFixture();
    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);
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

  it.each([false, true])("uses the publisher trust chain only with requireSigned=%s", async (requireSigned) => {
    const fixture = await createProjectUpdateFixture({
      requireSignedChangePackages: requireSigned,
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

    if (requireSigned) {
      await expect(detectConflicts(fixture.changePackage)).rejects.toThrow("必须按顺序接收");
    } else {
      await expect(detectConflicts(fixture.changePackage)).resolves.toEqual([]);
    }
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
    await ensureWorkspaceBaseline(receiverStorage, project);

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
    await ensureWorkspaceBaseline(receiverStorage, project);

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
    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);

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
    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);
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


describe("collaboration regression protection", () => {
  it("accepts task submission after maintenance changes task details without advancing the baseline", async () => {
    const worker = await createExportFixture();
    const main = await createExportFixture();
    const project = await worker.storage.readJson<ProjectConfig>("project.json");
    await ensureWorkspaceBaseline(worker.storage, project);
    await ensureWorkspaceBaseline(main.storage, project);
    const [task] = await main.storage.readJsonl<Task>("tasks/tasks.jsonl");
    await main.storage.writeJsonl("tasks/tasks.jsonl", [{ ...task!, title: "Maintained title" }]);
    setChangesProjectStorage(main.storage);
    const maintenance = await exportChangePackage(main.members[0]!.id, {
      mode: "maintenance_changes", sign: false, actor: main.members[0]!,
    });
    const maintenancePackage = await readChangePackage(new Uint8Array(await maintenance.blob.arrayBuffer()) as unknown as Blob);
    setChangesProjectStorage(worker.storage);
    await applyChangePackage(maintenancePackage, [], { actor: worker.contributor, confirmMaintenance: true });
    setTasksProjectStorage(worker.storage);
    setCurrentUser(worker.contributor);
    setPermissionProject(project);
    await submitTask("task-1");
    const submitted = await exportChangePackage(worker.contributor.id, {
      mode: "member_changes", sign: false, actor: worker.contributor,
    });
    const submission = await readChangePackage(new Uint8Array(await submitted.blob.arrayBuffer()) as unknown as Blob);
    setChangesProjectStorage(main.storage);
    submission.tasks["tasks/tasks.jsonl"]![0]!.title = "Unknown title";
    await refreshChangePackageHash(submission);
    await expect(applyChangePackage(submission, [], { actor: main.members[0]! }))
      .rejects.toThrow("任务受保护字段：title");
    expect(await main.storage.readJsonl<Task>("tasks/tasks.jsonl"))
      .toMatchObject([{ title: "Maintained title", status: "assigned" }]);
    submission.tasks["tasks/tasks.jsonl"]![0]!.title = "Maintained title";
    await refreshChangePackageHash(submission);
    await expect(applyChangePackage(submission, [], { actor: main.members[0]! }))
      .resolves.toMatchObject({ importedTasks: 1 });
    expect(await main.storage.readJsonl<Task>("tasks/tasks.jsonl"))
      .toMatchObject([{ title: "Maintained title", status: "submitted" }]);
    setCurrentUser(null);
    setPermissionProject(undefined);
  });

  it("accepts an older member package after an unrelated publication", async () => {
    const fixture = await createExportFixture();
    const project = await fixture.storage.readJson<ProjectConfig>("project.json");
    project.revision = "member-base";
    project.revision_hash = "member-base";
    await fixture.storage.writeJson("project.json", project);
    await ensureWorkspaceBaseline(fixture.storage, project);
    const receiver = createProjectStorage(createMemoryProjectDirectory({}));
    for (const path of ["members.json", "entries/file-1/chunk_0001.jsonl", "tasks/tasks.jsonl", "logs/events.jsonl"]) {
      await receiver.writeText(path, await fixture.storage.readText(path));
    }
    const publishedProject = { ...project, revision: "new-publication", revision_hash: "new-publication" };
    await receiver.writeJson("project.json", publishedProject);
    const tasks = await receiver.readJsonl<Task>("tasks/tasks.jsonl");
    await receiver.writeJsonl("tasks/tasks.jsonl", [
      ...tasks, { ...tasks[0]!, id: "other-task", title: "Another member's new task", assignee: fixture.members[0]!.id },
    ]);
    await ensureWorkspaceBaseline(receiver, publishedProject);
    const entries = await fixture.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl");
    await fixture.storage.writeJsonl("entries/file-1/chunk_0001.jsonl", [{ ...entries[0]!, target: "Late submission" }]);
    setChangesProjectStorage(fixture.storage);
    const exported = await exportChangePackage(fixture.contributor.id, {
      mode: "member_changes", sign: false, actor: fixture.contributor,
    });
    const pkg = await readChangePackage(new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob);
    setChangesProjectStorage(receiver);

    expect(await detectConflicts(pkg)).toEqual([]);
    await expect(applyChangePackage(pkg, [], { actor: fixture.members[0]! })).resolves.toMatchObject({ appliedEntries: 1 });
    expect((await receiver.readJson<ProjectConfig>("project.json")).revision).toBe("new-publication");
    expect(await receiver.readJsonl<Task>("tasks/tasks.jsonl")).toHaveLength(2);
  });

  it("imports maintenance settings and credentials without replacing the local snapshot or baseline", async () => {
    const fixture = await createChangePackageFixture({ packageType: "maintenance_changes" });
    const current = await fixture.storage.readJson<ProjectConfig>("project.json");
    current.revision = "local-revision";
    current.revision_hash = "local-revision";
    current.trust_epoch = 2;
    await fixture.storage.writeJson("project.json", current);
    await ensureWorkspaceBaseline(fixture.storage, current);
    const baseline = await fixture.storage.readText("changes/workspace/baseline.json");
    const entryBytes = await fixture.storage.readText("entries/file-1/chunk_0001.jsonl");
    const incoming = {
      ...current, revision: "different-revision", revision_hash: "different-revision",
      trust_epoch: 3, name: "Other copy", files: [],
      settings: { ...current.settings, chunk_size: 250, role_permissions: { translator: ["file.view"] } },
    };
    fixture.changePackage.entries = {};
    fixture.changePackage.comments = {};
    fixture.changePackage.projectFiles = { "project/project.json": `${JSON.stringify(incoming)}\n` };
    const members = await fixture.storage.readJson<{ schema_version: number; members: Member[] }>("members.json");
    members.members[1] = {
      ...members.members[1]!, password_hash: "new-hash", password_salt: "new-salt",
      password_updated_at: "2026-02-01T00:00:00.000Z", allow_permissions: ["term.create"],
    };
    fixture.changePackage.memberFiles = { "members/members.json": `${JSON.stringify(members)}\n` };
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await applyChangePackage(fixture.changePackage, [], { actor: fixture.actor, confirmMaintenance: true });
    const saved = await fixture.storage.readJson<ProjectConfig>("project.json");
    expect(saved).toEqual({ ...current, settings: incoming.settings });
    expect(await fixture.storage.readText("changes/workspace/baseline.json")).toBe(baseline);
    await expect(ensureWorkspaceBaseline(fixture.storage, saved)).resolves.toBeDefined();
    expect(await fixture.storage.readText("entries/file-1/chunk_0001.jsonl")).toBe(entryBytes);
    expect(await fixture.storage.readJson("members.json")).toEqual(members);
  });

  it("imports legacy maintenance without settings while preserving local settings", async () => {
    const fixture = await createChangePackageFixture({ packageType: "maintenance_changes" });
    const current = await fixture.storage.readJson<ProjectConfig>("project.json");
    const { settings: _settings, ...legacyProject } = current;
    fixture.changePackage.entries = {};
    fixture.changePackage.comments = {};
    fixture.changePackage.projectFiles = { "project/project.json": JSON.stringify(legacyProject) };
    const members = await fixture.storage.readJson<{ schema_version: number; members: Member[] }>("members.json");
    members.members[1] = { ...members.members[1]!, password_hash: "legacy-hash", password_salt: "legacy-salt" };
    fixture.changePackage.memberFiles = { "members/members.json": JSON.stringify(members) };
    await refreshChangePackageHash(fixture.changePackage);
    setChangesProjectStorage(fixture.storage);

    await expect(applyChangePackage(fixture.changePackage, [], {
      actor: fixture.actor, confirmMaintenance: true,
    })).resolves.toMatchObject({ importedMembers: 1 });
    expect(await fixture.storage.readJson<ProjectConfig>("project.json")).toEqual(current);
    expect(await fixture.storage.readJson("members.json")).toEqual(members);
  });

  it.each(["project_id", "settings"] as const)(
    "rejects invalid maintenance %s before writing any project data",
    async (field) => {
      const fixture = await createChangePackageFixture({ packageType: "maintenance_changes" });
      const originalProject = await fixture.storage.readText("project.json");
      const originalMembers = await fixture.storage.readText("members.json");
      const incoming = JSON.parse(originalProject);
      incoming[field] = field === "project_id" ? "another-project" : [];
      fixture.changePackage.entries = {};
      fixture.changePackage.comments = {};
      fixture.changePackage.terms = { "terms/terms.jsonl": [createTerm()] };
      fixture.changePackage.projectFiles = { "project/project.json": JSON.stringify(incoming) };
      await refreshChangePackageHash(fixture.changePackage);
      setChangesProjectStorage(fixture.storage);

      await expect(applyChangePackage(fixture.changePackage, [], {
        actor: fixture.actor, confirmMaintenance: true,
      })).rejects.toThrow(field === "project_id" ? "不属于当前项目" : "设置格式不正确");
      expect(await fixture.storage.readText("project.json")).toBe(originalProject);
      expect(await fixture.storage.readText("members.json")).toBe(originalMembers);
      expect(await fixture.storage.fileExists("terms/terms.jsonl")).toBe(false);
    },
  );

  it("refreshes imported task status and preserves it on the next edit", async () => {
    const fixture = await createExportFixture();
    const project = await fixture.storage.readJson<ProjectConfig>("project.json");
    const receiver = createProjectStorage(createMemoryProjectDirectory({}));
    for (const path of ["project.json", "members.json", "entries/file-1/chunk_0001.jsonl", "tasks/tasks.jsonl", "logs/events.jsonl"]) {
      await receiver.writeText(path, await fixture.storage.readText(path));
    }
    await ensureWorkspaceBaseline(fixture.storage, project);
    await ensureWorkspaceBaseline(receiver, project);
    setPermissionProject(project);
    setCurrentUser(fixture.contributor);
    setTasksProjectStorage(fixture.storage);
    setEntriesProjectStorage(fixture.storage);
    await submitTask("task-1");
    setChangesProjectStorage(fixture.storage);
    const exported = await exportChangePackage(fixture.contributor.id, {
      mode: "task_changes", taskIds: ["task-1"], sign: false, actor: fixture.contributor,
    });
    const pkg = await readChangePackage(new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob);
    setTasksProjectStorage(receiver);
    expect((await loadTasks())[0]?.status).toBe("assigned");
    setChangesProjectStorage(receiver);
    await applyChangePackage(pkg, [], { actor: fixture.members[0]! });
    expect((await loadTasks())[0]?.status).toBe("submitted");
    setCurrentUser(fixture.members[0]!);
    await updateTask("task-1", { title: "Renamed" });
    expect((await receiver.readJsonl<Task>("tasks/tasks.jsonl"))[0]?.status).toBe("submitted");
    expect((await applyChangePackage(pkg, [], { actor: fixture.members[0]! })).importedTasks).toBe(0);
  });

  it("refreshes authoritative entries after a warm read", async () => {
    const fixture = await createProjectUpdateFixture();
    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);
    setEntriesProjectStorage(fixture.receiverStorage);
    expect((await loadEntries("file-1"))[0]?.target).toBe("Old");
    setChangesProjectStorage(fixture.receiverStorage);
    await applyChangePackage(fixture.changePackage, [], { actor: fixture.receiverOwner });
    setCurrentUser(fixture.receiverOwner);
    setExporterProjectStorage(fixture.receiverStorage);
    const release = await exportFile("file-1", { format: "json", include_source: false });
    expect(release.content).toContain('"target": "Updated"');
    expect((await loadEntries("file-1"))[0]?.target).toBe("Updated");
  });

  it("retains imported terms when a new term is subsequently added", async () => {
    const fixture = await createChangePackageFixture();
    const members = await fixture.storage.readJson<{members: Member[]}>("members.json");
    members.members.find((member) => member.id === "member-2")!.roles.push("term_manager");
    await fixture.storage.writeJson("members.json", members);
    await fixture.storage.writeJsonl("terms/terms.jsonl", []);
    fixture.changePackage.terms = { "terms/terms.jsonl": [createTerm({id: "term-imported", created_by: "member-2", updated_by: "member-2"})] };
    await refreshChangePackageHash(fixture.changePackage);
    setTermsProjectStorage(fixture.storage);
    expect(await loadTerms()).toEqual([]);
    setChangesProjectStorage(fixture.storage);
    await applyChangePackage(fixture.changePackage, [], {actor: fixture.actor});
    expect((await loadTerms()).map((term) => term.id)).toContain("term-imported");
    setCurrentUser(fixture.actor);
    setPermissionProject(await fixture.storage.readJson<ProjectConfig>("project.json"));
    await addTerm({source: "new source", target: "new target", part_of_speech: "", note: "", variants: []});
    expect((await fixture.storage.readJsonl<Term>("terms/terms.jsonl")).map((term) => term.id)).toContain("term-imported");
  });

  it("exports another member's selected task status without entry changes", async () => {
    const fixture = await createExportFixture();
    const manager = createMember(["admin"], {id: "manager-3"});
    await fixture.storage.writeJson("members.json", {schema_version: 1, members: [...fixture.members, manager]});
    const project = await fixture.storage.readJson<ProjectConfig>("project.json");
    await ensureWorkspaceBaseline(fixture.storage, project);
    const tasks = await fixture.storage.readJsonl<Task>("tasks/tasks.jsonl");
    tasks[0]!.status = "submitted";
    await fixture.storage.writeJsonl("tasks/tasks.jsonl", tasks);
    setChangesProjectStorage(fixture.storage);
    const signingManager = (await generateOwnSigningKey(fixture.root, [...fixture.members, manager], manager)).member;
    const exported = await exportChangePackage(manager.id, {
      mode: "task_changes", taskIds: ["task-1"], sign: true, actor: signingManager,
    });
    const pkg = await readChangePackage(new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob);
    expect(pkg.tasks["tasks/tasks.jsonl"]).toMatchObject([{status: "submitted"}]);
  });

  it("exports comment-only changes in a legacy task workspace", async () => {
    const fixture = await createExportFixture();
    const project = await fixture.storage.readJson<ProjectConfig>("project.json");
    await ensureWorkspaceBaseline(fixture.storage, project, fixture.contributor.id);
    const rows = await fixture.storage.readJsonl<Entry>("entries/file-1/chunk_0001.jsonl");
    rows[0]!.updated_by = fixture.members[0]!.id;
    await fixture.storage.writeJsonl("entries/file-1/chunk_0001.jsonl", rows);
    await fixture.storage.writeJsonl("comments/file-1/000001.jsonl", [{id: "comment-only", entry_id: "file-1:1", file_id: "file-1", entry_index: 1, user_id: fixture.contributor.id, content: "Only a comment", created_at: "2026-01-02T00:00:00.000Z"}]);
    setChangesProjectStorage(fixture.storage);
    const exported = await exportChangePackage(fixture.contributor.id, {mode: "member_changes", sign: false, actor: fixture.contributor});
    const pkg = await readChangePackage(new Uint8Array(await exported.blob.arrayBuffer()) as unknown as Blob);
    expect(Object.values(pkg.comments).flat()).toMatchObject([{id: "comment-only"}]);
  });

  it("rejects a missing baseline without overwriting local work", async () => {
    const fixture = await createProjectUpdateFixture();
    const path = "entries/file-1/chunk_0001.jsonl";
    const rows = await fixture.receiverStorage.readJsonl<Entry>(path);
    rows[0]!.target = "Unsubmitted work";
    await fixture.receiverStorage.writeJsonl(path, rows);
    setChangesProjectStorage(fixture.receiverStorage);
    await expect(applyChangePackage(fixture.changePackage, [], {actor: fixture.receiverOwner})).rejects.toThrow("协作基线");
    expect((await fixture.receiverStorage.readJsonl<Entry>(path))[0]?.target).toBe("Unsubmitted work");
  });

  it("rejects an incomplete indexed snapshot on export and import", async () => {
    const fixture = await createProjectUpdateFixture({sign: false});
    await fixture.sourceStorage.deleteEntry("entries/file-1", {recursive: true});
    setChangesProjectStorage(fixture.sourceStorage);
    await expect(exportChangePackage(fixture.receiverOwner.id, {mode: "project_update", sign: false, actor: fixture.receiverOwner})).rejects.toThrow("词条分块");
    fixture.changePackage.entries = {};
    fixture.changePackage.files = {};
    await refreshChangePackageHash(fixture.changePackage);
    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);
    setChangesProjectStorage(fixture.receiverStorage);
    await expect(applyChangePackage(fixture.changePackage, [], {actor: fixture.receiverOwner})).rejects.toThrow("词条分块");
    expect(await fixture.receiverStorage.fileExists("entries/file-1/chunk_0001.jsonl")).toBe(true);
  });

  it("rejects skipped revisions when the current authority time is unknown", async () => {
    const fixture = await createProjectUpdateFixture();
    const project = {...fixture.receiverProject, revision: "other-revision", revision_hash: "other-revision", updated_at: "invalid"};
    await fixture.receiverStorage.writeJson("project.json", project);
    await ensureWorkspaceBaseline(fixture.receiverStorage, project);
    setChangesProjectStorage(fixture.receiverStorage);
    await expect(applyChangePackage(fixture.changePackage, [], {actor: fixture.receiverOwner})).rejects.toThrow("无法确认");
  });
});


describe("workspace baseline integrity", () => {
  it("does not replace a mismatched baseline with current unsubmitted work", async () => {
    const fixture = await createProjectUpdateFixture();
    await ensureWorkspaceBaseline(fixture.receiverStorage, fixture.receiverProject);
    const original = await fixture.receiverStorage.readText("changes/workspace/baseline.json");
    const changedProject = {...fixture.receiverProject, revision: "unexpected-revision"};
    await expect(ensureWorkspaceBaseline(fixture.receiverStorage, changedProject)).rejects.toThrow("不匹配");
    expect(await fixture.receiverStorage.readText("changes/workspace/baseline.json")).toBe(original);
  });
});
