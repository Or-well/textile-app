import { PERMISSION_ACTIONS } from "../model/permissions";
import type { Member, ProjectConfig } from "../model/types";
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
import { can, canRevokeKey, canRevokeOwnKey } from "./permissions";
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

export interface OwnerTransferKeyProofFile {
  schema_version: 1;
  kind: "textile.owner_transfer_key_proof";
  project_id: string;
  project_revision: string;
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

export interface PreparedOwnSigningKeyRotation extends GeneratedMemberKey {
  previousMember: Member;
  members: Member[];
}

export interface PreparedOwnSigningKeyGeneration extends GeneratedMemberKey {
  previousMember: Member;
  members: Member[];
}

export interface PreparedOwnSigningKeyRevocation {
  previousMember: Member;
  member: Member;
  members: Member[];
}

export interface PreparedMemberPublicKeyRegistration {
  members: Member[];
  member: Member;
  previousMember: Member;
  file: MemberPublicKeyRegistrationFile;
  replacesExistingKey: boolean;
}

export type SigningKeyReadiness =
  | "ready"
  | "missing_public_key"
  | "revoked_key"
  | "private_key_not_loaded";

interface LoadedSigningPrivateKey {
  privateKey: string;
  publicKey: string;
  keyId: string;
}

const privateKeys = new Map<string, LoadedSigningPrivateKey>();

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

function assertCanRevokeOwnKey(actor: Member): void {
  if (!canRevokeOwnKey(actor)) {
    throw new Error("当前成员没有撤销自己身份密钥的权限。");
  }
}

function assertCanRevokeMemberKey(actor: Member, memberId: string): void {
  if (memberId === actor.id) {
    assertCanRevokeOwnKey(actor);
    return;
  }

  if (!canRevokeKey(actor)) {
    throw new Error("当前成员没有撤销其他成员身份密钥的权限。");
  }
}

function assertRevokedKeyIsNotReactivated(member: Member, keyId: string): void {
  if (member.key_revoked_at && member.key_id === keyId) {
    throw new Error("这把身份密钥已经撤销，不能重新启用。请生成或登记一把新密钥。");
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

function createOwnerTransferProofPayload(
  file: Omit<OwnerTransferKeyProofFile, "proof_signature">,
): string {
  return stableStringify(file);
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

function rememberPrivateKey(
  memberId: string,
  privateKey: string,
  publicKey: string,
  keyId: string,
): void {
  privateKeys.set(memberId, { privateKey, publicKey, keyId });
}

export function activatePreparedOwnSigningKey(
  prepared: PreparedOwnSigningKeyGeneration | PreparedOwnSigningKeyRotation,
  actor: Member | null | undefined,
): void {
  assertActor(actor);

  if (prepared.member.id !== actor.id) {
    throw new Error("只能加载当前成员自己的身份私钥。");
  }

  rememberPrivateKey(
    actor.id,
    prepared.privateKey,
    prepared.member.public_key ?? "",
    prepared.member.key_id ?? "",
  );
}

function loadedPrivateKeyMatchesMember(
  member: Member | null | undefined,
  loaded: LoadedSigningPrivateKey | undefined,
): boolean {
  if (
    !member?.public_key ||
    !member.key_id ||
    member.key_revoked_at ||
    !loaded
  ) {
    return false;
  }

  return Boolean(
    loaded.publicKey === member.public_key &&
      loaded.keyId === member.key_id,
  );
}

export function getSigningPrivateKeyForMember(memberId: string): string | null {
  return privateKeys.get(memberId)?.privateKey ?? null;
}

export function getUsableSigningPrivateKey(
  member: Member | null | undefined,
): string | null {
  if (!member?.id) {
    return null;
  }

  const loaded = privateKeys.get(member.id);

  if (!loaded || !loadedPrivateKeyMatchesMember(member, loaded)) {
    return null;
  }

  return loaded.privateKey;
}

export function unloadSigningPrivateKeyForMember(memberId: string): void {
  privateKeys.delete(memberId);
}

export function unloadOwnSigningPrivateKey(
  actor: Member | null | undefined,
): void {
  assertActor(actor);
  privateKeys.delete(actor.id);
}

export function clearLoadedSigningPrivateKeys(): void {
  privateKeys.clear();
}

export function hasLoadedPrivateKey(member: Member | null | undefined): boolean {
  return Boolean(getUsableSigningPrivateKey(member));
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

export async function prepareOwnSigningKeyGeneration(
  members: Member[],
  actor: Member | null | undefined,
): Promise<PreparedOwnSigningKeyGeneration> {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_GENERATE);

  const previousMember = findMember(members, actor.id);
  const generated = await generateMemberSigningKey(previousMember);
  const nextMembers = members.map((member) =>
    member.id === actor.id ? generated.member : member,
  );

  return {
    ...generated,
    previousMember,
    members: nextMembers,
  };
}

export async function commitPreparedOwnSigningKeyGeneration(
  root: ProjectDirectoryHandle,
  generation: PreparedOwnSigningKeyGeneration,
  actor: Member | null | undefined,
): Promise<MemberKeyResult> {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_GENERATE);

  await writeMembers(root, generation.members, actor, "member.key_generated", {
    member_id: actor.id,
    key_id: generation.member.key_id ?? "",
  });

  rememberPrivateKey(
    actor.id,
    generation.privateKey,
    generation.member.public_key ?? "",
    generation.member.key_id ?? "",
  );

  return {
    members: generation.members,
    member: generation.member,
  };
}

export async function generateOwnSigningKey(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member | null | undefined,
): Promise<MemberKeyResult> {
  const generation = await prepareOwnSigningKeyGeneration(members, actor);

  return commitPreparedOwnSigningKeyGeneration(
    root,
    generation,
    actor,
  );
}

export async function rotateOwnSigningKey(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member | null | undefined,
): Promise<MemberKeyResult> {
  const rotation = await prepareOwnSigningKeyRotation(members, actor);

  return commitPreparedOwnSigningKeyRotation(
    root,
    rotation,
    actor,
  );
}

export async function prepareOwnSigningKeyRotation(
  members: Member[],
  actor: Member | null | undefined,
): Promise<PreparedOwnSigningKeyRotation> {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_ROTATE);

  const previousMember = findMember(members, actor.id);
  const generated = await generateMemberSigningKey(previousMember);
  const nextMembers = members.map((member) =>
    member.id === actor.id ? generated.member : member,
  );

  return {
    ...generated,
    previousMember,
    members: nextMembers,
  };
}

export async function commitPreparedOwnSigningKeyRotation(
  root: ProjectDirectoryHandle,
  rotation: PreparedOwnSigningKeyRotation,
  actor: Member | null | undefined,
): Promise<MemberKeyResult> {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_ROTATE);

  await writeMembers(root, rotation.members, actor, "member.key_rotated", {
    member_id: actor.id,
    key_id: rotation.member.key_id ?? "",
  });

  rememberPrivateKey(
    actor.id,
    rotation.privateKey,
    rotation.member.public_key ?? "",
    rotation.member.key_id ?? "",
  );

  return {
    members: rotation.members,
    member: rotation.member,
  };
}

export async function prepareOwnSigningKeyRevocation(
  members: Member[],
  actor: Member | null | undefined,
  project?: ProjectConfig,
): Promise<PreparedOwnSigningKeyRevocation> {
  assertActor(actor);
  assertCanRevokeOwnKey(actor);

  const previousMember = findMember(members, actor.id);

  if (
    !previousMember.public_key ||
    !previousMember.key_id ||
    previousMember.key_revoked_at
  ) {
    throw new Error("当前没有可撤销的有效身份公钥。");
  }

  assertPublisherKeyCanBeRevoked(members, previousMember, project);

  const updatedAt = nowIso();
  const revokedMember: Member = {
    ...previousMember,
    key_revoked_at: updatedAt,
    updated_at: updatedAt,
  };
  const nextMembers = members.map((member) =>
    member.id === actor.id ? revokedMember : member,
  );

  return {
    previousMember,
    member: revokedMember,
    members: nextMembers,
  };
}

export async function commitPreparedOwnSigningKeyRevocation(
  root: ProjectDirectoryHandle,
  revocation: PreparedOwnSigningKeyRevocation,
  actor: Member | null | undefined,
): Promise<MemberKeyResult> {
  assertActor(actor);
  assertCanRevokeOwnKey(actor);

  if (actor.id !== revocation.previousMember.id) {
    throw new Error("只有当前密钥持有人可以完成身份密钥撤销。");
  }

  privateKeys.delete(actor.id);

  await writeMembers(root, revocation.members, actor, "member.key_revoked", {
    member_id: actor.id,
    key_id: revocation.member.key_id ?? "",
  });

  return {
    members: revocation.members,
    member: revocation.member,
  };
}

export async function revokeOwnSigningKey(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member | null | undefined,
  project?: ProjectConfig,
): Promise<MemberKeyResult> {
  const revocation = await prepareOwnSigningKeyRevocation(
    members,
    actor,
    project,
  );

  return commitPreparedOwnSigningKeyRevocation(
    root,
    revocation,
    actor,
  );
}

export async function revokeMemberPublicKey(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member | null | undefined,
  memberId: string,
  project?: ProjectConfig,
): Promise<MemberKeyResult> {
  assertActor(actor);
  assertCanRevokeMemberKey(actor, memberId);

  const target = findMember(members, memberId);
  assertPublisherKeyCanBeRevoked(members, target, project);
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

function assertPublisherKeyCanBeRevoked(
  members: Member[],
  target: Member,
  project?: ProjectConfig,
): void {
  if (
    !project ||
    !can(
      target,
      PERMISSION_ACTIONS.CHANGE_PACKAGE_EXPORT_PROJECT_UPDATE,
      project,
    )
  ) {
    return;
  }

  const hasOtherTrustedPublisher = members.some(
    (member) =>
      member.id !== target.id &&
      member.active &&
      Boolean(member.public_key && member.key_id && !member.key_revoked_at) &&
      can(
        member,
        PERMISSION_ACTIONS.CHANGE_PACKAGE_EXPORT_PROJECT_UPDATE,
        project,
      ),
  );

  if (!hasOtherTrustedPublisher) {
    throw new Error(
      "不能撤销项目中最后一把可信发布密钥。请先轮换密钥、建立另一名可信发布者，或在线下重建项目信任。",
    );
  }
}

export function exportOwnKeyFile(
  members: Member[],
  actor: Member | null | undefined,
): { blob: Blob; fileName: string } {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_EXPORT_PRIVATE);

  const member = findMember(members, actor.id);
  const privateKey = getUsableSigningPrivateKey(member);

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
  const privateKey = getUsableSigningPrivateKey(member);

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

export async function exportPreparedPublicKeyRegistrationFile(
  prepared: PreparedOwnSigningKeyGeneration | PreparedOwnSigningKeyRotation,
  projectId: string,
): Promise<{ blob: Blob; fileName: string }> {
  const member = prepared.member;

  if (!member.public_key || !member.key_id) {
    throw new Error("恢复密钥尚未生成公钥。");
  }

  const unsigned: Omit<MemberPublicKeyRegistrationFile, "proof_signature"> = {
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
    ...unsigned,
    proof_signature: await signTextWithPrivateKey(
      prepared.privateKey,
      createPublicKeyProofPayload(unsigned),
    ),
  };

  return {
    blob: new Blob([`${JSON.stringify(file, null, 2)}\n`], {
      type: "application/json",
    }),
    fileName: "member-public-key.json",
  };
}

export async function exportOwnOwnerTransferKeyProof(
  members: Member[],
  actor: Member | null | undefined,
  projectId: string,
  projectRevision: string,
): Promise<{ blob: Blob; fileName: string }> {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_EXPORT_PRIVATE);

  const member = findMember(members, actor.id);
  const privateKey = getUsableSigningPrivateKey(member);

  if (!member.public_key || !member.key_id || !privateKey || member.key_revoked_at) {
    throw new Error("当前成员没有可用于负责人交接证明的有效私钥。");
  }

  const unsigned: Omit<OwnerTransferKeyProofFile, "proof_signature"> = {
    schema_version: 1,
    kind: "textile.owner_transfer_key_proof",
    project_id: projectId,
    project_revision: projectRevision,
    member_id: member.id,
    member_name: member.name,
    key_id: member.key_id,
    public_key: member.public_key,
    created_at: nowIso(),
    algorithm: CHANGE_PACKAGE_SIGNATURE_ALGORITHM,
  };
  const file: OwnerTransferKeyProofFile = {
    ...unsigned,
    proof_signature: await signTextWithPrivateKey(
      privateKey,
      createOwnerTransferProofPayload(unsigned),
    ),
  };

  return {
    blob: new Blob([`${JSON.stringify(file, null, 2)}\n`], {
      type: "application/json",
    }),
    fileName: "owner-transfer-key-proof.json",
  };
}

export async function verifyOwnerTransferKeyProof(
  text: string,
  member: Member,
  projectId: string,
  projectRevision: string,
): Promise<OwnerTransferKeyProofFile> {
  let file: OwnerTransferKeyProofFile;

  try {
    file = JSON.parse(text) as OwnerTransferKeyProofFile;
  } catch {
    throw new Error("负责人交接证明文件格式不正确。");
  }

  if (
    file.kind !== "textile.owner_transfer_key_proof" ||
    file.schema_version !== 1 ||
    file.algorithm !== CHANGE_PACKAGE_SIGNATURE_ALGORITHM
  ) {
    throw new Error("这不是可识别的负责人交接证明文件。");
  }

  if (
    file.project_id !== projectId ||
    file.project_revision !== projectRevision ||
    file.member_id !== member.id ||
    file.key_id !== member.key_id ||
    file.public_key !== member.public_key ||
    member.key_revoked_at
  ) {
    throw new Error("负责人交接证明与当前项目、成员或公钥不匹配。");
  }

  const createdAt = Date.parse(file.created_at);
  const age = Date.now() - createdAt;

  if (!Number.isFinite(createdAt) || age < -5 * 60 * 1000 || age > 24 * 60 * 60 * 1000) {
    throw new Error("负责人交接证明已过期，请由新负责人重新生成。");
  }

  const { proof_signature: _proofSignature, ...unsigned } = file;
  const valid = await verifyTextSignature(
    file.public_key,
    createOwnerTransferProofPayload(unsigned),
    file.proof_signature,
  );

  if (!valid) {
    throw new Error("负责人交接证明签名无效。");
  }

  return file;
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
  const prepared = await prepareMemberPublicKeyRegistration(
    members,
    actor,
    projectId,
    text,
    options,
  );

  await writeMembers(
    root,
    prepared.members,
    actor as Member,
    prepared.replacesExistingKey
      ? "member.public_key_rotated"
      : "member.public_key_registered",
    {
      member_id: prepared.member.id,
      key_id: prepared.member.key_id ?? "",
    },
  );

  return {
    members: prepared.members,
    member: prepared.member,
  };
}

export async function prepareMemberPublicKeyRegistration(
  members: Member[],
  actor: Member | null | undefined,
  projectId: string,
  text: string,
  options: { allowReplace?: boolean } = {},
): Promise<PreparedMemberPublicKeyRegistration> {
  assertActor(actor);
  assertPermission(actor, PERMISSION_ACTIONS.KEY_REGISTER_PUBLIC);

  const file = await parsePublicKeyRegistrationFile(text);

  if (file.project_id !== projectId) {
    throw new Error("公钥登记文件不属于当前项目。");
  }

  const target = findMember(members, file.member_id);
  assertRevokedKeyIsNotReactivated(target, file.key_id);
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

  return {
    members: nextMembers,
    member: nextMember,
    previousMember: target,
    file,
    replacesExistingKey: hasDifferentPublicKey,
  };
}

export async function importOwnKeyFile(
  root: ProjectDirectoryHandle,
  members: Member[],
  actor: Member | null | undefined,
  text: string,
  options: {
    requireExistingPublicKeyMatch?: boolean;
    allowPublicKeyReplacement?: boolean;
  } = {},
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
  const member = findMember(members, actor.id);
  const hasActiveDifferentPublicKey =
    Boolean(member.public_key && member.key_id && !member.key_revoked_at) &&
    (member.public_key !== keyFile.public_key || member.key_id !== keyFile.key_id);

  if (
    options.requireExistingPublicKeyMatch &&
    (!member.public_key ||
      !member.key_id ||
      member.public_key !== keyFile.public_key ||
      member.key_id !== keyFile.key_id)
  ) {
    throw new Error("私钥文件和项目中当前登记的公钥不匹配。请确认选择的是这名成员对应的私钥文件。");
  }

  if (hasActiveDifferentPublicKey && !options.allowPublicKeyReplacement) {
    throw new Error("项目中已经登记了不同公钥。请导入当前公钥对应的私钥；如果确实要换钥，请使用生成新密钥或密钥轮换流程。");
  }

  assertRevokedKeyIsNotReactivated(member, keyFile.key_id);
  const result = await updateOwnPublicKey(
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

  rememberPrivateKey(
    actor.id,
    keyFile.private_key,
    keyFile.public_key,
    keyFile.key_id,
  );

  return result;
}
