import { PERMISSION_ACTIONS } from "../model/permissions";
import type {
  Member,
  ProjectConfig,
  ProjectEvent,
} from "../model/types";
import { createId } from "../utils/id";
import { nowIso } from "../utils/time";
import { readZip } from "../utils/zip";
import type { ExportedChangePackage } from "./changes";
import { can, isOwnerMember, setPermissionProject } from "./permissions";
import type { ProjectDirectoryHandle } from "./projectFs";
import { createProjectStorage } from "./projectStorage";
import { createProjectWritePlan } from "./projectWritePlan";

export interface SignedTrustTransitionCommit {
  project: ProjectConfig;
  members: Member[];
  archivePath: string;
}

export interface ArchivedTrustTransition {
  path: string;
  fileName: string;
  blob: Blob;
}

function getProjectRevision(project: ProjectConfig): string {
  return project.revision || project.revision_hash || `schema-${project.schema_version}`;
}

function createTransitionEvent(
  actor: Member,
  eventType: string,
  detail: Record<string, unknown>,
): ProjectEvent {
  return {
    id: createId("event"),
    type: eventType,
    user_id: actor.id,
    created_at: nowIso(),
    detail,
  };
}

function assertProjectUpdateExport(
  exported: ExportedChangePackage,
  actor: Member,
): asserts exported is ExportedChangePackage & {
  completion: Extract<
    ExportedChangePackage["completion"],
    { kind: "project_update" }
  >;
} {
  if (
    exported.completion.kind !== "project_update" ||
    !exported.signature ||
    exported.signature.user_id !== actor.id ||
    exported.manifest.user_id !== actor.id
  ) {
    throw new Error("可信过渡必须使用当前发布者签名的项目更新包。");
  }
}

export async function commitSignedTrustTransition(
  root: ProjectDirectoryHandle,
  exported: ExportedChangePackage,
  members: Member[],
  actor: Member,
  eventType: string,
  detail: Record<string, unknown>,
): Promise<SignedTrustTransitionCommit> {
  assertProjectUpdateExport(exported, actor);

  const storage = createProjectStorage(root);
  const currentProject = await storage.readJson<ProjectConfig>("project.json");
  const packageFiles = await readZip(await exported.blob.arrayBuffer());
  const packageMembersText = packageFiles["members/members.json"];

  if (!packageMembersText) {
    throw new Error("可信过渡包缺少公开成员快照。");
  }

  const packageMembersFile = JSON.parse(packageMembersText) as {
    members?: Member[];
  };
  const sanitize = (member: Member): Member => {
    const publicMember = { ...member };

    delete publicMember.password_hash;
    delete publicMember.password_salt;
    delete publicMember.password_updated_at;
    return publicMember;
  };

  if (
    JSON.stringify(packageMembersFile.members ?? []) !==
    JSON.stringify(members.map(sanitize))
  ) {
    throw new Error("可信过渡包中的成员快照与准备提交的成员状态不一致。");
  }

  if (
    currentProject.project_id !== exported.completion.projectId ||
    getProjectRevision(currentProject) !== exported.completion.baseRevision
  ) {
    throw new Error("项目版本已变化，可信过渡没有提交。请重新生成过渡包。");
  }

  const nextProject = JSON.parse(
    exported.completion.projectJson,
  ) as ProjectConfig;
  const events = await storage.fileExists("logs/events.jsonl")
    ? await storage.readJsonl<ProjectEvent>("logs/events.jsonl")
    : [];
  const transitionEvent = createTransitionEvent(actor, eventType, {
    ...detail,
    package_id: exported.manifest.package_id ?? "",
    base_revision: exported.completion.baseRevision,
    target_revision: exported.completion.targetRevision,
  });
  const packageId =
    exported.manifest.package_id ?? createId("trust_transition");
  const archivePath = `changes/transitions/${packageId}.zip`;
  const plan = createProjectWritePlan(storage);

  plan
    .writeBinary(
      archivePath,
      new Uint8Array(await exported.blob.arrayBuffer()),
    )
    .writeJson("members.json", {
      schema_version: 1,
      members,
    })
    .writeJsonl("logs/events.jsonl", [...events, transitionEvent])
    .writeText("project.json", exported.completion.projectJson);

  await plan.execute({ verifyWrites: true });
  setPermissionProject(nextProject);

  return {
    project: nextProject,
    members,
    archivePath,
  };
}

export async function loadLatestTrustTransitionArchive(
  root: ProjectDirectoryHandle,
): Promise<ArchivedTrustTransition> {
  const storage = createProjectStorage(root);
  const directory = "changes/transitions";

  if (!(await storage.fileExists(directory))) {
    throw new Error("当前项目还没有归档的可信过渡包。");
  }

  const names = (await storage.listFiles(directory))
    .filter((name) => name.toLowerCase().endsWith(".zip"))
    .sort((left, right) => right.localeCompare(left));
  const fileName = names[0];

  if (!fileName) {
    throw new Error("当前项目还没有归档的可信过渡包。");
  }

  const path = `${directory}/${fileName}`;
  const storedBytes = await storage.readBinary(path);
  const bytes = new Uint8Array(storedBytes.byteLength);

  bytes.set(storedBytes);

  return {
    path,
    fileName,
    blob: new Blob([bytes.buffer], {
      type: "application/zip",
    }),
  };
}

export function prepareOfflineTrustRebuild(
  project: ProjectConfig,
  members: Member[],
  actor: Member,
): ProjectConfig {
  if (!isOwnerMember(actor)) {
    throw new Error("只有当前项目负责人可以在线下重建项目信任。");
  }

  const owner = members.find((member) => member.id === actor.id);

  if (!owner?.public_key || !owner.key_id || owner.key_revoked_at) {
    throw new Error("新的负责人公钥尚未准备完成。");
  }

  const updatedAt = nowIso();
  const revision = `revision_trust_${updatedAt.replace(/\D/g, "")}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  return {
    ...project,
    revision,
    revision_hash: revision,
    trust_epoch: Math.max(0, project.trust_epoch ?? 0) + 1,
    updated_at: updatedAt,
  };
}

export async function commitOfflineTrustRebuild(
  root: ProjectDirectoryHandle,
  currentProject: ProjectConfig,
  nextProject: ProjectConfig,
  members: Member[],
  actor: Member,
): Promise<ProjectConfig> {
  if (!isOwnerMember(actor)) {
    throw new Error("只有当前项目负责人可以完成项目信任重建。");
  }

  if (
    currentProject.project_id !== nextProject.project_id ||
    (nextProject.trust_epoch ?? 0) !==
      Math.max(0, currentProject.trust_epoch ?? 0) + 1
  ) {
    throw new Error("项目信任重建状态不正确。");
  }

  const storage = createProjectStorage(root);
  const diskProject = await storage.readJson<ProjectConfig>("project.json");

  if (
    (diskProject.revision || diskProject.revision_hash || "") !==
    (currentProject.revision || currentProject.revision_hash || "")
  ) {
    throw new Error("项目版本已变化，项目信任没有重建。请重新操作。");
  }

  const events = await storage.fileExists("logs/events.jsonl")
    ? await storage.readJsonl<ProjectEvent>("logs/events.jsonl")
    : [];
  const event = createTransitionEvent(actor, "project.trust_rebuilt", {
    previous_trust_epoch: currentProject.trust_epoch ?? 0,
    trust_epoch: nextProject.trust_epoch ?? 0,
    previous_revision:
      currentProject.revision || currentProject.revision_hash || "",
    revision: nextProject.revision || nextProject.revision_hash || "",
    key_id:
      members.find((member) => member.id === actor.id)?.key_id ?? "",
  });
  const plan = createProjectWritePlan(storage);

  plan
    .writeJson("members.json", {
      schema_version: 1,
      members,
    })
    .writeJsonl("logs/events.jsonl", [...events, event])
    .writeJson("project.json", nextProject);

  await plan.execute({ verifyWrites: true });
  setPermissionProject(nextProject);
  return nextProject;
}

export function getOtherTrustedProjectUpdatePublishers(
  members: Member[],
  actor: Member,
  project: ProjectConfig,
): Member[] {
  return members.filter(
    (member) =>
      member.id !== actor.id &&
      member.active &&
      Boolean(member.public_key && member.key_id && !member.key_revoked_at) &&
      can(
        member,
        PERMISSION_ACTIONS.CHANGE_PACKAGE_EXPORT_PROJECT_UPDATE,
        project,
      ),
  );
}
