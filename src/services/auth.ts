import { PERMISSION_ACTIONS } from "../model/permissions";
import type { Member, Role } from "../model/types";
import { createId } from "../utils/id";
import { nowIso } from "../utils/time";
import { appendEventToRoot } from "./history";
import {
  generateMemberSigningKey,
  type MemberKeyFile,
} from "./keyManager";
import { can, hasRole } from "./permissions";
import { saveMembers } from "./project";
import type { ProjectDirectoryHandle } from "./projectFs";

export interface NewMemberInput {
  name: string;
  roles: Role[];
  password: string;
}

export interface NewMemberWithKeyResult {
  members: Member[];
  member: Member;
  keyFile: MemberKeyFile;
}

export interface RoleUpdateInput {
  memberId: string;
  roles: Role[];
}

const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEY_LENGTH = 256;
const ROLE_FALLBACK: Role = "readonly";
const MANAGER_ROLES: Role[] = ["owner", "admin"];

function getCrypto(): Crypto {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("当前浏览器无法处理项目登录。请使用新版 Chrome 或 Edge。");
  }

  return crypto;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

async function derivePasswordHash(password: string, salt: Uint8Array): Promise<string> {
  const subtle = getCrypto().subtle;
  const passwordBytes = new TextEncoder().encode(password);
  const saltBuffer = new ArrayBuffer(salt.byteLength);

  new Uint8Array(saltBuffer).set(salt);

  const key = await subtle.importKey(
    "raw",
    passwordBytes,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    PASSWORD_KEY_LENGTH,
  );

  return bytesToBase64(new Uint8Array(bits));
}

function normalizeRoles(roles: Role[]): Role[] {
  const uniqueRoles = getUniqueRoles(roles);

  return uniqueRoles.length > 0 ? uniqueRoles : [ROLE_FALLBACK];
}

function getUniqueRoles(roles: Role[]): Role[] {
  return roles.filter(
    (role, index) => roles.indexOf(role) === index,
  );
}

function isProjectManager(user: Member | null | undefined): boolean {
  return Boolean(
    user?.active &&
      MANAGER_ROLES.some((role) => hasRole(user, role)) &&
      can(user, PERMISSION_ACTIONS.PROJECT_MANAGE),
  );
}

function isOwner(user: Member | null | undefined): boolean {
  return hasRole(user, "owner");
}

function isAdmin(user: Member | null | undefined): boolean {
  return hasRole(user, "admin");
}

function assertCanManageMembers(actor: Member | null | undefined): asserts actor is Member {
  if (!isProjectManager(actor)) {
    throw new Error("当前成员没有管理成员的权限。");
  }
}

function assertCanManageTarget(actor: Member, target: Member): void {
  if (isOwner(actor)) {
    return;
  }

  if (isAdmin(actor) && !isOwner(target) && actor.id !== target.id) {
    return;
  }

  throw new Error("当前成员不能管理这个成员。");
}

function assertSingleOwner(members: Member[]): void {
  const ownerCount = members.filter((member) => member.roles.includes("owner")).length;

  if (ownerCount !== 1) {
    throw new Error("项目负责人只能有一位。");
  }
}

function findMember(members: Member[], memberId: string): Member {
  const member = members.find((item) => item.id === memberId);

  if (!member) {
    throw new Error("没有找到这个成员。");
  }

  return member;
}

function updateMember(
  members: Member[],
  memberId: string,
  update: (member: Member) => Member,
): Member[] {
  return members.map((member) => (member.id === memberId ? update(member) : member));
}

async function writeMembersAndEvent(
  root: ProjectDirectoryHandle,
  members: Member[],
  actorId: string,
  eventType: string,
  detail: Record<string, unknown>,
): Promise<Member[]> {
  assertSingleOwner(members);
  await saveMembers(root, members);
  await appendEventToRoot(root, {
    type: eventType,
    user_id: actorId,
    detail,
  });

  return members;
}

export function canManageMember(
  actor: Member | null | undefined,
  target: Member,
): boolean {
  if (!actor || !isProjectManager(actor)) {
    return false;
  }

  if (isOwner(actor)) {
    return true;
  }

  return isAdmin(actor) && !isOwner(target) && actor.id !== target.id;
}

export function canTransferOwner(actor: Member | null | undefined): boolean {
  return Boolean(actor?.active && isOwner(actor));
}

export async function createPasswordFields(
  password: string,
): Promise<Pick<Member, "password_hash" | "password_salt" | "password_updated_at">> {
  if (!password.trim()) {
    throw new Error("请输入密码。");
  }

  const salt = new Uint8Array(16);

  getCrypto().getRandomValues(salt);

  return {
    password_hash: await derivePasswordHash(password, salt),
    password_salt: bytesToBase64(salt),
    password_updated_at: nowIso(),
  };
}

export async function verifyMemberPassword(
  member: Member,
  password: string,
): Promise<boolean> {
  if (!member.password_hash || !member.password_salt) {
    return false;
  }

  const hash = await derivePasswordHash(password, base64ToBytes(member.password_salt));

  return timingSafeEqual(hash, member.password_hash);
}

export async function loginMember(
  members: Member[],
  memberName: string,
  password: string,
): Promise<Member | null> {
  const normalizedName = memberName.trim();
  const member = members.find(
    (item) => item.active && item.name === normalizedName,
  );

  if (!member) {
    return null;
  }

  return (await verifyMemberPassword(member, password)) ? member : null;
}

export async function changeOwnPassword(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member,
  oldPassword: string,
  newPassword: string,
): Promise<Member[]> {
  const target = findMember(members, actor.id);

  if (!target.active) {
    throw new Error("当前成员已被禁用，不能修改密码。");
  }

  if (!(await verifyMemberPassword(target, oldPassword))) {
    throw new Error("旧密码不正确。");
  }

  const passwordFields = await createPasswordFields(newPassword);
  const updatedAt = nowIso();
  const nextMembers = updateMember(members, actor.id, (member) => ({
    ...member,
    ...passwordFields,
    updated_at: updatedAt,
  }));

  return writeMembersAndEvent(root, nextMembers, actor.id, "member.password_changed", {
    member_id: actor.id,
  });
}

export async function resetMemberPassword(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member,
  targetId: string,
  newPassword: string,
): Promise<Member[]> {
  assertCanManageMembers(actor);

  const target = findMember(members, targetId);

  assertCanManageTarget(actor, target);

  if (isOwner(target)) {
    throw new Error("负责人密码请通过修改密码处理。");
  }

  const passwordFields = await createPasswordFields(newPassword);
  const updatedAt = nowIso();
  const nextMembers = updateMember(members, targetId, (member) => ({
    ...member,
    ...passwordFields,
    updated_at: updatedAt,
  }));

  return writeMembersAndEvent(root, nextMembers, actor.id, "member.password_reset", {
    member_id: targetId,
  });
}

export async function addMember(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member,
  input: NewMemberInput,
): Promise<Member[]> {
  assertCanManageMembers(actor);

  const newMember = await createNewMemberRecord(members, input);
  const nextMembers = [...members, newMember];

  return writeMembersAndEvent(root, nextMembers, actor.id, "member.created", {
    member_id: newMember.id,
    roles: newMember.roles,
  });
}

export async function addMemberWithGeneratedKey(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member,
  input: NewMemberInput,
): Promise<NewMemberWithKeyResult> {
  assertCanManageMembers(actor);

  const newMember = await createNewMemberRecord(members, input);
  const generated = await generateMemberSigningKey(newMember);
  const nextMembers = [...members, generated.member];

  const savedMembers = await writeMembersAndEvent(
    root,
    nextMembers,
    actor.id,
    "member.created",
    {
      member_id: generated.member.id,
      roles: generated.member.roles,
      key_id: generated.member.key_id ?? "",
      initial_key_generated: true,
    },
  );

  return {
    members: savedMembers,
    member: generated.member,
    keyFile: generated.keyFile,
  };
}

async function createNewMemberRecord(
  members: Member[],
  input: NewMemberInput,
): Promise<Member> {
  const name = input.name.trim();
  const roles = normalizeRoles(input.roles);

  if (!name) {
    throw new Error("请输入成员名。");
  }

  if (roles.includes("owner")) {
    throw new Error("新增成员不能直接设为负责人。");
  }

  if (members.some((member) => member.name === name)) {
    throw new Error("成员名已存在。");
  }

  const now = nowIso();
  const newMember: Member = {
    id: createId("user"),
    name,
    roles,
    allow_permissions: [],
    deny_permissions: [],
    active: true,
    created_at: now,
    updated_at: now,
    ...(await createPasswordFields(input.password)),
  };

  return newMember;
}

export async function updateMemberRoles(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member,
  input: RoleUpdateInput,
): Promise<Member[]> {
  assertCanManageMembers(actor);

  const target = findMember(members, input.memberId);

  assertCanManageTarget(actor, target);

  if (isOwner(target)) {
    if (!isOwner(actor) || actor.id !== target.id) {
      throw new Error("不能修改当前负责人的用户组。");
    }

    const roles = getUniqueRoles([
      "owner",
      ...input.roles.filter((role) => role !== "owner"),
    ]);
    const nextMembers = updateMember(members, target.id, (member) => ({
      ...member,
      roles,
      updated_at: nowIso(),
    }));

    return writeMembersAndEvent(root, nextMembers, actor.id, "member.roles_updated", {
      member_id: target.id,
      roles,
    });
  }

  const roles = normalizeRoles(input.roles);

  if (roles.includes("owner")) {
    throw new Error("负责人转让需要使用专门的转让操作。");
  }

  const nextMembers = updateMember(members, target.id, (member) => ({
    ...member,
    roles,
    updated_at: nowIso(),
  }));

  return writeMembersAndEvent(root, nextMembers, actor.id, "member.roles_updated", {
    member_id: target.id,
    roles,
  });
}

export async function disableMember(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member,
  targetId: string,
): Promise<Member[]> {
  assertCanManageMembers(actor);

  const target = findMember(members, targetId);

  assertCanManageTarget(actor, target);

  if (target.id === actor.id) {
    throw new Error("不能禁用当前登录的成员。");
  }

  if (isOwner(target)) {
    throw new Error("不能禁用当前负责人。请先转让负责人。");
  }

  const nextMembers = updateMember(members, targetId, (member) => ({
    ...member,
    active: false,
    updated_at: nowIso(),
  }));

  return writeMembersAndEvent(root, nextMembers, actor.id, "member.disabled", {
    member_id: targetId,
  });
}

export async function transferOwner(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member,
  targetId: string,
  previousOwnerRoles: Role[] = ["admin"],
): Promise<Member[]> {
  if (!canTransferOwner(actor)) {
    throw new Error("只有项目负责人可以转让负责人。");
  }

  const target = findMember(members, targetId);

  if (!target.active) {
    throw new Error("不能把负责人转让给已禁用成员。");
  }

  if (target.id === actor.id) {
    throw new Error("请选择另一位成员作为新的负责人。");
  }

  const fallbackRoles = normalizeRoles(previousOwnerRoles).filter(
    (role) => role !== "owner",
  );
  const demotedRoles: Role[] = fallbackRoles.length > 0 ? fallbackRoles : ["admin"];
  const updatedAt = nowIso();
  const nextMembers: Member[] = members.map((member): Member => {
    if (member.id === actor.id) {
      return {
        ...member,
        roles: demotedRoles,
        updated_at: updatedAt,
      };
    }

    if (member.id === target.id) {
      return {
        ...member,
        roles: normalizeRoles([
          "owner",
          ...member.roles.filter((role) => role !== "readonly"),
        ]),
        updated_at: updatedAt,
      };
    }

    return {
      ...member,
      roles: member.roles.filter((role) => role !== "owner"),
    };
  });

  return writeMembersAndEvent(root, nextMembers, actor.id, "member.owner_transferred", {
    previous_owner_id: actor.id,
    new_owner_id: target.id,
    previous_owner_roles: demotedRoles,
  });
}
