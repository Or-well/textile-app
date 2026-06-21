import { describe, expect, it } from "vitest";
import { addMemberWithGeneratedKey } from "../../src/services/auth";
import {
  exportOwnKeyFile,
  exportOwnPublicKeyRegistrationFile,
  generateOwnSigningKey,
  hasLoadedPrivateKey,
  importMemberPublicKeyRegistrationFile,
  importOwnKeyFile,
  revokeMemberPublicKey,
  revokeOwnSigningKey,
  unloadOwnSigningPrivateKey,
} from "../../src/services/keyManager";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import type { Member } from "../../src/model/types";
import { createMember } from "./factories";

describe("key manager", () => {
  it("creates a member with a project public key and one-time private key file", async () => {
    const root = createMemoryProjectDirectory({}, "keys.hproj");
    const storage = createProjectStorage(root);
    const owner = createMember(["owner"], { id: "owner-1", name: "Owner" });
    const result = await addMemberWithGeneratedKey(root, [owner], owner, {
      name: "Translator",
      roles: ["translator"],
      password: "secret",
    });

    expect(result.member.public_key).toBeTruthy();
    expect(result.member.key_id).toBeTruthy();
    expect(result.keyFile).toMatchObject({
      kind: "textile.member_key",
      member_id: result.member.id,
      key_id: result.member.key_id,
      public_key: result.member.public_key,
    });
    expect(result.keyFile.private_key).toBeTruthy();

    const membersFile = await storage.readJson<{ members: Member[] }>("members.json");
    const storedMember = membersFile.members.find(
      (member) => member.id === result.member.id,
    );

    expect(storedMember).toMatchObject({
      public_key: result.member.public_key,
      key_id: result.member.key_id,
    });
    expect(JSON.stringify(membersFile)).not.toContain(result.keyFile.private_key);
  });

  it("exports and imports a public key registration file", async () => {
    const sourceRoot = createMemoryProjectDirectory({}, "source.hproj");
    const targetRoot = createMemoryProjectDirectory({}, "target.hproj");
    const targetStorage = createProjectStorage(targetRoot);
    const member = createMember(["translator"], {
      id: "member-1",
      name: "Translator",
    });
    const owner = createMember(["owner"], { id: "owner-1", name: "Owner" });
    const keyResult = await generateOwnSigningKey(sourceRoot, [member], member);
    const exported = await exportOwnPublicKeyRegistrationFile(
      keyResult.members,
      keyResult.member,
      "project-1",
    );
    const text = await exported.blob.text();
    const importResult = await importMemberPublicKeyRegistrationFile(
      targetRoot,
      [owner, member],
      owner,
      "project-1",
      text,
    );

    expect(importResult.member).toMatchObject({
      id: member.id,
      public_key: keyResult.member.public_key,
      key_id: keyResult.member.key_id,
      key_revoked_at: "",
    });

    const membersFile = await targetStorage.readJson<{ members: Member[] }>(
      "members.json",
    );

    expect(membersFile.members.find((item) => item.id === member.id)).toMatchObject({
      public_key: keyResult.member.public_key,
      key_id: keyResult.member.key_id,
    });
  });

  it("requires explicit replacement when importing a different public key", async () => {
    const firstRoot = createMemoryProjectDirectory({}, "first.hproj");
    const secondRoot = createMemoryProjectDirectory({}, "second.hproj");
    const targetRoot = createMemoryProjectDirectory({}, "replace.hproj");
    const member = createMember(["translator"], {
      id: "member-1",
      name: "Translator",
    });
    const owner = createMember(["owner"], { id: "owner-1", name: "Owner" });
    const firstKey = await generateOwnSigningKey(firstRoot, [member], member);
    const secondKey = await generateOwnSigningKey(secondRoot, [member], member);
    const secondPublic = await exportOwnPublicKeyRegistrationFile(
      secondKey.members,
      secondKey.member,
      "project-1",
    );
    const existingMember = {
      ...member,
      public_key: firstKey.member.public_key,
      key_id: firstKey.member.key_id,
      key_created_at: firstKey.member.key_created_at,
      key_revoked_at: "",
    };

    await expect(
      importMemberPublicKeyRegistrationFile(
        targetRoot,
        [owner, existingMember],
        owner,
        "project-1",
        await secondPublic.blob.text(),
      ),
    ).rejects.toThrow("已有不同公钥");

    await expect(
      importMemberPublicKeyRegistrationFile(
        targetRoot,
        [owner, existingMember],
        owner,
        "project-1",
        await secondPublic.blob.text(),
        { allowReplace: true },
      ),
    ).resolves.toMatchObject({
      member: {
        id: member.id,
        public_key: secondKey.member.public_key,
        key_id: secondKey.member.key_id,
      },
    });
  });

  it("does not reactivate a revoked key by importing the same private key", async () => {
    const root = createMemoryProjectDirectory({}, "revoked-private.hproj");
    const member = createMember(["translator"], {
      id: "member-1",
      name: "Translator",
    });
    const generated = await generateOwnSigningKey(root, [member], member);
    const exported = exportOwnKeyFile(generated.members, generated.member);
    const revokedMember = {
      ...generated.member,
      key_revoked_at: "2026-01-01T00:00:00.000Z",
    };

    await expect(
      importOwnKeyFile(
        root,
        [revokedMember],
        revokedMember,
        await exported.blob.text(),
      ),
    ).rejects.toThrow("已经撤销");
  });

  it("allows ordinary members to revoke their own public key", async () => {
    const root = createMemoryProjectDirectory({}, "self-revoke.hproj");
    const storage = createProjectStorage(root);
    const member = createMember(["translator"], {
      id: "member-1",
      name: "Translator",
    });
    const generated = await generateOwnSigningKey(root, [member], member);
    const revoked = await revokeOwnSigningKey(
      root,
      generated.members,
      generated.member,
    );

    expect(revoked.member.key_revoked_at).toBeTruthy();
    expect(hasLoadedPrivateKey(revoked.member)).toBe(false);

    const membersFile = await storage.readJson<{ members: Member[] }>("members.json");
    expect(membersFile.members.find((item) => item.id === member.id)).toMatchObject({
      key_id: generated.member.key_id,
      key_revoked_at: revoked.member.key_revoked_at,
    });
  });

  it("keeps ordinary members from revoking another member's public key", async () => {
    const root = createMemoryProjectDirectory({}, "other-revoke.hproj");
    const actor = createMember(["translator"], {
      id: "member-1",
      name: "Translator A",
    });
    const target = createMember(["translator"], {
      id: "member-2",
      name: "Translator B",
      public_key: "public-key",
      key_id: "key-1",
      key_revoked_at: "",
    });

    await expect(
      revokeMemberPublicKey(root, [actor, target], actor, target.id),
    ).rejects.toThrow("撤销其他成员身份密钥");
  });

  it("does not reactivate a revoked key by registering the same public key", async () => {
    const sourceRoot = createMemoryProjectDirectory({}, "revoked-public-source.hproj");
    const targetRoot = createMemoryProjectDirectory({}, "revoked-public-target.hproj");
    const member = createMember(["translator"], {
      id: "member-1",
      name: "Translator",
    });
    const owner = createMember(["owner"], { id: "owner-1", name: "Owner" });
    const generated = await generateOwnSigningKey(sourceRoot, [member], member);
    const registration = await exportOwnPublicKeyRegistrationFile(
      generated.members,
      generated.member,
      "project-1",
    );
    const revokedMember = {
      ...generated.member,
      key_revoked_at: "2026-01-01T00:00:00.000Z",
    };

    await expect(
      importMemberPublicKeyRegistrationFile(
        targetRoot,
        [owner, revokedMember],
        owner,
        "project-1",
        await registration.blob.text(),
      ),
    ).rejects.toThrow("已经撤销");
  });

  it("unloads an imported private key from application memory", async () => {
    const root = createMemoryProjectDirectory({}, "unload-private.hproj");
    const member = createMember(["translator"], {
      id: "member-1",
      name: "Translator",
    });
    const generated = await generateOwnSigningKey(root, [member], member);

    expect(hasLoadedPrivateKey(generated.member)).toBe(true);
    unloadOwnSigningPrivateKey(generated.member);
    expect(hasLoadedPrivateKey(generated.member)).toBe(false);
  });
});
