<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { PERMISSION_ACTIONS } from "../../model/permissions";
import type { Member, Role } from "../../model/types";
import {
  addMember,
  canManageMember,
  canTransferOwner,
  changeOwnPassword,
  disableMember,
  resetMemberPassword,
  transferOwner,
  updateMemberRoles,
} from "../../services/auth";
import { can, hasRole } from "../../services/permissions";
import type { ProjectDirectoryHandle } from "../../services/projectFs";

const props = defineProps<{
  members: Member[];
  currentUser: Member | null;
  projectRoot?: ProjectDirectoryHandle;
}>();

const emit = defineEmits<{
  membersUpdated: [members: Member[]];
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
const oldPassword = ref("");
const newPassword = ref("");
const ownerTargetId = ref("");
const roleDrafts = reactive<Record<string, Role[]>>({});
const resetDrafts = reactive<Record<string, string>>({});
const isWorking = ref(false);
const message = ref("");
const errorMessage = ref("");

const activeMembers = computed(() => props.members.filter((member) => member.active));
const canManageAnyMember = computed(
  () =>
    Boolean(props.currentUser?.active) &&
    (hasRole(props.currentUser, "owner") || hasRole(props.currentUser, "admin")) &&
    can(props.currentUser, PERMISSION_ACTIONS.PROJECT_MANAGE),
);
const ownerTransferTargets = computed(() =>
  activeMembers.value.filter((member) => !member.roles.includes("owner")),
);

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

function roleText(member: Member): string {
  return member.roles.map((role) => roleLabels[role]).join(" / ");
}

function isCurrentOwner(member: Member): boolean {
  return Boolean(
    props.currentUser?.id === member.id &&
      props.currentUser.active &&
      member.roles.includes("owner"),
  );
}

function canEditMemberRoles(member: Member): boolean {
  return isCurrentOwner(member) || canManageMember(props.currentUser, member);
}

function canResetPassword(member: Member): boolean {
  return !member.roles.includes("owner") && canManageMember(props.currentUser, member);
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

async function runMemberAction(action: () => Promise<Member[]>, success: string) {
  isWorking.value = true;
  clearAlerts();

  try {
    const members = await action();

    emit("membersUpdated", members);
    message.value = success;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "成员管理操作失败。请稍后再试。";
  } finally {
    isWorking.value = false;
  }
}

async function handleAddMember() {
  await runMemberAction(
    () =>
      addMember(getRoot(), props.members, getActor(), {
        name: newMemberName.value,
        roles: newMemberRoles.value,
        password: newMemberPassword.value,
      }),
    "成员已新增。请把初始密码告知该成员。",
  );

  if (!errorMessage.value) {
    newMemberName.value = "";
    newMemberPassword.value = "";
    newMemberRoles.value = ["translator"];
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

  if (
    !window.confirm(`确认要把项目负责人转让给“${target.name}”吗？`) ||
    !window.confirm("再次确认：转让后你将变为管理员。继续转让？")
  ) {
    return;
  }

  await runMemberAction(
    () => transferOwner(getRoot(), props.members, getActor(), ownerTargetId.value),
    "项目负责人已转让。",
  );
}

watch(
  () => props.members,
  () => syncDrafts(),
  { immediate: true, deep: true },
);
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
              <span v-if="member.roles.includes('owner')" class="status-badge owner-badge">
                项目负责人
              </span>
              <span class="status-badge">
                {{ member.active ? "启用" : "已禁用" }}
              </span>
            </div>
          </div>

          <p v-if="member.roles.includes('owner')" class="owner-note">
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
              class="danger-button"
              type="button"
              :disabled="
                isWorking ||
                !member.active ||
                !canManageMember(props.currentUser, member) ||
                member.roles.includes('owner')
              "
              @click="handleDisableMember(member)"
            >
              禁用成员
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
        <label>
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
        <button
          class="danger-button"
          type="button"
          :disabled="isWorking || !ownerTargetId || !canTransferOwner(props.currentUser)"
          @click="handleTransferOwner"
        >
          转让负责人
        </button>
      </div>
    </section>
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

.inline-form,
.owner-transfer {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  gap: 12px;
  align-items: end;
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

.role-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 8px 12px;
}

.role-grid label {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
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
.danger-button {
  min-height: 38px;
  padding: 0 12px;
  border-radius: 6px;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.primary-button {
  border: 1px solid #2f6f73;
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

.danger-button {
  border: 1px solid #b42318;
  background: #b42318;
  color: #ffffff;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

@media (max-width: 760px) {
  .inline-form,
  .owner-transfer {
    grid-template-columns: 1fr;
  }

  .reset-field {
    width: 100%;
  }
}
</style>
