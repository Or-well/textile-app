<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import PermissionGroup from "./PermissionGroup.vue";
import {
  PERMISSION_GROUPS,
  ROLE_LABELS,
} from "../../model/permissions";
import type { Member, ProjectConfig } from "../../model/types";
import {
  canManageMemberPermissionOverrides,
  getEffectivePermissions,
} from "../../services/permissions";
import { saveMemberPermissionOverrides } from "../../services/project";
import type { ProjectDirectoryHandle } from "../../services/projectFs";

const props = defineProps<{
  project: ProjectConfig;
  members: Member[];
  currentUser: Member | null;
  projectRoot?: ProjectDirectoryHandle;
}>();

const emit = defineEmits<{
  membersUpdated: [members: Member[]];
}>();

const selectedMemberId = ref("");
const allowDrafts = reactive<Record<string, string[]>>({});
const denyDrafts = reactive<Record<string, string[]>>({});
const isSaving = ref(false);
const message = ref("");
const errorMessage = ref("");

const selectedMember = computed(
  () => props.members.find((member) => member.id === selectedMemberId.value) ?? null,
);
const canEditSelectedMember = computed(() =>
  canManageMemberPermissionOverrides(
    props.currentUser,
    selectedMember.value,
    props.project,
  ),
);
const effectivePermissions = computed(() =>
  getEffectivePermissions(selectedMember.value, props.project),
);

function getRoot(): ProjectDirectoryHandle {
  if (!props.projectRoot) {
    throw new Error("请先打开项目。");
  }

  return props.projectRoot;
}

function roleText(member: Member): string {
  return member.roles.map((role) => ROLE_LABELS[role]).join(" / ");
}

function syncDrafts(): void {
  for (const member of props.members) {
    allowDrafts[member.id] = [...(member.allow_permissions ?? [])];
    denyDrafts[member.id] = [...(member.deny_permissions ?? [])];
  }

  selectedMemberId.value =
    props.members.find((member) => member.id === selectedMemberId.value)?.id ??
    props.members[0]?.id ??
    "";
}

function togglePermission(
  memberId: string,
  kind: "allow" | "deny",
  permission: string,
): void {
  if (!canEditSelectedMember.value) {
    return;
  }

  const targetDraft = kind === "allow" ? allowDrafts : denyDrafts;
  const otherDraft = kind === "allow" ? denyDrafts : allowDrafts;
  const values = new Set(targetDraft[memberId] ?? []);

  if (values.has(permission)) {
    values.delete(permission);
  } else {
    values.add(permission);
    otherDraft[memberId] = (otherDraft[memberId] ?? []).filter(
      (item) => item !== permission,
    );
  }

  targetDraft[memberId] = Array.from(values).sort((left, right) =>
    left.localeCompare(right),
  );
}

async function handleSave(): Promise<void> {
  if (!selectedMember.value || !props.currentUser) {
    return;
  }

  isSaving.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const members = await saveMemberPermissionOverrides(
      getRoot(),
      props.project,
      props.members,
      props.currentUser,
      selectedMember.value.id,
      allowDrafts[selectedMember.value.id] ?? [],
      denyDrafts[selectedMember.value.id] ?? [],
    );

    emit("membersUpdated", members);
    message.value = "成员个人权限已保存。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "成员个人权限保存失败。";
  } finally {
    isSaving.value = false;
  }
}

watch(
  () => props.members,
  () => syncDrafts(),
  { immediate: true, deep: true },
);
</script>

<template>
  <section class="member-permission-overrides">
    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="message" class="message">{{ message }}</p>

    <div class="override-layout">
      <nav class="member-list" aria-label="成员列表">
        <button
          v-for="member in members"
          :key="member.id"
          class="member-button"
          :class="{ active: selectedMemberId === member.id, disabled: !member.active }"
          type="button"
          @click="selectedMemberId = member.id"
        >
          <strong>{{ member.name }}</strong>
          <span>{{ roleText(member) }}</span>
        </button>
      </nav>

      <section v-if="selectedMember" class="override-panel">
        <header class="override-header">
          <div>
            <h3>{{ selectedMember.name }}</h3>
            <p>
              deny 权限优先级最高，会覆盖角色权限和额外允许权限。
            </p>
          </div>
          <span class="permission-count">{{ effectivePermissions.length }} 项有效权限</span>
        </header>

        <p v-if="!canEditSelectedMember" class="notice-text">
          当前用户不能修改该成员个人权限。
        </p>

        <div class="override-columns">
          <section class="override-column">
            <h4>额外允许权限</h4>
            <PermissionGroup
              v-for="group in PERMISSION_GROUPS"
              :key="`allow-${group.id}`"
              :group="group"
              :selected-permissions="allowDrafts[selectedMember.id] ?? []"
              :disabled="isSaving || !canEditSelectedMember"
              :default-open="false"
              :collapse-key="`${selectedMember.id}-allow`"
              @toggle="togglePermission(selectedMember.id, 'allow', $event)"
            />
          </section>

          <section class="override-column">
            <h4>额外禁止权限</h4>
            <PermissionGroup
              v-for="group in PERMISSION_GROUPS"
              :key="`deny-${group.id}`"
              :group="group"
              :selected-permissions="denyDrafts[selectedMember.id] ?? []"
              :disabled="isSaving || !canEditSelectedMember"
              :default-open="false"
              :collapse-key="`${selectedMember.id}-deny`"
              @toggle="togglePermission(selectedMember.id, 'deny', $event)"
            />
          </section>
        </div>

        <footer class="override-actions">
          <button
            class="primary-button"
            type="button"
            :disabled="isSaving || !canEditSelectedMember"
            @click="handleSave"
          >
            {{ isSaving ? "正在保存..." : "保存成员权限" }}
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.member-permission-overrides {
  display: grid;
  gap: 14px;
}

.override-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.member-list {
  display: grid;
  gap: 6px;
}

.member-button {
  display: grid;
  gap: 3px;
  min-height: 54px;
  padding: 9px 11px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
}

.member-button.active {
  border-color: #2f6f73;
  background: #e8f3f1;
}

.member-button.disabled {
  opacity: 0.62;
}

.member-button span {
  color: #5b6472;
  font-size: 12px;
}

.override-panel {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.override-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

h3,
h4,
p {
  margin: 0;
}

h3 {
  color: #111827;
  font-size: 18px;
}

h4 {
  color: #111827;
  font-size: 15px;
}

.override-header p,
.notice-text {
  color: #5b6472;
  line-height: 1.6;
}

.permission-count {
  padding: 4px 9px;
  border-radius: 999px;
  background: #e6f0ef;
  color: #174346;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.override-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.override-column {
  display: grid;
  align-content: start;
  gap: 14px;
  min-width: 0;
}

.override-actions {
  display: flex;
  gap: 9px;
}

.primary-button {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid #2f6f73;
  border-radius: 6px;
  background: #2f6f73;
  color: #ffffff;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.error-message,
.message {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  line-height: 1.6;
}

.error-message {
  border: 1px solid #f0b8aa;
  color: #b42318;
}

.message {
  border: 1px solid #b7dfc2;
  color: #166534;
}

@media (max-width: 960px) {
  .override-layout,
  .override-columns {
    grid-template-columns: 1fr;
  }
}
</style>
