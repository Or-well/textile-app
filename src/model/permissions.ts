import permissionsConfig from "../config/permissions.json";
import type { Role } from "./types";

export const PERMISSION_ACTIONS = {
  APP_CACHE_CLEAR: "app.cache.clear",
  PROJECT_READ: "project.read",
  PROJECT_MANAGE: "project.manage",
  PROJECT_BACKUP: "project.backup",
  PROJECT_DELETE: "project.delete",
  PROJECT_MAINTENANCE: "project.maintenance",
  MEMBER_VIEW: "member.view",
  MEMBER_MANAGE: "member.manage",
  MEMBER_RESET_PASSWORD: "member.reset_password",
  ROLE_VIEW: "role.view",
  ROLE_MANAGE: "role.manage",
  FILE_VIEW: "file.view",
  FILE_CREATE: "file.create",
  FILE_UPDATE: "file.update",
  FILE_IMPORT_TRANSLATION: "file.import_translation",
  FILE_RENAME: "file.rename",
  FILE_LOCK: "file.lock",
  FILE_HIDE: "file.hide",
  FILE_DELETE: "file.delete",
  FILE_MANAGE_FOLDER: "file.manage_folder",
  ENTRY_READ: "entry.read",
  ENTRY_EDIT: "entry.edit",
  ENTRY_TRANSLATE: "entry.translate",
  ENTRY_PROOFREAD: "entry.proofread",
  ENTRY_REVIEW: "entry.review",
  ENTRY_ROLLBACK: "entry.rollback",
  ENTRY_UPDATE_STATUS: "entry.update_status",
  ENTRY_LOCK: "entry.lock",
  ENTRY_HIDE: "entry.hide",
  ENTRY_MARK_DISPUTED: "entry.mark_disputed",
  ENTRY_RESOLVE_DISPUTE: "entry.resolve_dispute",
  TERM_READ: "term.read",
  TERM_MANAGE: "term.manage",
  TERM_CREATE: "term.create",
  TERM_UPDATE: "term.update",
  TERM_DELETE: "term.delete",
  TERM_IMPORT: "term.import",
  TERM_EXPORT: "term.export",
  CONTEXT_VIEW: "context.view",
  CONTEXT_CREATE: "context.create",
  CONTEXT_UPDATE: "context.update",
  CONTEXT_DELETE: "context.delete",
  TASK_VIEW: "task.view",
  TASK_READ: "task.read",
  TASK_CREATE: "task.create",
  TASK_UPDATE: "task.update",
  TASK_ASSIGN: "task.assign",
  TASK_CLAIM: "task.claim",
  TASK_SUBMIT: "task.submit",
  TASK_COMPLETE: "task.complete",
  TASK_RECLAIM: "task.reclaim",
  TASK_DELETE: "task.delete",
  TASK_REOPEN: "task.reopen",
  TASK_MANAGE: "task.manage",
  COMMENT_VIEW: "comment.view",
  COMMENT_CREATE: "comment.create",
  COMMENT_REPLY: "comment.reply",
  COMMENT_RESOLVE: "comment.resolve",
  COMMENT_REOPEN: "comment.reopen",
  COMMENT_DELETE_OWN: "comment.delete_own",
  COMMENT_DELETE_ANY: "comment.delete_any",
  COMMENT_READ: "comment.read",
  COMMENT_WRITE: "comment.write",
  CHANGE_PACKAGE_EXPORT: "change_package.export",
  CHANGE_PACKAGE_IMPORT: "change_package.import",
  CHANGE_PACKAGE_EXPORT_MEMBER_CHANGES: "change_package.export_member_changes",
  CHANGE_PACKAGE_IMPORT_MEMBER_CHANGES: "change_package.import_member_changes",
  CHANGE_PACKAGE_EXPORT_PROJECT_UPDATE: "change_package.export_project_update",
  CHANGE_PACKAGE_IMPORT_PROJECT_UPDATE: "change_package.import_project_update",
  CHANGE_PACKAGE_REVIEW: "change_package.review",
  CHANGE_PACKAGE_SIGN: "change_package.sign",
  CHANGE_PACKAGE_VERIFY: "change_package.verify",
  CHANGE_PACKAGE_DANGEROUS_IMPORT: "change_package.dangerous_import",
  CHANGE_PACKAGE_EXPORT_MAINTENANCE: "change_package.export_maintenance",
  CHANGE_PACKAGE_IMPORT_MAINTENANCE: "change_package.import_maintenance",
  RELEASE_EXPORT: "release.export",
  KEY_VIEW: "key.view",
  KEY_GENERATE: "key.generate",
  KEY_IMPORT_PRIVATE: "key.import_private",
  KEY_EXPORT_PRIVATE: "key.export_private",
  KEY_REGISTER_PUBLIC: "key.register_public",
  KEY_ROTATE: "key.rotate",
  KEY_REVOKE: "key.revoke",
  STATS_READ: "stats.read",
  TECH_MAINTAIN: "tech.maintain",
} as const;

export type PermissionAction =
  (typeof PERMISSION_ACTIONS)[keyof typeof PERMISSION_ACTIONS];

export const OWNER_LOCKED_PERMISSIONS = [
  PERMISSION_ACTIONS.PROJECT_MANAGE,
  PERMISSION_ACTIONS.MEMBER_MANAGE,
  PERMISSION_ACTIONS.ROLE_MANAGE,
  PERMISSION_ACTIONS.PROJECT_BACKUP,
] as const satisfies readonly PermissionAction[];

export interface PermissionDefinition {
  action: PermissionAction;
  label: string;
}

export interface PermissionGroupDefinition {
  id: string;
  label: string;
  permissions: PermissionDefinition[];
}

interface PermissionConfigFile {
  schema_version: number;
  roles: {
    order: string[];
    labels: Record<string, string>;
  };
  groups: Array<{
    id: string;
    label: string;
    permissions: Array<{
      action: string;
      label: string;
    }>;
  }>;
  default_role_permissions: Record<string, string[]>;
}

interface ValidatedPermissionConfig {
  roleOrder: Role[];
  roleLabels: Record<Role, string>;
  permissionGroups: PermissionGroupDefinition[];
  allPermissionActions: PermissionAction[];
  roleDefaultPermissions: Record<Role, readonly PermissionAction[]>;
}

const CONFIG_SCHEMA_VERSION = 1;
const KNOWN_ROLES = [
  "owner",
  "admin",
  "tech_lead",
  "translator",
  "proofreader",
  "reviewer",
  "publisher",
  "term_manager",
  "readonly",
] as const satisfies readonly Role[];

const KNOWN_ROLE_SET = new Set<string>(KNOWN_ROLES);
const KNOWN_PERMISSION_ACTION_SET = new Set<string>(
  Object.values(PERMISSION_ACTIONS),
);

function configError(message: string): Error {
  return new Error(`权限配置错误：${message}`);
}

function assertNonEmptyString(value: unknown, context: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw configError(`${context} 必须是非空字符串。`);
  }
}

function assertKnownRole(value: string, context: string): asserts value is Role {
  if (!KNOWN_ROLE_SET.has(value)) {
    throw configError(`${context} 使用了未知角色：${value}`);
  }
}

function assertKnownPermissionAction(
  value: string,
  context: string,
): asserts value is PermissionAction {
  if (!KNOWN_PERMISSION_ACTION_SET.has(value)) {
    throw configError(`${context} 使用了未知权限：${value}`);
  }
}

function validateRoleOrder(order: readonly string[]): Role[] {
  if (!Array.isArray(order)) {
    throw configError("roles.order 必须是数组。");
  }

  const seen = new Set<string>();
  const roles = order.map((role, index) => {
    assertNonEmptyString(role, `roles.order[${index}]`);
    assertKnownRole(role, `roles.order[${index}]`);

    if (seen.has(role)) {
      throw configError(`roles.order 重复定义角色：${role}`);
    }

    seen.add(role);
    return role;
  });

  for (const role of KNOWN_ROLES) {
    if (!seen.has(role)) {
      throw configError(`roles.order 缺少角色：${role}`);
    }
  }

  return roles;
}

function validateRoleLabels(
  labels: Record<string, string>,
  roleOrder: readonly Role[],
): Record<Role, string> {
  if (!labels || typeof labels !== "object") {
    throw configError("roles.labels 必须是对象。");
  }

  for (const role of Object.keys(labels)) {
    assertKnownRole(role, "roles.labels");
  }

  return Object.fromEntries(
    roleOrder.map((role) => {
      assertNonEmptyString(labels[role], `roles.labels.${role}`);

      return [role, labels[role]];
    }),
  ) as Record<Role, string>;
}

function validatePermissionGroups(
  groups: PermissionConfigFile["groups"],
): {
  groups: PermissionGroupDefinition[];
  catalogActions: PermissionAction[];
} {
  if (!Array.isArray(groups)) {
    throw configError("groups 必须是数组。");
  }

  const groupIds = new Set<string>();
  const catalogActions: PermissionAction[] = [];
  const catalogActionSet = new Set<string>();
  const validatedGroups = groups.map((group, groupIndex) => {
    assertNonEmptyString(group.id, `groups[${groupIndex}].id`);
    assertNonEmptyString(group.label, `groups[${groupIndex}].label`);

    if (groupIds.has(group.id)) {
      throw configError(`groups 重复定义分组：${group.id}`);
    }

    if (!Array.isArray(group.permissions)) {
      throw configError(`groups[${groupIndex}].permissions 必须是数组。`);
    }

    groupIds.add(group.id);
    const groupActions = new Set<string>();
    const permissions = group.permissions.map((permission, permissionIndex) => {
      const context = `groups[${groupIndex}].permissions[${permissionIndex}]`;

      assertNonEmptyString(permission.action, `${context}.action`);
      assertKnownPermissionAction(permission.action, `${context}.action`);
      assertNonEmptyString(permission.label, `${context}.label`);

      if (groupActions.has(permission.action)) {
        throw configError(`${context} 在同一分组内重复：${permission.action}`);
      }

      groupActions.add(permission.action);

      if (!catalogActionSet.has(permission.action)) {
        catalogActionSet.add(permission.action);
        catalogActions.push(permission.action);
      }

      return {
        action: permission.action,
        label: permission.label,
      };
    });

    return {
      id: group.id,
      label: group.label,
      permissions,
    };
  });

  return { groups: validatedGroups, catalogActions };
}

function validateRoleDefaultPermissions(
  defaults: Record<string, string[]>,
  roleOrder: readonly Role[],
  catalogActions: readonly PermissionAction[],
): Record<Role, readonly PermissionAction[]> {
  if (!defaults || typeof defaults !== "object") {
    throw configError("default_role_permissions 必须是对象。");
  }

  for (const role of Object.keys(defaults)) {
    assertKnownRole(role, "default_role_permissions");
  }

  const catalogActionSet = new Set<string>(catalogActions);
  const roleDefaults = {} as Record<Role, readonly PermissionAction[]>;

  for (const role of roleOrder) {
    const rawPermissions = defaults[role];

    if (!Array.isArray(rawPermissions)) {
      throw configError(`default_role_permissions.${role} 必须是数组。`);
    }

    const seen = new Set<string>();
    const permissions: PermissionAction[] = [];

    for (const [index, permission] of rawPermissions.entries()) {
      const context = `default_role_permissions.${role}[${index}]`;

      assertNonEmptyString(permission, context);
      assertKnownPermissionAction(permission, context);

      if (!catalogActionSet.has(permission)) {
        throw configError(`${context} 没有出现在权限目录中：${permission}`);
      }

      if (!seen.has(permission)) {
        seen.add(permission);
        permissions.push(permission);
      }
    }

    roleDefaults[role] = permissions;
  }

  for (const permission of OWNER_LOCKED_PERMISSIONS) {
    if (!roleDefaults.owner.includes(permission)) {
      throw configError(`owner 默认权限缺少锁定权限：${permission}`);
    }
  }

  return roleDefaults;
}

function validatePermissionConfig(config: PermissionConfigFile): ValidatedPermissionConfig {
  if (config.schema_version !== CONFIG_SCHEMA_VERSION) {
    throw configError(
      `不支持的 schema_version：${String(config.schema_version)}`,
    );
  }

  const roleOrder = validateRoleOrder(config.roles.order);
  const roleLabels = validateRoleLabels(config.roles.labels, roleOrder);
  const permissionCatalog = validatePermissionGroups(config.groups);
  const roleDefaultPermissions = validateRoleDefaultPermissions(
    config.default_role_permissions,
    roleOrder,
    permissionCatalog.catalogActions,
  );

  return {
    roleOrder,
    roleLabels,
    permissionGroups: permissionCatalog.groups,
    allPermissionActions: permissionCatalog.catalogActions,
    roleDefaultPermissions,
  };
}

const validatedPermissionConfig = validatePermissionConfig(
  permissionsConfig as PermissionConfigFile,
);

export const ROLE_ORDER: Role[] = [...validatedPermissionConfig.roleOrder];
export const ROLE_LABELS: Record<Role, string> = {
  ...validatedPermissionConfig.roleLabels,
};
export const PERMISSION_GROUPS: PermissionGroupDefinition[] =
  validatedPermissionConfig.permissionGroups.map((group) => ({
    ...group,
    permissions: group.permissions.map((permission) => ({ ...permission })),
  }));
export const ALL_PERMISSION_ACTIONS: PermissionAction[] = [
  ...validatedPermissionConfig.allPermissionActions,
];
export const ROLE_DEFAULT_PERMISSIONS: Record<Role, readonly PermissionAction[]> =
  (() => {
    const defaults = {} as Record<Role, readonly PermissionAction[]>;

    for (const role of validatedPermissionConfig.roleOrder) {
      defaults[role] = [
        ...validatedPermissionConfig.roleDefaultPermissions[role],
      ];
    }

    return defaults;
  })();
