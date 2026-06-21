import { describe, expect, it } from "vitest";
import type { Member, ProjectEvent } from "../../src/model/types";
import { deleteMember, enableMember } from "../../src/services/auth";
import { createMemoryProjectDirectory } from "../../src/services/projectFs";
import { createProjectStorage } from "../../src/services/projectStorage";
import { createMember } from "./factories";

function createMembers(): { owner: Member; disabledMember: Member } {
  return {
    owner: createMember(["owner"], {
      id: "owner-1",
      name: "Owner",
    }),
    disabledMember: createMember(["translator"], {
      id: "translator-1",
      name: "Translator",
      active: false,
      password_hash: "existing-hash",
      password_salt: "existing-salt",
      public_key: "existing-public-key",
      key_revoked_at: "2026-01-01T00:00:00.000Z",
    }),
  };
}

describe("member activation", () => {
  it("enables a disabled member without changing credentials or key state", async () => {
    const { owner, disabledMember } = createMembers();
    const members = [owner, disabledMember];
    const root = createMemoryProjectDirectory(
      {
        "members.json": JSON.stringify({
          schema_version: 1,
          members,
        }),
      },
      "member-activation.hproj",
    );
    const storage = createProjectStorage(root);

    const result = await enableMember(root, members, owner, disabledMember.id);
    const enabledMember = result.find((member) => member.id === disabledMember.id);

    expect(enabledMember).toMatchObject({
      active: true,
      password_hash: "existing-hash",
      password_salt: "existing-salt",
      public_key: "existing-public-key",
      key_revoked_at: "2026-01-01T00:00:00.000Z",
    });
    await expect(
      storage.readJson<{ members: Member[] }>("members.json"),
    ).resolves.toMatchObject({
      members: [
        { id: owner.id, active: true },
        { id: disabledMember.id, active: true },
      ],
    });
    await expect(
      storage.readJsonl<ProjectEvent>("logs/events.jsonl"),
    ).resolves.toEqual([
      expect.objectContaining({
        type: "member.enabled",
        user_id: owner.id,
        detail: {
          member_id: disabledMember.id,
        },
      }),
    ]);
  });

  it("rejects enabling a member who is already active", async () => {
    const { owner, disabledMember } = createMembers();
    const activeMember = { ...disabledMember, active: true };
    const root = createMemoryProjectDirectory({}, "member-already-active.hproj");

    await expect(
      enableMember(root, [owner, activeMember], owner, activeMember.id),
    ).rejects.toThrow("当前成员已经启用");
  });

  it("rejects enabling a member without management permission", async () => {
    const { owner, disabledMember } = createMembers();
    const actor = createMember(["translator"], {
      id: "translator-2",
      name: "Other translator",
    });
    const root = createMemoryProjectDirectory({}, "member-activation-denied.hproj");

    await expect(
      enableMember(root, [owner, actor, disabledMember], actor, disabledMember.id),
    ).rejects.toThrow("当前成员没有管理成员的权限");
  });
});

describe("member deletion", () => {
  it("permanently removes a disabled member and records an audit event", async () => {
    const { owner, disabledMember } = createMembers();
    const memberWithKey = {
      ...disabledMember,
      roles: ["translator", "proofreader"] as Member["roles"],
      key_id: "key-1",
    };
    const members = [owner, memberWithKey];
    const root = createMemoryProjectDirectory(
      {
        "members.json": JSON.stringify({
          schema_version: 1,
          members,
        }),
      },
      "member-deletion.hproj",
    );
    const storage = createProjectStorage(root);

    const result = await deleteMember(root, members, owner, memberWithKey.id);

    expect(result).toEqual([owner]);
    await expect(
      storage.readJson<{ members: Member[] }>("members.json"),
    ).resolves.toEqual({
      schema_version: 1,
      members: [owner],
    });
    await expect(
      storage.readJsonl<ProjectEvent>("logs/events.jsonl"),
    ).resolves.toEqual([
      expect.objectContaining({
        type: "member.deleted",
        user_id: owner.id,
        detail: {
          member_id: memberWithKey.id,
        },
      }),
    ]);
  });

  it("requires a member to be disabled before permanent deletion", async () => {
    const { owner, disabledMember } = createMembers();
    const activeMember = { ...disabledMember, active: true };
    const root = createMemoryProjectDirectory({}, "member-deletion-active.hproj");

    await expect(
      deleteMember(root, [owner, activeMember], owner, activeMember.id),
    ).rejects.toThrow("请先禁用该成员");
  });

  it("rejects permanent deletion without management permission", async () => {
    const { owner, disabledMember } = createMembers();
    const actor = createMember(["translator"], {
      id: "translator-2",
      name: "Other translator",
    });
    const root = createMemoryProjectDirectory({}, "member-deletion-denied.hproj");

    await expect(
      deleteMember(root, [owner, actor, disabledMember], actor, disabledMember.id),
    ).rejects.toThrow("当前成员没有管理成员的权限");
  });
});
