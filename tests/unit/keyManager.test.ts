import { describe, expect, it } from "vitest";
import { addMemberWithGeneratedKey } from "../../src/services/auth";
import {
  exportOwnPublicKeyRegistrationFile,
  generateOwnSigningKey,
  importMemberPublicKeyRegistrationFile,
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
});
