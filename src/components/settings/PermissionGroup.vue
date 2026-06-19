<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PermissionGroupDefinition } from "../../model/permissions";

const props = withDefaults(
  defineProps<{
    group: PermissionGroupDefinition;
    selectedPermissions: string[];
    lockedPermissions?: string[];
    disabled?: boolean;
    defaultOpen?: boolean;
    collapseKey?: string;
  }>(),
  {
    lockedPermissions: () => [],
    disabled: false,
    defaultOpen: false,
    collapseKey: "",
  },
);

const emit = defineEmits<{
  toggle: [permission: string];
}>();

const isOpen = ref(props.defaultOpen);
const totalCount = computed(() => props.group.permissions.length);
const selectedCount = computed(
  () =>
    props.group.permissions.filter(
      (permission) => isSelected(permission.action) || isLocked(permission.action),
    ).length,
);
const lockedCount = computed(
  () => props.group.permissions.filter((permission) => isLocked(permission.action)).length,
);

function isSelected(permission: string): boolean {
  return props.selectedPermissions.includes(permission);
}

function isLocked(permission: string): boolean {
  return props.lockedPermissions.includes(permission);
}

watch(
  () => [props.group.id, props.collapseKey, props.defaultOpen] as const,
  () => {
    isOpen.value = props.defaultOpen;
  },
);
</script>

<template>
  <section class="permission-group">
    <button
      class="group-toggle"
      type="button"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <span class="group-title">{{ group.label }}</span>
      <span class="group-summary">
        {{ selectedCount }} / {{ totalCount }} 已启用
        <small v-if="lockedCount">含 {{ lockedCount }} 项锁定</small>
      </span>
      <span class="collapse-icon" aria-hidden="true">{{ isOpen ? "-" : "+" }}</span>
    </button>

    <div v-show="isOpen" class="permission-grid">
      <label
        v-for="permission in group.permissions"
        :key="permission.action"
        class="permission-option"
        :class="{ locked: isLocked(permission.action) }"
      >
        <input
          type="checkbox"
          :checked="isSelected(permission.action) || isLocked(permission.action)"
          :disabled="disabled || isLocked(permission.action)"
          @change="emit('toggle', permission.action)"
        />
        <span>
          <strong>{{ permission.label }}</strong>
          <small>{{ permission.action }}</small>
        </span>
      </label>
    </div>
  </section>
</template>

<style scoped>
.permission-group {
  display: grid;
  gap: 8px;
  border: 1px solid #e3e8ef;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
}

.group-toggle {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  width: 100%;
  min-height: 46px;
  padding: 10px 12px;
  border: 0;
  background: #f8fafc;
  color: #111827;
  text-align: left;
  cursor: pointer;
}

.group-toggle:hover {
  background: #f1f6f5;
}

.group-title {
  color: #111827;
  font-size: 15px;
  font-weight: 700;
}

.group-summary {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  color: #5b6472;
  font-size: 12px;
  white-space: nowrap;
}

.group-summary small {
  color: #2f6f73;
  font-size: 12px;
}

.collapse-icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid #cfd8e3;
  border-radius: 999px;
  background: #ffffff;
  color: #174346;
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
}

.permission-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 8px;
  padding: 10px;
  border-top: 1px solid #e3e8ef;
  background: #ffffff;
}

.permission-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 9px;
  align-items: start;
  min-height: 58px;
  padding: 10px;
  border: 1px solid #e3e8ef;
  border-radius: 8px;
  background: #fbfcfe;
}

.permission-option.locked {
  background: #f5fbfa;
}

input {
  width: 16px;
  height: 16px;
  margin-top: 2px;
}

span {
  display: grid;
  gap: 3px;
  min-width: 0;
}

strong {
  color: #1f2937;
  font-size: 14px;
}

small {
  color: #6b7280;
  font-size: 12px;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .group-toggle {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .group-summary {
    grid-column: 1 / -1;
    justify-content: flex-start;
    white-space: normal;
  }
}
</style>
