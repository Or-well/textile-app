<script setup lang="ts">
import { computed, ref } from "vue";
import type { Member } from "../model/types";
import {
  exportOwnKeyFile,
  generateOwnSigningKey,
  hasLoadedPrivateKey,
  importOwnKeyFile,
  revokeMemberPublicKey,
  revokeOwnSigningKey,
  rotateOwnSigningKey,
} from "../services/keyManager";
import {
  canExportPrivateKey,
  canGenerateKey,
  canImportPrivateKey,
  canRevokeKey,
  canRotateKey,
  canViewKey,
} from "../services/permissions";
import type { ProjectDirectoryHandle } from "../services/projectFs";
import { formatDateTime } from "../utils/time";

const props = defineProps<{
  members: Member[];
  currentUser?: Member | null;
  projectRoot?: ProjectDirectoryHandle;
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
  hasOwnPublicKey.value ? "生成新密钥" : "生成密钥",
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

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function describeKeyStatus(member: Member | null | undefined): string {
  if (!member?.public_key || !member.key_id) {
    return "未生成";
  }

  if (member.key_revoked_at) {
    return "已撤销";
  }

  return hasLoadedPrivateKey(member) ? "可签名" : "需要导入身份密钥";
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
    return "身份密钥已生成。请立即导出身份密钥文件并妥善保存。";
  });
}

async function handleGenerateNewKey() {
  if (!window.confirm("生成新密钥后，新的修改包会使用新密钥签名。继续？")) {
    return;
  }

  await runAction(async () => {
    const result = await rotateOwnSigningKey(
      getRoot(),
      props.members,
      props.currentUser,
    );

    emit("membersUpdated", result.members);
    return "新身份密钥已生成。请导出新的身份密钥文件。";
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
  if (!window.confirm("撤销后当前身份密钥不能继续用于签名。继续？")) {
    return;
  }

  await runAction(async () => {
    const result = await revokeOwnSigningKey(
      getRoot(),
      props.members,
      props.currentUser,
    );

    emit("membersUpdated", result.members);
    return "身份密钥已撤销。";
  });
}

async function handleRevokeMemberKey(member: Member) {
  if (!window.confirm(`撤销 ${member.name} 的公钥？`)) {
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

function handleExportKey() {
  try {
    const result = exportOwnKeyFile(props.members, props.currentUser);

    downloadBlob(result.blob, result.fileName);
    message.value = "身份密钥文件已导出。";
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "身份密钥导出失败。";
    message.value = "";
  }
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
    return "身份密钥已导入，可用于导出签名修改包。";
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
          <span>密钥状态</span>
          <strong>{{ ownKeyStatus }}</strong>
        </div>
        <div>
          <span>密钥编号</span>
          <strong>{{ ownMember?.key_id || "无" }}</strong>
        </div>
      </div>

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
          @click="handleExportKey"
        >
          导出身份密钥
        </button>

        <label
          class="file-button"
          :class="{ disabled: isWorking || !canImportPrivate || !ownMember }"
        >
          <span>导入身份密钥</span>
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
          撤销密钥
        </button>
      </div>

      <section class="member-key-list">
        <h3>成员公钥</h3>
        <article v-for="member in members" :key="member.id" class="member-key-row">
          <div>
            <strong>{{ member.name }}</strong>
            <span>{{ describeKeyStatus(member) }}</span>
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

h3 {
  margin: 0;
  color: #111827;
  font-size: 15px;
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
}
</style>
