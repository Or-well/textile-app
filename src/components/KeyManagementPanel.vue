<script setup lang="ts">
import { computed, ref } from "vue";
import type { Member, ProjectConfig } from "../model/types";
import {
  exportChangePackage,
  getChangePackageSuggestedFileName,
  type ExportChangePackageOptions,
} from "../services/changes";
import {
  activatePreparedOwnSigningKey,
  commitPreparedOwnSigningKeyGeneration,
  commitPreparedOwnSigningKeyRotation,
  exportOwnOwnerTransferKeyProof,
  exportOwnPublicKeyRegistrationFile,
  exportOwnKeyFile,
  exportPreparedPublicKeyRegistrationFile,
  hasLoadedPrivateKey,
  importMemberPublicKeyRegistrationFile,
  importOwnKeyFile,
  memberKeyFileToBlob,
  prepareMemberPublicKeyRegistration,
  prepareOwnSigningKeyGeneration,
  prepareOwnSigningKeyRevocation,
  prepareOwnSigningKeyRotation,
  previewMemberPublicKeyRegistrationFile,
  revokeMemberPublicKey,
  revokeOwnSigningKey,
  unloadOwnSigningPrivateKey,
} from "../services/keyManager";
import {
  canExportPrivateKey,
  canExportProjectUpdatePackage,
  canGenerateKey,
  canImportPrivateKey,
  canRegisterPublicKey,
  canRevokeKey,
  canRevokeOwnKey,
  canRotateKey,
  canViewKey,
  isOwnerMember,
} from "../services/permissions";
import type { ProjectDirectoryHandle } from "../services/projectFs";
import {
  commitOfflineTrustRebuild,
  commitSignedTrustTransition,
  getOtherTrustedProjectUpdatePublishers,
  loadLatestTrustTransitionArchive,
  prepareOfflineTrustRebuild,
} from "../services/signingTrustTransition";
import {
  exportProjectPackage,
  getProjectPackageSuggestedFileName,
} from "../services/projectPackage";
import {
  saveGeneratedFile,
  saveGeneratedFileFromFactory,
  saveGeneratedFilesFromFactories,
} from "../utils/saveBlob";
import { formatDateTime, nowIso } from "../utils/time";

const props = defineProps<{
  members: Member[];
  currentUser?: Member | null;
  projectRoot?: ProjectDirectoryHandle;
  projectId?: string;
  project?: ProjectConfig | null;
}>();

const emit = defineEmits<{
  membersUpdated: [members: Member[]];
  projectUpdated: [project: ProjectConfig];
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
const canRevokeOwnKeys = computed(() => canRevokeOwnKey(props.currentUser));
const canPublishProjectUpdates = computed(() =>
  canExportProjectUpdatePackage(props.currentUser),
);
const ownPrivateLoaded = computed(() => hasLoadedPrivateKey(ownMember.value));
const hasOwnPublicKey = computed(() =>
  Boolean(ownMember.value?.public_key && ownMember.value.key_id),
);
const hasActiveOwnPublicKey = computed(
  () => hasOwnPublicKey.value && !ownMember.value?.key_revoked_at,
);
const otherTrustedPublishers = computed(() =>
  props.project && props.currentUser
    ? getOtherTrustedProjectUpdatePublishers(
        props.members,
        props.currentUser,
        props.project,
      )
    : [],
);
const canRebuildTrust = computed(
  () =>
    Boolean(
      props.project &&
        props.currentUser &&
        isOwnerMember(props.currentUser) &&
        hasActiveOwnPublicKey.value &&
        canPublishProjectUpdates.value &&
        !ownPrivateLoaded.value &&
        otherTrustedPublishers.value.length === 0,
    ),
);
const ownKeyStatus = computed(() => describeKeyStatus(ownMember.value));
const primaryKeyButtonText = computed(() =>
  hasOwnPublicKey.value ? "生成新的签名密钥" : "生成签名密钥",
);
const canUsePrimaryKeyAction = computed(() =>
  hasOwnPublicKey.value
    ? canRotateKeys.value &&
      (!canPublishProjectUpdates.value || ownPrivateLoaded.value)
    : canGenerateKeys.value,
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

function canRevokeMemberKey(member: Member): boolean {
  return member.id === props.currentUser?.id
    ? canRevokeOwnKeys.value
    : canRevokeKeys.value;
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
    const root = getRoot();
    const generation = await prepareOwnSigningKeyGeneration(
      props.members,
      props.currentUser,
    );
    const keyFile = memberKeyFileToBlob(generation.keyFile);
    const saved = await saveGeneratedFile(keyFile.blob, keyFile.fileName);

    if (!saved.saved) {
      return `${saved.reason} 项目中没有登记这把公钥。`;
    }

    const result = await commitPreparedOwnSigningKeyGeneration(
      root,
      generation,
      props.currentUser,
    );

    emit("membersUpdated", result.members);
    return `签名密钥已生成，私钥文件已保存为 ${saved.fileName}。公钥已写入项目。`;
  });
}

async function handleGenerateNewKey() {
  if (canPublishProjectUpdates.value && hasActiveOwnPublicKey.value) {
    await handleRotateProjectUpdateSigningKey();
    return;
  }

  if (
    !window.confirm(
      "生成新的签名密钥后，项目会登记新公钥，新的修改包会使用新私钥签名。继续？",
    )
  ) {
    return;
  }

  await runAction(async () => {
    const root = getRoot();
    const rotation = await prepareOwnSigningKeyRotation(
      props.members,
      props.currentUser,
    );
    const keyFile = memberKeyFileToBlob(rotation.keyFile);
    const saved = await saveGeneratedFile(keyFile.blob, keyFile.fileName);

    if (!saved.saved) {
      return `${saved.reason} 当前身份密钥没有变化。`;
    }

    const result = await commitPreparedOwnSigningKeyRotation(
      root,
      rotation,
      props.currentUser,
    );

    emit("membersUpdated", result.members);
    return `新的签名密钥已生成，私钥文件已保存为 ${saved.fileName}。`;
  });
}

async function handleRotateProjectUpdateSigningKey() {
  if (!ownPrivateLoaded.value) {
    errorMessage.value =
      "负责人轮换身份密钥前，需要先导入当前旧私钥，用旧密钥签发包含新公钥的项目更新包。";
    message.value = "";
    return;
  }

  if (
    !window.confirm(
      [
        "负责人身份密钥会影响成员接收项目更新包。",
        "",
        "Textile 将先生成一份由当前旧密钥签名、内容包含新公钥的项目更新包。成员接收该过渡包后，才能验证之后由新密钥签名的项目更新包。",
        "",
        "请确认过渡包已保存并分发后再继续。是否生成新的负责人身份密钥并导出过渡更新包？",
      ].join("\n"),
    )
  ) {
    return;
  }

  await runAction(async () => {
    const root = getRoot();
    const rotation = await prepareOwnSigningKeyRotation(
      props.members,
      props.currentUser,
    );
    const keyFile = memberKeyFileToBlob(rotation.keyFile);
    const createdAt = nowIso();
    const exportOptions: ExportChangePackageOptions = {
      mode: "project_update",
      sign: true,
      actor: rotation.previousMember,
      projectUpdateMembers: rotation.members,
      signatureMember: rotation.previousMember,
      createdAt,
    };
    let exported: Awaited<ReturnType<typeof exportChangePackage>> | undefined;
    const saved = await saveGeneratedFilesFromFactories([
      {
        fileName: keyFile.fileName,
        createBlob: () => keyFile.blob,
      },
      {
        fileName: getChangePackageSuggestedFileName(
          rotation.previousMember.id,
          exportOptions,
          createdAt,
        ),
        createBlob: async () => {
          exported = await exportChangePackage(
            rotation.previousMember.id,
            exportOptions,
          );

          return exported.blob;
        },
      },
    ]);

    if (!saved.saved) {
      return `${saved.reason} 当前身份密钥没有变化。`;
    }

    if (!exported) {
      throw new Error("过渡更新包没有生成。");
    }

    const transition = await commitSignedTrustTransition(
      root,
      exported,
      rotation.members,
      rotation.previousMember,
      "member.key_rotated",
      {
        member_id: rotation.member.id,
        previous_key_id: rotation.previousMember.key_id ?? "",
        key_id: rotation.member.key_id ?? "",
      },
    );
    activatePreparedOwnSigningKey(rotation, props.currentUser);

    emit("projectUpdated", transition.project);
    emit("membersUpdated", transition.members);
    return `新的负责人身份密钥已启用，私钥文件已保存为 ${saved.files[0]?.fileName ?? keyFile.fileName}。过渡包已归档到 ${transition.archivePath}，请分发给成员。`;
  });
}

async function handleRebuildProjectTrust() {
  if (
    !window.confirm(
      [
        "当前旧私钥已经永久丢失，无法继续原有签名链。",
        "",
        "Textile 将生成新密钥和新的 .hproj 项目备份，并提升项目信任代次。所有成员都必须停止使用旧副本，改用这份新项目备份。",
        "",
        "这不是连续项目更新，不能通过普通项目更新包自动恢复。确认继续？",
      ].join("\n"),
    ) ||
    !window.confirm("再次确认：旧项目副本之后必须全部废弃。继续重建信任？")
  ) {
    return;
  }

  await runAction(async () => {
    const root = getRoot();
    const currentProject = getProject();
    const rotation = await prepareOwnSigningKeyRotation(
      props.members,
      props.currentUser,
    );
    const keyFile = memberKeyFileToBlob(rotation.keyFile);
    const nextProject = prepareOfflineTrustRebuild(
      currentProject,
      rotation.members,
      props.currentUser as Member,
    );
    let projectPackage: Awaited<ReturnType<typeof exportProjectPackage>> | undefined;
    const saved = await saveGeneratedFilesFromFactories([
      {
        fileName: keyFile.fileName,
        createBlob: () => keyFile.blob,
      },
      {
        fileName: getProjectPackageSuggestedFileName(nextProject),
        createBlob: async () => {
          projectPackage = await exportProjectPackage(root, props.currentUser, {
            project: nextProject,
            members: rotation.members,
          });

          return projectPackage.blob;
        },
      },
    ]);

    if (!saved.saved) {
      return `${saved.reason} 项目信任没有变化。`;
    }

    if (!projectPackage) {
      throw new Error("新项目备份没有生成。");
    }

    const committedProject = await commitOfflineTrustRebuild(
      root,
      currentProject,
      nextProject,
      rotation.members,
      props.currentUser as Member,
    );
    activatePreparedOwnSigningKey(rotation, props.currentUser);
    emit("projectUpdated", committedProject);
    emit("membersUpdated", rotation.members);

    return `项目信任已重建为第 ${committedProject.trust_epoch} 代。新私钥保存为 ${saved.files[0]?.fileName ?? keyFile.fileName}，新项目备份保存为 ${saved.files[1]?.fileName ?? projectPackage.fileName}。请废弃并替换所有旧副本。`;
  });
}

async function handlePrepareTrustedPublisherRecovery() {
  await runAction(async () => {
    const rotation = await prepareOwnSigningKeyRotation(
      props.members,
      props.currentUser,
    );
    const keyFile = memberKeyFileToBlob(rotation.keyFile);
    const registration = await exportPreparedPublicKeyRegistrationFile(
      rotation,
      getProjectId(),
    );
    const saved = await saveGeneratedFilesFromFactories([
      {
        fileName: keyFile.fileName,
        createBlob: () => keyFile.blob,
      },
      {
        fileName: registration.fileName,
        createBlob: () => registration.blob,
      },
    ]);

    if (!saved.saved) {
      return `${saved.reason} 没有生成完整恢复申请。`;
    }

    return `恢复私钥已保存为 ${saved.files[0]?.fileName ?? keyFile.fileName}，公钥恢复申请已保存为 ${saved.files[1]?.fileName ?? registration.fileName}。当前项目公钥没有变化；请交给另一名可信发布者签发恢复项目更新包。`;
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
  if (canPublishProjectUpdates.value && hasActiveOwnPublicKey.value) {
    await handleRevokeProjectUpdateSigningKey();
    return;
  }

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

async function handleRevokeProjectUpdateSigningKey() {
  if (!ownPrivateLoaded.value) {
    errorMessage.value =
      "负责人撤销身份密钥前，需要先导入当前私钥，用旧密钥签发包含撤销状态的项目更新包。";
    message.value = "";
    return;
  }

  if (
    props.project &&
    props.currentUser &&
    getOtherTrustedProjectUpdatePublishers(
      props.members,
      props.currentUser,
      props.project,
    ).length === 0
  ) {
    errorMessage.value =
      "不能撤销项目中最后一把可信发布密钥。请改用密钥轮换；旧私钥已经丢失时，请执行“私钥丢失，重建信任”。";
    message.value = "";
    return;
  }

  if (
    !window.confirm(
      [
        "负责人身份密钥会影响成员接收项目更新包。",
        "",
        "Textile 将先导出一份由当前私钥签名、内容标记当前公钥已撤销的项目更新包。成员接收该过渡包后，将不再信任这把公钥签出的新项目更新包。",
        "",
        "撤销后，此项目副本不能继续发布可验证的项目更新，除非重新建立可信密钥。是否导出撤销过渡包并继续？",
      ].join("\n"),
    )
  ) {
    return;
  }

  await runAction(async () => {
    const root = getRoot();
    const revocation = await prepareOwnSigningKeyRevocation(
      props.members,
      props.currentUser,
      props.project ?? undefined,
    );
    const createdAt = nowIso();
    const exportOptions: ExportChangePackageOptions = {
      mode: "project_update",
      sign: true,
      actor: revocation.previousMember,
      projectUpdateMembers: revocation.members,
      signatureMember: revocation.previousMember,
      createdAt,
    };
    let exported: Awaited<ReturnType<typeof exportChangePackage>> | undefined;
    const saved = await saveGeneratedFileFromFactory(
      getChangePackageSuggestedFileName(
        revocation.previousMember.id,
        exportOptions,
        createdAt,
      ),
      async () => {
        exported = await exportChangePackage(
          revocation.previousMember.id,
          exportOptions,
        );

        return exported.blob;
      },
    );

    if (!saved.saved) {
      return `${saved.reason} 当前身份密钥没有变化。`;
    }

    if (!exported) {
      throw new Error("撤销过渡包没有生成。");
    }

    const transition = await commitSignedTrustTransition(
      root,
      exported,
      revocation.members,
      revocation.previousMember,
      "member.key_revoked",
      {
        member_id: revocation.member.id,
        key_id: revocation.member.key_id ?? "",
      },
    );

    emit("projectUpdated", transition.project);
    emit("membersUpdated", transition.members);
    return `当前负责人公钥已撤销。过渡包已归档到 ${transition.archivePath}，请分发给成员。`;
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
      props.project ?? undefined,
    );

    emit("membersUpdated", result.members);
    return "成员公钥已撤销。";
  });
}

async function saveKeyBlob(blob: Blob, fileName: string, label: string): Promise<string> {
  const result = await saveGeneratedFile(blob, fileName);

  if (!result.saved) {
    return `${label}保存失败：${result.reason}`;
  }

  return `${label}已保存为 ${result.fileName}。`;
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
      {
        requireExistingPublicKeyMatch: hasActiveOwnPublicKey.value,
      },
    );

    emit("membersUpdated", result.members);
    return "私钥文件已导入，本机可用于导出签名修改包。";
  });

  input.value = "";
}

function handleUnloadPrivateKey() {
  if (!props.currentUser) {
    return;
  }

  unloadOwnSigningPrivateKey(props.currentUser);
  message.value = "本机内存中的私钥已卸载。再次签名时需要重新导入私钥文件。";
  errorMessage.value = "";
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

    const prepared = await prepareMemberPublicKeyRegistration(
      props.members,
      props.currentUser,
      getProjectId(),
      text,
      { allowReplace: hasDifferentPublicKey },
    );

    if (hasDifferentPublicKey) {
      const actor = ownMember.value;

      if (
        !actor ||
        !canPublishProjectUpdates.value ||
        !hasLoadedPrivateKey(actor)
      ) {
        throw new Error(
          "替换已有公钥必须由已加载可信私钥的项目更新发布者签发恢复项目更新包。",
        );
      }

      const createdAt = nowIso();
      const exportOptions: ExportChangePackageOptions = {
        mode: "project_update",
        sign: true,
        actor,
        projectUpdateMembers: prepared.members,
        signatureMember: actor,
        createdAt,
      };
      let exported: Awaited<ReturnType<typeof exportChangePackage>> | undefined;
      const saved = await saveGeneratedFileFromFactory(
        getChangePackageSuggestedFileName(actor.id, exportOptions, createdAt),
        async () => {
          exported = await exportChangePackage(actor.id, exportOptions);

          return exported.blob;
        },
      );

      if (!saved.saved) {
        return `${saved.reason} 公钥没有变化。`;
      }

      if (!exported) {
        throw new Error("恢复项目更新包没有生成。");
      }

      const transition = await commitSignedTrustTransition(
        getRoot(),
        exported,
        prepared.members,
        actor,
        "member.public_key_recovered",
        {
          member_id: prepared.member.id,
          previous_key_id: prepared.previousMember.key_id ?? "",
          key_id: prepared.member.key_id ?? "",
        },
      );

      emit("projectUpdated", transition.project);
      emit("membersUpdated", transition.members);
      return `已为 ${prepared.member.name} 恢复公钥。恢复包已归档到 ${transition.archivePath}，请分发给成员。`;
    }

    const result = await importMemberPublicKeyRegistrationFile(
      getRoot(),
      props.members,
      props.currentUser,
      getProjectId(),
      text,
    );
    emit("membersUpdated", result.members);
    return hasDifferentPublicKey
      ? `已为 ${result.member.name} 轮换公钥。`
      : `已为 ${result.member.name} 登记公钥。`;
  });

  input.value = "";
}

async function handleExportOwnerTransferProof() {
  await runAction(async () => {
    const result = await exportOwnOwnerTransferKeyProof(
      props.members,
      props.currentUser,
      getProjectId(),
      getProjectRevision(),
    );

    return saveKeyBlob(result.blob, result.fileName, "负责人交接证明");
  });
}

async function handleResaveLatestTransition() {
  await runAction(async () => {
    const archive = await loadLatestTrustTransitionArchive(getRoot());

    return saveKeyBlob(archive.blob, archive.fileName, "可信过渡包");
  });
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
      <p
        v-if="
          canPublishProjectUpdates &&
          hasActiveOwnPublicKey &&
          !ownPrivateLoaded &&
          otherTrustedPublishers.length > 0
        "
        class="key-note"
      >
        当前旧私钥丢失时，可先生成新密钥和公钥登记文件，再由可信发布者
        {{ otherTrustedPublishers.map((member) => member.name).join("、") }}
        导入登记文件并签发公钥恢复项目更新包，无需重建整个项目信任。
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

        <button
          v-if="ownPrivateLoaded && projectId && project"
          class="secondary-button"
          type="button"
          :disabled="isWorking || !canExportPrivate"
          @click="handleExportOwnerTransferProof"
        >
          导出负责人交接证明
        </button>

        <button
          v-if="ownPrivateLoaded"
          class="secondary-button"
          type="button"
          :disabled="isWorking"
          @click="handleUnloadPrivateKey"
        >
          卸载本机私钥
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
          :disabled="isWorking || !canRevokeOwnKeys"
          @click="handleRevokeOwnKey"
        >
          撤销当前公钥
        </button>

        <button
          v-if="canRebuildTrust"
          class="danger-button"
          type="button"
          :disabled="isWorking"
          @click="handleRebuildProjectTrust"
        >
          私钥丢失，重建信任
        </button>

        <button
          v-if="
            canPublishProjectUpdates &&
            hasActiveOwnPublicKey &&
            !ownPrivateLoaded &&
            otherTrustedPublishers.length > 0
          "
          class="secondary-button"
          type="button"
          :disabled="isWorking || !canRotateKeys"
          @click="handlePrepareTrustedPublisherRecovery"
        >
          生成发布者恢复申请
        </button>

        <button
          class="secondary-button"
          type="button"
          :disabled="isWorking || !projectRoot"
          @click="handleResaveLatestTransition"
        >
          重新保存最近过渡包
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
            :disabled="isWorking || !canRevokeMemberKey(member)"
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
