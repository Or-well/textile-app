import { describe, expect, it } from "vitest";
import type { Member, ProjectConfig, ProjectEvent } from "../../src/model/types";
import {
  exportChangePackage,
  setChangesProjectStorage,
} from "../../src/services/changes";
import {
  activatePreparedOwnSigningKey,
  commitPreparedOwnSigningKeyGeneration,
  prepareOwnSigningKeyGeneration,
  prepareOwnSigningKeyRotation,
} from "../../src/services/keyManager";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import {
  commitOfflineTrustRebuild,
  commitSignedTrustTransition,
  loadLatestTrustTransitionArchive,
  prepareOfflineTrustRebuild,
} from "../../src/services/signingTrustTransition";
import { createMember } from "./factories";

function createProject(): ProjectConfig {
  return {
    schema_version: 1,
    project_id: "project-trust",
    revision: "revision-1",
    revision_hash: "revision-1",
    trust_epoch: 0,
    name: "Trust project",
    source_language: "ja",
    target_language: "zh-Hans",
    files: [],
    settings: {
      chunk_size: 500,
      auto_save: true,
      allow_change_package: true,
    },
  };
}

async function createProjectWithOwner() {
  const root = createMemoryProjectDirectory({}, "trust.hproj");
  const storage = createProjectStorage(root);
  const owner = createMember(["owner"], {
    id: "owner-1",
    name: "Owner",
  });
  const project = createProject();

  await storage.writeJson("project.json", project);
  await storage.writeJson("members.json", {
    schema_version: 1,
    members: [owner],
  });
  await storage.writeJsonl("logs/events.jsonl", []);

  const generation = await prepareOwnSigningKeyGeneration([owner], owner);
  const generated = await commitPreparedOwnSigningKeyGeneration(
    root,
    generation,
    owner,
  );
  const signingOwner = generated.member;

  setChangesProjectStorage(storage);

  return {
    root,
    storage,
    project,
    owner: signingOwner,
    members: generated.members,
  };
}

describe("signing trust transitions", () => {
  it("archives and atomically commits a signed key transition", async () => {
    const context = await createProjectWithOwner();
    const rotation = await prepareOwnSigningKeyRotation(
      context.members,
      context.owner,
    );
    const exported = await exportChangePackage(context.owner.id, {
      mode: "project_update",
      sign: true,
      actor: context.owner,
      projectUpdateMembers: rotation.members,
      signatureMember: context.owner,
    });
    const committed = await commitSignedTrustTransition(
      context.root,
      exported,
      rotation.members,
      context.owner,
      "member.key_rotated",
      {
        member_id: context.owner.id,
        key_id: rotation.member.key_id ?? "",
      },
    );

    activatePreparedOwnSigningKey(rotation, context.owner);

    expect(committed.project.revision).toBe(exported.manifest.target_revision);
    expect(committed.archivePath).toContain("changes/transitions/");
    await expect(context.storage.fileExists(committed.archivePath)).resolves.toBe(true);

    const storedMembers = await context.storage.readJson<{ members: Member[] }>(
      "members.json",
    );
    expect(storedMembers.members[0].key_id).toBe(rotation.member.key_id);

    const events = await context.storage.readJsonl<ProjectEvent>(
      "logs/events.jsonl",
    );
    expect(events.at(-1)).toMatchObject({
      type: "member.key_rotated",
      user_id: context.owner.id,
    });

    const archive = await loadLatestTrustTransitionArchive(context.root);
    expect(archive.path).toBe(committed.archivePath);
    expect(archive.blob.size).toBeGreaterThan(0);
  });

  it("increments trust epoch only when offline trust rebuild commits", async () => {
    const context = await createProjectWithOwner();
    const rotation = await prepareOwnSigningKeyRotation(
      context.members,
      context.owner,
    );
    const nextProject = prepareOfflineTrustRebuild(
      context.project,
      rotation.members,
      context.owner,
    );

    expect(nextProject.trust_epoch).toBe(1);
    expect(nextProject.revision).not.toBe(context.project.revision);

    const committed = await commitOfflineTrustRebuild(
      context.root,
      context.project,
      nextProject,
      rotation.members,
      context.owner,
    );

    expect(committed.trust_epoch).toBe(1);
    const stored = await context.storage.readJson<ProjectConfig>("project.json");
    expect(stored.trust_epoch).toBe(1);
  });
});
