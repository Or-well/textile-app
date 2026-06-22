<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { PERMISSION_ACTIONS } from "../../model/permissions";
import type { Member, ProjectConfig, Role } from "../../model/types";
import {
  exportChangePackage,
  getChangePackageSuggestedFileName,
  type ExportChangePackageOptions,
} from "../../services/changes";
import {
  addMember,
  canManageMember,
  canTransferOwner,
  changeOwnPassword,
  commitPreparedMemberWithGeneratedKey,
  deleteMember,
  disableMember,
  enableMember,
  prepareMemberWithGeneratedKey,
  prepareOwnerTransfer,
  resetMemberPassword,
  updateMemberRoles,
} from "../../services/auth";
import { hasLoadedPrivateKey, memberKeyFileToBlob } from "../../services/keyManager";
import { verifyOwnerTransferKeyProof } from "../../services/keyManager";
import { can, isOwnerMember } from "../../services/permissions";
import type { ProjectDirectoryHandle } from "../../services/projectFs";
import { commitSignedTrustTransition } from "../../services/signingTrustTransition";
import {
  saveGeneratedFile,
  saveGeneratedFileFromFactory,
} from "../../utils/saveBlob";
import { nowIso } from "../../utils/time";
import MemberDeletionDialog from "./MemberDeletionDialog.vue";

const props = defineProps<{
  members: Member[];
  currentUser: Member | null;
  projectRoot?: ProjectDirectoryHandle;
  project?: ProjectConfig | null;
  requireSignedChangePackages: boolean;
}>();

const emit = defineEmits<{
  membersUpdated: [members: Member[]];
  projectUpdated: [project: ProjectConfig];
}>();

const roleOptions: Array<{ role: Role; label: string }> = [
  { role: "admin", label: "管理员" },
  { role: "tech_lead", label: "技术负责人" },
  { role: "translator", label: "翻译" },
  { role: "proofreader", label: "校对" },
  { role: "reviewer", label: "审核" },
  { role: "publisher", label: "发布负责人" },
  { role: "term_manager", label: "术语负责人" },
  { role: "readonly", label: "只读成员" },
];

const roleLabels: Record<Role, string> = {
  owner: "项目负责人",
  admin: "管理员",
  tech_lead: "技术负责人",
  translator: "翻译",
  proofreader: "校对",
  reviewer: "审核",
  publisher: "发布负责人",
  term_manager: "术语负责人",
  readonly: "只读成员",
};

const newMemberName = ref("");
const newMemberPassword = ref("");
const newMemberRoles = ref<Role[]>(["translator"]);
const generateKeyForNewMember = ref(false);
const oldPassword = ref("");
const newPassword = ref("");
const ownerTargetId = ref("");
const ownerTransferProofMemberId = ref("");
const ownerTransferProofKeyId = ref("");
const roleDrafts = reactive<Record<string, Role[]>>({});
const resetDrafts = reactive<Record<string, string>>({});
const memberPendingDeletion = ref<Member | null>(null);
const isWorking = ref(false);
const message = ref("");
const errorMessage = ref("");

const activeMembers = computed(() => props.members.filter((member) => member.active));
const canManageAnyMember = computed(
  () =>
    Boolean(props.currentUser?.active) &&
    can(props.currentUser, PERMISSION_ACTIONS.MEMBER_MANAGE) &&
    can(props.currentUser, PERMISSION_ACTIONS.PROJECT_MANAGE),
);
const ownerTransferTargets = computed(() =>
  activeMembers.value.filter((member) => !isOwnerMember(member)),
);
const selectedOwnerTransferTarget = computed(() =>
  props.members.find((member) => member.id === ownerTargetId.value),
);
const ownerTransferProofStatus = computed(() => {
  const target = selectedOwnerTransferTarget.value;

  if (!ownerTransferProofMemberId.value || !ownerTransferProofKeyId.value) {
    return "未导入交接证明";
  }

  if (
    target &&
    ownerTransferProofMemberId.value === target.id &&
    ownerTransferProofKeyId.value === target.key_id
  ) {
    return `已导入：${target.name} / ${ownerTransferProofKeyId.value}`;
  }

  return "已导入交接证明，但与当前选择的新负责人不匹配";
});
const ownerTransferBlockReason = computed(() => {
  if (isWorking.value) {
    return "成员操作正在处理，请稍后再试。";
  }

  if (!canTransferOwner(props.currentUser)) {
    return "只有当前项目负责人可以转让负责人。";
  }

  if (!props.projectRoot) {
    return "请先打开项目文件夹，才能转让负责人。";
  }

  if (ownerTransferTargets.value.length === 0) {
    return "当前没有可转让的启用成员。";
  }

  if (!ownerTargetId.value) {
    return "请选择新的项目负责人。";
  }

  const target = selectedOwnerTransferTarget.value;

  if (!target) {
    return "没有找到新的项目负责人。";
  }

  if (!target.public_key || !target.key_id || target.key_revoked_at) {
    return "新的项目负责人还没有有效身份公钥。请先在身份密钥页面登记该成员公钥，并确认该成员已保存对应私钥。";
  }

  if (
    ownerTransferProofMemberId.value !== target.id ||
    ownerTransferProofKeyId.value !== target.key_id
  ) {
    return "请导入由新负责人当前私钥生成、绑定当前项目版本的负责人交接证明。";
  }

  if (!props.currentUser || !hasLoadedPrivateKey(props.currentUser)) {
    return "请先在身份密钥页面导入当前负责人的私钥，用旧负责人身份签名过渡项目更新包。";
  }

  return "";
});
const canStartOwnerTransfer = computed(() => ownerTransferBlockReason.value === "");

function getRoot(): ProjectDirectoryHandle {
  if (!props.projectRoot) {
    throw new Error("请先打开项目文件夹。");
  }

  return props.projectRoot;
}

function getActor(): Member {
  if (!props.currentUser) {
    throw new Error("请先登录。");
  }

  return props.currentUser;
}

function getProject(): ProjectConfig {
  if (!props.project) {
    throw new Error("当前项目配置不可用。");
  }

  return props.project;
}

function getProjectRevision(): string {
  const project = getProject();

  return project.revision || project.revision_hash || `schema-${project.schema_version}`;
}

async function handleOwnerTransferProof(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  clearAlerts();

  try {
    const target = selectedOwnerTransferTarget.value;

    if (!target) {
      throw new Error("请先选择新的项目负责人。");
    }

    const proof = await verifyOwnerTransferKeyProof(
      await file.text(),
      target,
      getProject().project_id,
      getProjectRevision(),
    );
    ownerTransferProofMemberId.value = proof.member_id;
    ownerTransferProofKeyId.value = proof.key_id;
    message.value = `已验证 ${target.name} 的负责人交接证明。`;
  } catch (error) {
    ownerTransferProofMemberId.value = "";
    ownerTransferProofKeyId.value = "";
    errorMessage.value =
      error instanceof Error ? error.message : "负责人交接证明验证失败。";
  } finally {
    input.value = "";
  }
}

function roleText(member: Member): string {
  return member.roles.map((role) => roleLabels[role]).join(" / ");
}

function isCurrentOwner(member: Member): boolean {
  return Boolean(
    props.currentUser?.id === member.id &&
      props.currentUser.active &&
      isOwnerMember(member),
  );
}

function canEditMemberRoles(member: Member): boolean {
  return isCurrentOwner(member) || canManageMember(props.currentUser, member);
}

function canResetPassword(member: Member): boolean {
  return !isOwnerMember(member) && canManageMember(props.currentUser, member);
}

function syncDrafts(): void {
  for (const member of props.members) {
    roleDrafts[member.id] = member.roles.filter((role) => role !== "owner");
    resetDrafts[member.id] = resetDrafts[member.id] ?? "";
  }

  ownerTargetId.value =
    ownerTransferTargets.value.find((member) => member.id === ownerTargetId.value)?.id ??
    ownerTransferTargets.value[0]?.id ??
    "";
}

function clearAlerts(): void {
  message.value = "";
  errorMessage.value = "";
}

function toggleRole(list: Role[], role: Role): Role[] {
  return list.includes(role)
    ? list.filter((item) => item !== role)
    : [...list, role];
}

function toggleNewMemberRole(role: Role): void {
  newMemberRoles.value = toggleRole(newMemberRoles.value, role);
}

function toggleMemberRole(memberId: string, role: Role): void {
  roleDrafts[memberId] = toggleRole(roleDrafts[memberId] ?? [], role);
}

async function runMemberAction(
  action: () => Promise<Member[]>,
  success: string,
): Promise<boolean> {
  isWorking.value = true;
  clearAlerts();

  try {
    const members = await action();

    emit("membersUpdated", members);
    message.value = success;
    return true;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "成员管理操作失败。请稍后再试。";
    return false;
  } finally {
    isWorking.value = false;
  }
}

async function handleAddMember() {
  isWorking.value = true;
  clearAlerts();
  let memberAdded = false;

  try {
    if (props.requireSignedChangePackages && generateKeyForNewMember.value) {
      const root = getRoot();
      const actor = getActor();
      const prepared = await prepareMemberWithGeneratedKey(
        props.members,
        actor,
        {
          name: newMemberName.value,
          roles: newMemberRoles.value,
          password: newMemberPassword.value,
        },
      );
      const keyBlob = memberKeyFileToBlob(prepared.keyFile);
      const saved = await saveGeneratedFile(keyBlob.blob, keyBlob.fileName);

      if (!saved.saved) {
        message.value = `${saved.reason} 成员尚未新增，项目中没有登记这把公钥。`;
        return;
      }

      const result = await commitPreparedMemberWithGeneratedKey(root, prepared, actor);
      emit("membersUpdated", result.members);
      message.value = `成员已新增，私钥文件已保存为 ${saved.fileName}。请安全交给该成员本人。`;
      memberAdded = true;
    } else {
      const members = await addMember(getRoot(), props.members, getActor(), {
        name: newMemberName.value,
        roles: newMemberRoles.value,
        password: newMemberPassword.value,
      });

      emit("membersUpdated", members);
      message.value = "成员已新增。请把初始密码告知该成员。";
      memberAdded = true;
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "成员管理操作失败。请稍后再试。";
  } finally {
    isWorking.value = false;
  }

  if (memberAdded) {
    newMemberName.value = "";
    newMemberPassword.value = "";
    newMemberRoles.value = ["translator"];
    generateKeyForNewMember.value = props.requireSignedChangePackages;
  }
}

async function handleSaveRoles(member: Member) {
  await runMemberAction(
    () =>
      updateMemberRoles(getRoot(), props.members, getActor(), {
        memberId: member.id,
        roles: roleDrafts[member.id] ?? [],
      }),
    "成员用户组已更新。",
  );
}

async function handleResetPassword(member: Member) {
  const password = resetDrafts[member.id] ?? "";

  await runMemberAction(
    () => resetMemberPassword(getRoot(), props.members, getActor(), member.id, password),
    "密码已重置。请通知该成员下次使用新密码登录。",
  );

  if (!errorMessage.value) {
    resetDrafts[member.id] = "";
  }
}

async function handleDisableMember(member: Member) {
  if (!window.confirm(`确认要禁用成员“${member.name}”吗？`)) {
    return;
  }

  await runMemberAction(
    () => disableMember(getRoot(), props.members, getActor(), member.id),
    "成员已禁用。",
  );
}

async function handleEnableMember(member: Member) {
  if (
    !window.confirm(
      `确认要重新启用成员“${member.name}”吗？启用后，该成员可使用原密码重新登录。`,
    )
  ) {
    return;
  }

  await runMemberAction(
    () => enableMember(getRoot(), props.members, getActor(), member.id),
    "成员已重新启用。",
  );
}

function requestDeleteMember(member: Member): void {
  clearAlerts();
  memberPendingDeletion.value = member;
}

function cancelDeleteMember(): void {
  if (!isWorking.value) {
    memberPendingDeletion.value = null;
    clearAlerts();
  }
}

async function handleDeleteMember(): Promise<void> {
  const member = memberPendingDeletion.value;

  if (!member) {
    return;
  }

  const deleted = await runMemberAction(
    () => deleteMember(getRoot(), props.members, getActor(), member.id),
    "成员账户已永久删除。历史译文、批注、任务和审计记录仍保留原成员 ID。",
  );

  if (deleted) {
    memberPendingDeletion.value = null;
  }
}

async function handleChangeOwnPassword() {
  await runMemberAction(
    () =>
      changeOwnPassword(
        getRoot(),
        props.members,
        getActor(),
        oldPassword.value,
        newPassword.value,
      ),
    "密码已在当前项目副本中修改。如果你在其他设备或其他副本中使用此项目，请重新导出项目备份。",
  );

  if (!errorMessage.value) {
    oldPassword.value = "";
    newPassword.value = "";
  }
}

async function handleTransferOwner() {
  if (!ownerTargetId.value) {
    errorMessage.value = "请选择新的项目负责人。";
    return;
  }

  const target = props.members.find((member) => member.id === ownerTargetId.value);

  if (!target) {
    errorMessage.value = "没有找到新的项目负责人。";
    return;
  }

  if (!target.public_key || !target.key_id || target.key_revoked_at) {
    errorMessage.value =
      "新的项目负责人还没有有效身份公钥。请先在身份密钥页面登记该成员公钥，并确认该成员已保存对应私钥。";
    message.value = "";
    return;
  }

  const actor = getActor();

  if (!hasLoadedPrivateKey(actor)) {
    errorMessage.value =
      "转让负责人前，需要先导入当前负责人的旧私钥，用旧负责人签名发布包含新负责人的过渡项目更新包。";
    message.value = "";
    return;
  }

  if (
    !window.confirm(
      [
        `确认要把项目负责人转让给“${target.name}”吗？`,
        "",
        "Textile 将先导出一份由当前负责人旧密钥签名、内容包含新负责人和其公钥的项目更新包。成员接收该过渡包后，才能验证新负责人之后发布的项目更新包。",
      ].join("\n"),
    ) ||
    !window.confirm("再次确认：确认过渡项目更新包保存后，当前负责人将变为管理员。继续？")
  ) {
    return;
  }

  isWorking.value = true;
  clearAlerts();

  try {
    const root = getRoot();
    const transfer = prepareOwnerTransfer(
      props.members,
      actor,
      ownerTargetId.value,
    );
    const createdAt = nowIso();
    const exportOptions: ExportChangePackageOptions = {
      mode: "project_update",
      sign: true,
      actor: transfer.previousOwner,
      projectUpdateMembers: transfer.members,
      signatureMember: transfer.previousOwner,
      createdAt,
    };
    let exported: Awaited<ReturnType<typeof exportChangePackage>> | undefined;
    const saved = await saveGeneratedFileFromFactory(
      getChangePackageSuggestedFileName(
        transfer.previousOwner.id,
        exportOptions,
        createdAt,
      ),
      async () => {
        exported = await exportChangePackage(
          transfer.previousOwner.id,
          exportOptions,
        );

        return exported.blob;
      },
    );

    if (!saved.saved) {
      message.value = `${saved.reason} 当前项目负责人没有变化。`;
      return;
    }

    if (!exported) {
      throw new Error("负责人交接过渡包没有生成。");
    }

    const transition = await commitSignedTrustTransition(
      root,
      exported,
      transfer.members,
      actor,
      "member.owner_transferred",
      {
        previous_owner_id: actor.id,
        new_owner_id: transfer.newOwner.id,
        new_owner_key_id: transfer.newOwner.key_id ?? "",
      },
    );

    emit("projectUpdated", transition.project);
    emit("membersUpdated", transition.members);
    ownerTransferProofMemberId.value = "";
    ownerTransferProofKeyId.value = "";
    message.value =
      `项目负责人已转让。过渡包已归档到 ${transition.archivePath}，请分发给成员。`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "成员管理操作失败。请稍后再试。";
  } finally {
    isWorking.value = false;
  }
}

watch(
  () => props.members,
  () => syncDrafts(),
  { immediate: true, deep: true },
);

watch(
  () => props.requireSignedChangePackages,
  (required) => {
    generateKeyForNewMember.value = required;
  },
  { immediate: true },
);

watch(ownerTargetId, () => {
  ownerTransferProofMemberId.value = "";
  ownerTransferProofKeyId.value = "";
});
</script>

<template>
  <div class="member-management">
    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="message" class="message">{{ message }}</p>

    <section class="panel-block">
      <header class="block-header">
        <h3>修改密码</h3>
        <p>当前登录成员可以修改自己的密码。</p>
      </header>

      <div class="inline-form">
        <label>
          <span>旧密码</span>
          <input v-model="oldPassword" type="password" :disabled="isWorking" />
        </label>
        <label>
          <span>新密码</span>
          <input v-model="newPassword" type="password" :disabled="isWorking" />
        </label>
        <button
          class="primary-button"
          type="button"
          :disabled="isWorking || !oldPassword || !newPassword"
          @click="handleChangeOwnPassword"
        >
          修改密码
        </button>
      </div>
    </section>

    <section class="panel-block">
      <header class="block-header">
        <h3>成员列表</h3>
        <p>查看成员、用户组和启用状态。</p>
      </header>

      <div class="member-list">
        <article
          v-for="member in props.members"
          :key="member.id"
          class="member-card"
          :class="{ disabled: !member.active }"
        >
          <div class="member-main">
            <div>
              <strong>{{ member.name }}</strong>
              <p>{{ roleText(member) }}</p>
            </div>
            <div class="member-badges">
              <span v-if="isOwnerMember(member)" class="status-badge owner-badge">
                项目负责人
              </span>
              <span class="status-badge">
                {{ member.active ? "启用" : "已禁用" }}
              </span>
            </div>
          </div>

          <p v-if="isOwnerMember(member)" class="owner-note">
            负责人身份只能通过“转让负责人”变更；这里可修改其他用户组。
          </p>

          <div class="role-grid">
            <label v-for="option in roleOptions" :key="option.role">
              <input
                type="checkbox"
                :checked="roleDrafts[member.id]?.includes(option.role)"
                :disabled="isWorking || !canEditMemberRoles(member)"
                @change="toggleMemberRole(member.id, option.role)"
              />
              <span>{{ option.label }}</span>
            </label>
          </div>

          <div class="member-actions">
            <button
              class="secondary-button"
              type="button"
              :disabled="isWorking || !canEditMemberRoles(member)"
              @click="handleSaveRoles(member)"
            >
              保存用户组
            </button>

            <label class="reset-field">
              <span>新密码</span>
              <input
                v-model="resetDrafts[member.id]"
                type="password"
                :disabled="isWorking || !canResetPassword(member)"
              />
            </label>
            <button
              class="secondary-button"
              type="button"
              :disabled="
                isWorking ||
                !resetDrafts[member.id] ||
                !canResetPassword(member)
              "
              @click="handleResetPassword(member)"
            >
              重置密码
            </button>

            <button
              v-if="member.active"
              class="danger-button"
              type="button"
              :disabled="
                isWorking ||
                !canManageMember(props.currentUser, member) ||
                isOwnerMember(member)
              "
              @click="handleDisableMember(member)"
            >
              禁用成员
            </button>
            <button
              v-else
              class="secondary-button"
              type="button"
              :disabled="isWorking || !canManageMember(props.currentUser, member)"
              @click="handleEnableMember(member)"
            >
              重新启用
            </button>
            <button
              v-if="!member.active"
              class="danger-button"
              type="button"
              :disabled="isWorking || !canManageMember(props.currentUser, member)"
              @click="requestDeleteMember(member)"
            >
              永久删除
            </button>
          </div>
        </article>
      </div>
    </section>

    <section class="panel-block">
      <header class="block-header">
        <h3>新增成员</h3>
        <p>新增后请把初始密码交给成员本人。</p>
      </header>

      <div class="inline-form">
        <label>
          <span>成员名</span>
          <input v-model="newMemberName" :disabled="isWorking || !canManageAnyMember" />
        </label>
        <label>
          <span>密码</span>
          <input
            v-model="newMemberPassword"
            type="password"
            :disabled="isWorking || !canManageAnyMember"
          />
        </label>
      </div>

      <div class="role-grid">
        <label v-for="option in roleOptions" :key="option.role">
          <input
            type="checkbox"
            :checked="newMemberRoles.includes(option.role)"
            :disabled="isWorking || !canManageAnyMember"
            @change="toggleNewMemberRole(option.role)"
          />
          <span>{{ option.label }}</span>
        </label>
      </div>

      <label v-if="requireSignedChangePackages" class="key-option">
        <input
          v-model="generateKeyForNewMember"
          type="checkbox"
          :disabled="isWorking || !canManageAnyMember"
        />
        <span>为该成员生成身份密钥</span>
        <p>
          会为新成员生成用于修改包签名的密钥。公钥会保存到项目中，私钥不会写入项目文件；创建后请立即下载私钥文件，并单独交给该成员。
        </p>
      </label>

      <button
        class="primary-button"
        type="button"
        :disabled="
          isWorking ||
          !canManageAnyMember ||
          !newMemberName.trim() ||
          !newMemberPassword
        "
        @click="handleAddMember"
      >
        新增成员
      </button>
    </section>

    <section class="panel-block">
      <header class="block-header">
        <h3>转让负责人</h3>
        <p>项目负责人只能有一位，转让需要二次确认。</p>
      </header>

      <div class="owner-transfer">
        <label class="owner-transfer-target">
          <span>新的项目负责人</span>
          <select
            v-model="ownerTargetId"
            :disabled="isWorking || !canTransferOwner(props.currentUser)"
          >
            <option
              v-for="member in ownerTransferTargets"
              :key="member.id"
              :value="member.id"
            >
              {{ member.name }}
            </option>
          </select>
        </label>
        <label
          class="file-button owner-transfer-proof-button"
          :class="{ disabled: isWorking || !ownerTargetId }"
        >
          <span>导入交接证明</span>
          <input
            type="file"
            accept=".json,application/json"
            :disabled="isWorking || !ownerTargetId"
            @change="handleOwnerTransferProof"
          />
        </label>
        <button
          class="danger-button owner-transfer-submit"
          type="button"
          :disabled="!canStartOwnerTransfer"
          @click="handleTransferOwner"
        >
          {{ isWorking ? "正在准备转让..." : "转让负责人" }}
        </button>
        <p
          class="owner-transfer-proof-status"
          :class="{
            valid:
              selectedOwnerTransferTarget &&
              ownerTransferProofMemberId === selectedOwnerTransferTarget.id &&
              ownerTransferProofKeyId === selectedOwnerTransferTarget.key_id,
          }"
        >
          {{ ownerTransferProofStatus }}
        </p>
        <p
          v-if="ownerTransferBlockReason"
          class="owner-transfer-note"
        >
          {{ ownerTransferBlockReason }}
        </p>
      </div>
    </section>

    <MemberDeletionDialog
      v-if="memberPendingDeletion"
      :key="memberPendingDeletion.id"
      :member-name="memberPendingDeletion.name"
      :busy="isWorking"
      :error-message="errorMessage"
      @cancel="cancelDeleteMember"
      @confirm="handleDeleteMember"
    />
  </div>
</template>

<style scoped>
.member-management,
.panel-block,
.member-card {
  display: grid;
  gap: 14px;
}

.panel-block {
  padding: 16px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
}

.block-header {
  display: grid;
  gap: 4px;
}

h3,
p {
  margin: 0;
}

h3 {
  color: #111827;
  font-size: 16px;
}

.block-header p,
.member-main p,
label span {
  color: #5b6472;
  font-size: 13px;
  line-height: 1.6;
}

.message,
.error-message {
  padding: 10px 12px;
  border-radius: 6px;
  line-height: 1.6;
}

.message {
  border: 1px solid #b7dfc2;
  color: #166534;
}

.error-message {
  border: 1px solid #f0b8aa;
  color: #b42318;
}

.inline-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  gap: 12px;
  align-items: end;
}

.owner-transfer {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto auto;
  gap: 10px 12px;
  align-items: end;
}

.owner-transfer-target {
  min-width: 0;
}

label {
  display: grid;
  gap: 6px;
}

input,
select {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid #c3ccd8;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
}

input[type="checkbox"] {
  width: 16px;
  height: 16px;
  min-height: 16px;
  padding: 0;
}

input:disabled,
select:disabled {
  background: #f3f4f6;
  color: #6b7280;
}

.member-list {
  display: grid;
  gap: 12px;
}

.member-card {
  padding: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafb;
}

.member-card.disabled {
  opacity: 0.72;
}

.member-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.member-main strong {
  color: #111827;
}

.member-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.status-badge {
  padding: 3px 8px;
  border-radius: 999px;
  background: #eef2f7;
  color: #374151;
  font-size: 12px;
  white-space: nowrap;
}

.owner-badge {
  background: #e8f3f1;
  color: #194b4f;
}

.owner-note {
  padding: 8px 10px;
  border: 1px solid #d7e9e6;
  border-radius: 6px;
  background: #f5fbfa;
  color: #376164;
  font-size: 13px;
  line-height: 1.6;
}

.owner-transfer-note {
  grid-column: 1 / -1;
  padding: 9px 11px;
  border: 1px solid #ead7d2;
  border-radius: 6px;
  background: #fffafa;
  color: #b42318;
  font-size: 13px;
  line-height: 1.6;
}

.owner-transfer-proof-status {
  grid-column: 1 / -1;
  margin: -2px 0 0;
  color: #667085;
  font-size: 13px;
  line-height: 1.5;
}

.owner-transfer-proof-status.valid {
  color: #166534;
}

.role-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 8px 12px;
}

.role-grid label {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
}

.key-option {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  padding: 10px 12px;
  border: 1px solid #d7e9e6;
  border-radius: 6px;
  background: #f5fbfa;
}

.key-option p {
  grid-column: 2;
  color: #376164;
  font-size: 13px;
  line-height: 1.6;
}

.member-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  align-items: end;
}

.reset-field {
  width: 180px;
}

.primary-button,
.secondary-button,
.danger-button,
.file-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 12px;
  border-radius: 6px;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.owner-transfer-proof-button {
  width: auto;
  min-width: 150px;
  white-space: nowrap;
}

.owner-transfer-submit {
  white-space: nowrap;
}

.primary-button {
  border: 1px solid #2f6f73;
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button,
.file-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

.danger-button {
  border: 1px solid #b42318;
  background: #b42318;
  color: #ffffff;
}

button:disabled,
.file-button.disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.file-button input {
  display: none;
}

@media (max-width: 760px) {
  .inline-form,
  .owner-transfer {
    grid-template-columns: 1fr;
  }

  .owner-transfer-proof-button,
  .owner-transfer-submit {
    width: 100%;
  }

  .reset-field {
    width: 100%;
  }
}
</style>
