<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import PermissionGroup from "./PermissionGroup.vue";
import {
  OWNER_LOCKED_PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_LABELS,
  ROLE_ORDER,
} from "../../model/permissions";
import type { Member, ProjectConfig, Role, RolePermissions } from "../../model/types";
import {
  canManageRolePermissions,
  getRolePermissions,
  resetRolePermissionsToDefault,
} from "../../services/permissions";
import { saveRolePermissions } from "../../services/project";
import type { ProjectDirectoryHandle } from "../../services/projectFs";

const props = defineProps<{
  project: ProjectConfig;
  members: Member[];
  currentUser: Member | null;
  projectRoot?: ProjectDirectoryHandle;
}>();

const emit = defineEmits<{
  projectUpdated: [project: ProjectConfig];
}>();

const selectedRole = ref<Role>("owner");
const roleDraft = reactive<Record<Role, string[]>>({} as Record<Role, string[]>);
const isSaving = ref(false);
const message = ref("");
const errorMessage = ref("");

const canEdit = computed(() =>
  canManageRolePermissions(props.currentUser, props.project),
);
const selectedPermissions = computed(() => roleDraft[selectedRole.value] ?? []);
const selectedLockedPermissions = computed(() =>
  selectedRole.value === "owner" ? [...OWNER_LOCKED_PERMISSIONS] : [],
);

function getRoot(): ProjectDirectoryHandle {
  if (!props.projectRoot) {
    throw new Error("请先打开项目。");
  }

  return props.projectRoot;
}

function copyRolePermissions(source: RolePermissions): Record<Role, string[]> {
  return Object.fromEntries(
    ROLE_ORDER.map((role) => [role, [...(source[role] ?? [])]]),
  ) as Record<Role, string[]>;
}

function syncDraft(): void {
  const nextDraft = copyRolePermissions(getRolePermissions(props.project));

  for (const role of ROLE_ORDER) {
    roleDraft[role] = nextDraft[role];
  }
}

function togglePermission(permission: string): void {
  if (!canEdit.value) {
    return;
  }

  if (
    selectedRole.value === "owner" &&
    OWNER_LOCKED_PERMISSIONS.includes(permission as (typeof OWNER_LOCKED_PERMISSIONS)[number])
  ) {
    return;
  }

  const permissions = new Set(roleDraft[selectedRole.value] ?? []);

  if (permissions.has(permission)) {
    permissions.delete(permission);
  } else {
    permissions.add(permission);
  }

  roleDraft[selectedRole.value] = Array.from(permissions).sort((left, right) =>
    left.localeCompare(right),
  );
}

function isGroupDefaultOpen(groupId: string): boolean {
  if (selectedRole.value === "owner") {
    return groupId === "project" || groupId === "member-role";
  }

  return groupId === "project";
}

async function persistRolePermissions(resetToDefault = false): Promise<void> {
  isSaving.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const result = await saveRolePermissions(
      getRoot(),
      props.project,
      props.members,
      props.currentUser as Member,
      copyRolePermissions(roleDraft),
      { resetToDefault },
    );

    emit("projectUpdated", result);
    message.value = resetToDefault ? "已恢复默认权限。" : "角色权限已保存。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "角色权限保存失败。";
  } finally {
    isSaving.value = false;
  }
}

async function handleSave(): Promise<void> {
  await persistRolePermissions(false);
}

async function handleReset(): Promise<void> {
  if (!window.confirm("恢复默认权限会覆盖当前角色权限配置。继续？")) {
    return;
  }

  const defaults = copyRolePermissions(resetRolePermissionsToDefault());

  for (const role of ROLE_ORDER) {
    roleDraft[role] = defaults[role];
  }

  await persistRolePermissions(true);
}

watch(
  () => props.project.settings.role_permissions,
  () => syncDraft(),
  { immediate: true, deep: true },
);
</script>

<template>
  <section class="role-permission-editor">
    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="message" class="message">{{ message }}</p>
    <p v-if="!canEdit" class="notice-text">当前用户只能查看角色权限，不能编辑。</p>

    <div class="role-editor-layout">
      <nav class="role-list" aria-label="角色列表">
        <button
          v-for="role in ROLE_ORDER"
          :key="role"
          class="role-button"
          :class="{ active: selectedRole === role }"
          type="button"
          @click="selectedRole = role"
        >
          <strong>{{ ROLE_LABELS[role] }}</strong>
          <span>{{ role }}</span>
        </button>
      </nav>

      <section class="permission-panel">
        <header class="permission-header">
          <div>
            <h3>{{ ROLE_LABELS[selectedRole] }}</h3>
            <p>
              {{
                selectedRole === "owner"
                  ? "项目负责人关键权限已锁定，不能取消。"
                  : "角色权限是该角色成员的默认权限；成员个人权限可额外允许或禁止。"
              }}
            </p>
          </div>
          <span class="permission-count">{{ selectedPermissions.length }} 项</span>
        </header>
        <p class="notice-text">
          成员个人禁止权限优先于角色默认权限和额外允许权限；维护、危险导入、成员和密钥权限应只给可信成员。
        </p>

        <div class="permission-groups">
          <PermissionGroup
            v-for="group in PERMISSION_GROUPS"
            :key="group.id"
            :group="group"
            :selected-permissions="selectedPermissions"
            :locked-permissions="selectedLockedPermissions"
            :disabled="isSaving || !canEdit"
            :default-open="isGroupDefaultOpen(group.id)"
            :collapse-key="selectedRole"
            @toggle="togglePermission"
          />
        </div>
      </section>
    </div>

    <footer class="editor-actions">
      <button
        class="primary-button"
        type="button"
        :disabled="isSaving || !canEdit"
        @click="handleSave"
      >
        {{ isSaving ? "正在保存..." : "保存权限" }}
      </button>
      <button
        class="secondary-button"
        type="button"
        :disabled="isSaving || !canEdit"
        @click="handleReset"
      >
        恢复默认权限
      </button>
    </footer>
  </section>
</template>

<style scoped>
.role-permission-editor {
  display: grid;
  gap: 14px;
}

.role-editor-layout {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.role-list {
  display: grid;
  gap: 6px;
}

.role-button {
  display: grid;
  gap: 3px;
  width: 100%;
  min-height: 52px;
  padding: 9px 11px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
}

.role-button.active {
  border-color: #2f6f73;
  background: #e8f3f1;
}

.role-button strong {
  font-size: 14px;
}

.role-button span {
  color: #5b6472;
  font-size: 12px;
}

.permission-panel {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.permission-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h3,
p {
  margin: 0;
}

h3 {
  color: #111827;
  font-size: 18px;
}

.permission-header p,
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
}

.permission-groups {
  display: grid;
  gap: 16px;
}

.editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}

.primary-button,
.secondary-button {
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

.secondary-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
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

@media (max-width: 840px) {
  .role-editor-layout {
    grid-template-columns: 1fr;
  }

  .role-list {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }
}
</style>
