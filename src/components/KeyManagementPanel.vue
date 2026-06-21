<script setup lang="ts">
import { computed, ref } from "vue";
import type { Member } from "../model/types";
import {
  exportOwnPublicKeyRegistrationFile,
  exportOwnKeyFile,
  generateOwnSigningKey,
  hasLoadedPrivateKey,
  importMemberPublicKeyRegistrationFile,
  importOwnKeyFile,
  previewMemberPublicKeyRegistrationFile,
  revokeMemberPublicKey,
  revokeOwnSigningKey,
  rotateOwnSigningKey,
} from "../services/keyManager";
import {
  canExportPrivateKey,
  canGenerateKey,
  canImportPrivateKey,
  canRegisterPublicKey,
  canRevokeKey,
  canRotateKey,
  canViewKey,
} from "../services/permissions";
import type { ProjectDirectoryHandle } from "../services/projectFs";
import { saveBlob } from "../utils/saveBlob";
import { formatDateTime } from "../utils/time";

const props = defineProps<{
  members: Member[];
  currentUser?: Member | null;
  projectRoot?: ProjectDirectoryHandle;
  projectId?: string;
}>();

const emit = defineEmits<{
  membersUpdated: [members: Member[]];
}>();

const isWorking = ref(false);
const message = ref("");
const errorMessage = ref("");

const ownMember = computed(
  () => props.members.find((member) => member.id === props.currentUser?.id) ?? null,
);
const canViewKeys = computed(() => canViewKey(props.currentUser));
const canGenerateKeys = computed(() => canGenerateKey(props.currentUser));
const canImportPrivate = computed(() => canImportPrivateKey(props.currentUser));
const canExportPrivate = computed(() => canExportPrivateKey(props.currentUser));
const canRegisterPublic = computed(() => canRegisterPublicKey(props.currentUser));
const canRotateKeys = computed(() => canRotateKey(props.currentUser));
const canRevokeKeys = computed(() => canRevokeKey(props.currentUser));
const ownPrivateLoaded = computed(() => hasLoadedPrivateKey(ownMember.value));
const hasOwnPublicKey = computed(() =>
  Boolean(ownMember.value?.public_key && ownMember.value.key_id),
);
const hasActiveOwnPublicKey = computed(
  () => hasOwnPublicKey.value && !ownMember.value?.key_revoked_at,
);
const ownKeyStatus = computed(() => describeKeyStatus(ownMember.value));
const primaryKeyButtonText = computed(() =>
  hasOwnPublicKey.value ? "生成新的签名密钥" : "生成签名密钥",
);
const canUsePrimaryKeyAction = computed(() =>
  hasOwnPublicKey.value ? canRotateKeys.value : canGenerateKeys.value,
);

function getRoot(): ProjectDirectoryHandle {
  if (!props.projectRoot) {
    throw new Error("请先打开项目。");
  }

  return props.projectRoot;
}

function getProjectId(): string {
  if (!props.projectId) {
    throw new Error("当前项目缺少项目 ID，无法处理公钥登记文件。");
  }

  return props.projectId;
}

function describeKeyStatus(member: Member | null | undefined): string {
  if (!member?.public_key || !member.key_id) {
    return "项目未登记公钥";
  }

  if (member.key_revoked_at) {
    return "公钥已撤销";
  }

  return hasLoadedPrivateKey(member)
    ? "已加载私钥，可签名"
    : "项目已有公钥，本机未加载私钥";
}

function describeMemberPublicKeyStatus(member: Member): string {
  if (!member.public_key || !member.key_id) {
    return "未登记公钥";
  }

  return member.key_revoked_at ? "公钥已撤销" : "公钥有效";
}

function keyDate(member: Member): string {
  const value = member.key_revoked_at || member.key_created_at || "";

  return value ? formatDateTime(value) || "时间无效" : "";
}

async function runAction(action: () => Promise<string>): Promise<void> {
  isWorking.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    message.value = await action();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "身份密钥操作失败。";
  } finally {
    isWorking.value = false;
  }
}

async function handleGenerateKey() {
  await runAction(async () => {
    const result = await generateOwnSigningKey(
      getRoot(),
      props.members,
      props.currentUser,
    );

    emit("membersUpdated", result.members);
    return "签名密钥已生成。公钥已写入项目；请立即导出私钥文件并妥善保存。";
  });
}

async function handleGenerateNewKey() {
  if (
    !window.confirm(
      "生成新的签名密钥后，项目会登记新公钥，新的修改包会使用新私钥签名。继续？",
    )
  ) {
    return;
  }

  await runAction(async () => {
    const result = await rotateOwnSigningKey(
      getRoot(),
      props.members,
      props.currentUser,
    );

    emit("membersUpdated", result.members);
    return "新的签名密钥已生成。请导出新的私钥文件。";
  });
}

async function handlePrimaryKeyAction() {
  if (hasOwnPublicKey.value) {
    await handleGenerateNewKey();
    return;
  }

  await handleGenerateKey();
}

async function handleRevokeOwnKey() {
  if (
    !window.confirm(
      "撤销后，项目将不再接受当前公钥对应私钥签出的新修改包。继续？",
    )
  ) {
    return;
  }

  await runAction(async () => {
    const result = await revokeOwnSigningKey(
      getRoot(),
      props.members,
      props.currentUser,
    );

    emit("membersUpdated", result.members);
    return "当前公钥已撤销。";
  });
}

async function handleRevokeMemberKey(member: Member) {
  if (
    !window.confirm(
      `撤销 ${member.name} 的公钥？撤销后，项目将不再接受这把公钥对应私钥签出的新修改包。`,
    )
  ) {
    return;
  }

  await runAction(async () => {
    const result = await revokeMemberPublicKey(
      getRoot(),
      props.members,
      props.currentUser,
      member.id,
    );

    emit("membersUpdated", result.members);
    return "成员公钥已撤销。";
  });
}

async function saveKeyBlob(blob: Blob, fileName: string, label: string): Promise<string> {
  const result = await saveBlob(blob, fileName);

  if (!result.saved) {
    return `${label}保存已取消。`;
  }

  if (result.method === "file-picker") {
    return `${label}已保存为 ${result.fileName}。`;
  }

  return `${label}下载已开始。请在浏览器下载列表或系统“下载”文件夹中确认保存结果。`;
}

async function handleExportPrivateKey() {
  await runAction(async () => {
    const result = exportOwnKeyFile(props.members, props.currentUser);

    return `${await saveKeyBlob(
      result.blob,
      result.fileName,
      "私钥文件",
    )} 私钥可以代表你签名修改包，请不要交给其他人。`;
  });
}

async function handleExportPublicKey() {
  await runAction(async () => {
    const result = await exportOwnPublicKeyRegistrationFile(
      props.members,
      props.currentUser,
      getProjectId(),
    );

    return `${await saveKeyBlob(
      result.blob,
      result.fileName,
      "公钥登记文件",
    )} 这个文件不包含私钥，可交给负责人登记公钥。`;
  });
}

async function handleImportKey(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  await runAction(async () => {
    const result = await importOwnKeyFile(
      getRoot(),
      props.members,
      props.currentUser,
      await file.text(),
    );

    emit("membersUpdated", result.members);
    return "私钥文件已导入，本机可用于导出签名修改包。";
  });

  input.value = "";
}

async function handleImportPublicKey(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  await runAction(async () => {
    const text = await file.text();
    const preview = await previewMemberPublicKeyRegistrationFile(text);
    const target = props.members.find((member) => member.id === preview.member_id);

    if (!target) {
      throw new Error("公钥登记文件对应的成员不存在。");
    }

    const hasDifferentPublicKey =
      Boolean(target.public_key && target.key_id) &&
      (target.public_key !== preview.public_key || target.key_id !== preview.key_id);

    if (
      hasDifferentPublicKey &&
      !window.confirm(
        `成员“${target.name}”已有不同公钥。替换后，旧私钥签出的新修改包将不再通过验证。继续登记新公钥？`,
      )
    ) {
      return "公钥登记已取消。";
    }

    const result = await importMemberPublicKeyRegistrationFile(
      getRoot(),
      props.members,
      props.currentUser,
      getProjectId(),
      text,
      { allowReplace: hasDifferentPublicKey },
    );

    emit("membersUpdated", result.members);
    return hasDifferentPublicKey
      ? `已为 ${result.member.name} 轮换公钥。`
      : `已为 ${result.member.name} 登记公钥。`;
  });

  input.value = "";
}
</script>

<template>
  <section class="key-panel">
    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
    <p v-if="message" class="success-text">{{ message }}</p>
    <p v-if="!canViewKeys" class="notice-text">当前用户不能查看身份密钥状态。</p>

    <template v-else>
      <div class="own-key-summary">
        <div>
          <span>当前成员</span>
          <strong>{{ ownMember?.name || "未登录" }}</strong>
        </div>
        <div>
          <span>私钥状态</span>
          <strong>{{ ownKeyStatus }}</strong>
        </div>
        <div>
          <span>公钥编号</span>
          <strong>{{ ownMember?.key_id || "无" }}</strong>
        </div>
      </div>

      <p class="key-note">
        公钥保存在项目成员信息中，用来验签；私钥只保存在本机或私钥文件中，用来给修改包签名。私钥文件可以代表你签名修改包，请不要交给其他人。
      </p>

      <div class="key-actions">
        <button
          class="primary-button"
          type="button"
          :disabled="isWorking || !ownMember || !canUsePrimaryKeyAction"
          @click="handlePrimaryKeyAction"
        >
          {{ primaryKeyButtonText }}
        </button>

        <button
          v-if="ownPrivateLoaded"
          class="secondary-button"
          type="button"
          :disabled="isWorking || !canExportPrivate"
          @click="handleExportPrivateKey"
        >
          导出私钥文件
        </button>

        <button
          v-if="ownPrivateLoaded"
          class="secondary-button"
          type="button"
          :disabled="isWorking || !canExportPrivate || !projectId"
          @click="handleExportPublicKey"
        >
          导出公钥登记文件
        </button>

        <label
          class="file-button"
          :class="{ disabled: isWorking || !canImportPrivate || !ownMember }"
        >
          <span>导入私钥文件</span>
          <input
            type="file"
            accept=".json,application/json"
            :disabled="isWorking || !canImportPrivate || !ownMember"
            @change="handleImportKey"
          />
        </label>

        <button
          v-if="hasActiveOwnPublicKey"
          class="danger-button"
          type="button"
          :disabled="isWorking || !canRevokeKeys"
          @click="handleRevokeOwnKey"
        >
          撤销当前公钥
        </button>
      </div>

      <section class="member-key-list">
        <div class="member-key-header">
          <div>
            <h3>成员公钥</h3>
            <p>公钥不保密，用于验证成员修改包签名；导入登记文件不会导入私钥。</p>
          </div>
          <label
            class="file-button"
            :class="{ disabled: isWorking || !canRegisterPublic || !projectId }"
          >
            <span>导入成员公钥</span>
            <input
              type="file"
              accept=".json,application/json"
              :disabled="isWorking || !canRegisterPublic || !projectId"
              @change="handleImportPublicKey"
            />
          </label>
        </div>
        <article v-for="member in members" :key="member.id" class="member-key-row">
          <div>
            <strong>{{ member.name }}</strong>
            <span>公钥状态：{{ describeMemberPublicKeyStatus(member) }}</span>
            <span>公钥编号</span>
            <code>{{ member.key_id || "无公钥" }}</code>
            <small v-if="keyDate(member)">{{ keyDate(member) }}</small>
          </div>
          <button
            v-if="member.key_id && !member.key_revoked_at"
            class="secondary-button"
            type="button"
            :disabled="isWorking || !canRevokeKeys"
            @click="handleRevokeMemberKey(member)"
          >
            撤销公钥
          </button>
        </article>
      </section>
    </template>
  </section>
</template>

<style scoped>
.key-panel {
  display: grid;
  gap: 16px;
}

.own-key-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.own-key-summary > div,
.member-key-row {
  padding: 12px;
  border: 1px solid #e3e8ef;
  border-radius: 8px;
  background: #f8fafb;
}

.own-key-summary span,
.member-key-row span,
.member-key-row small,
.notice-text {
  color: #5b6472;
  font-size: 13px;
}

.own-key-summary strong,
.member-key-row strong {
  display: block;
  margin-top: 4px;
  color: #111827;
  overflow-wrap: anywhere;
}

.key-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}

.key-note {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #d7e9e6;
  border-radius: 6px;
  background: #f5fbfa;
  color: #376164;
  font-size: 13px;
  line-height: 1.6;
}

.primary-button,
.secondary-button,
.danger-button,
.file-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 14px;
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

.member-key-list {
  display: grid;
  gap: 10px;
}

.member-key-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

h3 {
  margin: 0;
  color: #111827;
  font-size: 15px;
}

.member-key-header p {
  margin: 4px 0 0;
  color: #5b6472;
  font-size: 13px;
  line-height: 1.6;
}

.member-key-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.member-key-row div {
  display: grid;
  gap: 5px;
  min-width: 0;
}

code {
  color: #174346;
  overflow-wrap: anywhere;
}

.error-text,
.success-text,
.notice-text {
  margin: 0;
  line-height: 1.6;
}

.error-text {
  color: #b42318;
}

.success-text {
  color: #166534;
}

@media (max-width: 760px) {
  .own-key-summary {
    grid-template-columns: 1fr;
  }

  .member-key-row {
    align-items: stretch;
    flex-direction: column;
  }

  .member-key-header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
