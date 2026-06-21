import { PERMISSION_ACTIONS } from "../model/permissions";
import type { Member } from "../model/types";
import { nowIso } from "../utils/time";
import {
  CHANGE_PACKAGE_SIGNATURE_ALGORITHM,
  createKeyId,
  generateSigningKeyPair,
  signTextWithPrivateKey,
  stableStringify,
  verifyTextSignature,
} from "./crypto";
import { appendEventToRoot } from "./history";
import { can } from "./permissions";
import { saveMembers } from "./project";
import type { ProjectDirectoryHandle } from "./projectFs";

export interface MemberKeyFile {
  schema_version: 1;
  kind: "textile.member_key";
  member_id: string;
  member_name?: string;
  key_id: string;
  public_key: string;
  private_key: string;
  created_at: string;
}

export interface MemberPublicKeyRegistrationFile {
  schema_version: 1;
  kind: "textile.member_public_key";
  project_id: string;
  member_id: string;
  member_name?: string;
  key_id: string;
  public_key: string;
  created_at: string;
  algorithm: typeof CHANGE_PACKAGE_SIGNATURE_ALGORITHM;
  proof_signature: string;
}

export interface MemberKeyResult {
  members: Member[];
  member: Member;
}

export interface GeneratedMemberKey {
  member: Member;
  privateKey: string;
  keyFile: MemberKeyFile;
}

export type SigningKeyReadiness =
  | "ready"
  | "missing_public_key"
  | "revoked_key"
  | "private_key_not_loaded";

const privateKeys = new Map<string, string>();

function findMember(members: Member[], memberId: string): Member {
  const member = members.find((item) => item.id === memberId);

  if (!member) {
    throw new Error("没有找到当前成员。");
  }

  return member;
}

function assertActor(actor: Member | null | undefined): asserts actor is Member {
  if (!actor?.active) {
    throw new Error("请先登录成员账号。");
  }
}

function assertPermission(actor: Member, action: string): void {
  if (!can(actor, action)) {
    throw new Error("当前成员没有管理身份密钥的权限。");
  }
}

function createPrivateKeyFile(member: Member, privateKey: string): MemberKeyFile {
  if (!member.public_key || !member.key_id) {
    throw new Error("成员尚未登记公钥，无法生成私钥文件。");
  }

  return {
    schema_version: 1,
    kind: "textile.member_key",
    member_id: member.id,
    member_name: member.name,
    key_id: member.key_id,
    public_key: member.public_key,
    private_key: privateKey,
    created_at: member.key_created_at || nowIso(),
  };
}

function createKeyFileBlob(keyFile: MemberKeyFile): { blob: Blob; fileName: string } {
  return {
    blob: new Blob([`${JSON.stringify(keyFile, null, 2)}\n`], {
      type: "application/json",
    }),
    fileName: "member-key.json",
  };
}

function createPublicKeyProofPayload(
  file: Omit<MemberPublicKeyRegistrationFile, "proof_signature">,
): string {
  return stableStringify({
    kind: file.kind,
    project_id: file.project_id,
    member_id: file.member_id,
    key_id: file.key_id,
    public_key: file.public_key,
    algorithm: file.algorithm,
  });
}

async function writeMembers(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member,
  eventType: string,
  detail: Record<string, unknown>,
): Promise<Member[]> {
  await saveMembers(root, members);
  await appendEventToRoot(root, {
    type: eventType,
    user_id: actor.id,
    detail,
  });

  return members;
}

async function updateOwnPublicKey(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member,
  patch: Partial<Member>,
  eventType: string,
): Promise<MemberKeyResult> {
  const currentMember = findMember(members, actor.id);
  const updatedAt = nowIso();
  const nextMember: Member = {
    ...currentMember,
    ...patch,
    updated_at: updatedAt,
  };
  const nextMembers = members.map((member) =>
    member.id === actor.id ? nextMember : member,
  );

  await writeMembers(root, nextMembers, actor, eventType, {
    member_id: actor.id,
    key_id: nextMember.key_id ?? "",
  });

  return {
    members: nextMembers,
    member: nextMember,
  };
}

export function getSigningPrivateKeyForMember(memberId: string): string | null {
  return privateKeys.get(memberId) ?? null;
}

export function hasLoadedPrivateKey(member: Member | null | undefined): boolean {
  return Boolean(member?.id && privateKeys.has(member.id));
}

export function getMemberSigningReadiness(
  member: Member | null | undefined,
): SigningKeyReadiness {
  if (!member?.public_key || !member.key_id) {
    return "missing_public_key";
  }

  if (member.key_revoked_at) {
    return "revoked_key";
  }

  if (!hasLoadedPrivateKey(member)) {
    return "private_key_not_loaded";
  }

  return "ready";
}

export function hasUsableSigningKey(member: Member | null | undefined): boolean {
  return getMemberSigningReadiness(member) === "ready";
}

export async function generateMemberSigningKey(
  member: Member,
): Promise<GeneratedMemberKey> {
  const keyPair = await generateSigningKeyPair();
  const createdAt = nowIso();
  const nextMember: Member = {
    ...member,
    public_key: keyPair.publicKey,
    key_id: keyPair.keyId,
    key_created_at: createdAt,
    key_revoked_at: "",
    updated_at: createdAt,
  };

  return {
    member: nextMember,
    privateKey: keyPair.privateKey,
    keyFile: createPrivateKeyFile(nextMember, keyPair.privateKey),
  };
}

export function memberKeyFileToBlob(
  keyFile: MemberKeyFile,
): { blob: Blob; fileName: string } {
  return createKeyFileBlob(keyFile);
}

export async function generateOwnSigningKey(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member | null | undefined,
): Promise<MemberKeyResult> {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_GENERATE);

  const keyPair = await generateSigningKeyPair();
  const createdAt = nowIso();

  privateKeys.set(actor.id, keyPair.privateKey);

  return updateOwnPublicKey(
    root,
    members,
    actor,
    {
      public_key: keyPair.publicKey,
      key_id: keyPair.keyId,
      key_created_at: createdAt,
      key_revoked_at: "",
    },
    "member.key_generated",
  );
}

export async function rotateOwnSigningKey(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member | null | undefined,
): Promise<MemberKeyResult> {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_ROTATE);

  const keyPair = await generateSigningKeyPair();
  const createdAt = nowIso();

  privateKeys.set(actor.id, keyPair.privateKey);

  return updateOwnPublicKey(
    root,
    members,
    actor,
    {
      public_key: keyPair.publicKey,
      key_id: keyPair.keyId,
      key_created_at: createdAt,
      key_revoked_at: "",
    },
    "member.key_rotated",
  );
}

export async function revokeOwnSigningKey(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member | null | undefined,
): Promise<MemberKeyResult> {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_REVOKE);

  privateKeys.delete(actor.id);

  return updateOwnPublicKey(
    root,
    members,
    actor,
    {
      key_revoked_at: nowIso(),
    },
    "member.key_revoked",
  );
}

export async function revokeMemberPublicKey(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member | null | undefined,
  memberId: string,
): Promise<MemberKeyResult> {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_REVOKE);

  const target = findMember(members, memberId);
  const updatedMember: Member = {
    ...target,
    key_revoked_at: nowIso(),
    updated_at: nowIso(),
  };
  const nextMembers = members.map((member) =>
    member.id === memberId ? updatedMember : member,
  );

  if (memberId === actor.id) {
    privateKeys.delete(actor.id);
  }

  await writeMembers(root, nextMembers, actor, "member.key_revoked", {
    member_id: memberId,
    key_id: updatedMember.key_id ?? "",
  });

  return {
    members: nextMembers,
    member: updatedMember,
  };
}

export function exportOwnKeyFile(
  members: Member[],
  actor: Member | null | undefined,
): { blob: Blob; fileName: string } {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_EXPORT_PRIVATE);

  const member = findMember(members, actor.id);
  const privateKey = getSigningPrivateKeyForMember(actor.id);

  if (!member.public_key || !member.key_id || !privateKey || member.key_revoked_at) {
    throw new Error("当前没有可导出的有效私钥文件。请先生成签名密钥或导入私钥文件。");
  }

  return createKeyFileBlob(createPrivateKeyFile(member, privateKey));
}

async function assertKeyFileMatches(keyFile: MemberKeyFile): Promise<void> {
  const keyId = await createKeyId(keyFile.public_key);
  const payload = stableStringify({
    member_id: keyFile.member_id,
    key_id: keyFile.key_id,
  });
  const signature = await signTextWithPrivateKey(keyFile.private_key, payload);
  const verified = await verifyTextSignature(
    keyFile.public_key,
    payload,
    signature,
  );

  if (keyId !== keyFile.key_id || !verified) {
    throw new Error("私钥文件和公钥不匹配。");
  }
}

export async function exportOwnPublicKeyRegistrationFile(
  members: Member[],
  actor: Member | null | undefined,
  projectId: string,
): Promise<{ blob: Blob; fileName: string }> {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_EXPORT_PRIVATE);

  const member = findMember(members, actor.id);
  const privateKey = getSigningPrivateKeyForMember(actor.id);

  if (!member.public_key || !member.key_id || !privateKey || member.key_revoked_at) {
    throw new Error("当前没有可导出的有效公钥登记文件。请先生成或导入私钥文件。");
  }

  const fileWithoutProof: Omit<MemberPublicKeyRegistrationFile, "proof_signature"> = {
    schema_version: 1,
    kind: "textile.member_public_key",
    project_id: projectId,
    member_id: member.id,
    member_name: member.name,
    key_id: member.key_id,
    public_key: member.public_key,
    created_at: member.key_created_at || nowIso(),
    algorithm: CHANGE_PACKAGE_SIGNATURE_ALGORITHM,
  };
  const file: MemberPublicKeyRegistrationFile = {
    ...fileWithoutProof,
    proof_signature: await signTextWithPrivateKey(
      privateKey,
      createPublicKeyProofPayload(fileWithoutProof),
    ),
  };

  return {
    blob: new Blob([`${JSON.stringify(file, null, 2)}\n`], {
      type: "application/json",
    }),
    fileName: "member-public-key.json",
  };
}

async function parsePublicKeyRegistrationFile(
  text: string,
): Promise<MemberPublicKeyRegistrationFile> {
  let file: MemberPublicKeyRegistrationFile;

  try {
    file = JSON.parse(text) as MemberPublicKeyRegistrationFile;
  } catch {
    throw new Error("公钥登记文件格式不正确。");
  }

  if (file.kind !== "textile.member_public_key" || file.schema_version !== 1) {
    throw new Error("这不是可识别的公钥登记文件。");
  }

  if (file.algorithm !== CHANGE_PACKAGE_SIGNATURE_ALGORITHM) {
    throw new Error("公钥登记文件的签名算法不受支持。");
  }

  const keyId = await createKeyId(file.public_key);
  const payload = createPublicKeyProofPayload({
    schema_version: file.schema_version,
    kind: file.kind,
    project_id: file.project_id,
    member_id: file.member_id,
    member_name: file.member_name,
    key_id: file.key_id,
    public_key: file.public_key,
    created_at: file.created_at,
    algorithm: file.algorithm,
  });
  const verified = await verifyTextSignature(
    file.public_key,
    payload,
    file.proof_signature,
  );

  if (keyId !== file.key_id || !verified) {
    throw new Error("公钥登记文件的持有证明无效。");
  }

  return file;
}

export async function previewMemberPublicKeyRegistrationFile(
  text: string,
): Promise<MemberPublicKeyRegistrationFile> {
  return parsePublicKeyRegistrationFile(text);
}

export async function importMemberPublicKeyRegistrationFile(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member | null | undefined,
  projectId: string,
  text: string,
  options: { allowReplace?: boolean } = {},
): Promise<MemberKeyResult> {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_REGISTER_PUBLIC);

  const file = await parsePublicKeyRegistrationFile(text);

  if (file.project_id !== projectId) {
    throw new Error("公钥登记文件不属于当前项目。");
  }

  const target = findMember(members, file.member_id);
  const hasDifferentPublicKey =
    Boolean(target.public_key && target.key_id) &&
    (target.public_key !== file.public_key || target.key_id !== file.key_id);

  if (hasDifferentPublicKey && !options.allowReplace) {
    throw new Error("该成员已有不同公钥。请确认轮换后再导入。");
  }

  const updatedAt = nowIso();
  const nextMember: Member = {
    ...target,
    public_key: file.public_key,
    key_id: file.key_id,
    key_created_at: file.created_at || updatedAt,
    key_revoked_at: "",
    updated_at: updatedAt,
  };
  const nextMembers = members.map((member) =>
    member.id === target.id ? nextMember : member,
  );

  await writeMembers(
    root,
    nextMembers,
    actor,
    hasDifferentPublicKey ? "member.public_key_rotated" : "member.public_key_registered",
    {
      member_id: target.id,
      key_id: file.key_id,
    },
  );

  return {
    members: nextMembers,
    member: nextMember,
  };
}

export async function importOwnKeyFile(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member | null | undefined,
  text: string,
): Promise<MemberKeyResult> {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_IMPORT_PRIVATE);

  let keyFile: MemberKeyFile;

  try {
    keyFile = JSON.parse(text) as MemberKeyFile;
  } catch {
    throw new Error("私钥文件格式不正确。");
  }

  if (keyFile.kind !== "textile.member_key" || keyFile.schema_version !== 1) {
    throw new Error("这不是可识别的私钥文件。");
  }

  if (keyFile.member_id !== actor.id) {
    throw new Error("私钥文件不属于当前成员。");
  }

  await assertKeyFileMatches(keyFile);
  privateKeys.set(actor.id, keyFile.private_key);

  return updateOwnPublicKey(
    root,
    members,
    actor,
    {
      public_key: keyFile.public_key,
      key_id: keyFile.key_id,
      key_created_at: keyFile.created_at || nowIso(),
      key_revoked_at: "",
    },
    "member.key_imported",
  );
}
