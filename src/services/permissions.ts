import {
  ALL_PERMISSION_ACTIONS,
  OWNER_LOCKED_PERMISSIONS,
  PERMISSION_ACTIONS,
  ROLE_ORDER,
  ROLE_DEFAULT_PERMISSIONS,
  type PermissionAction,
} from "../model/permissions";
import {
  getCurrentProofreadRoundFirstProofreader,
  getEntryProofreadCount,
  getFirstTranslator,
  hasWorkflowTarget,
  isEntryProofreadComplete,
  normalizeProofreadUsers,
  normalizeWorkflowSettings,
} from "../model/status";
import type {
  Comment,
  Entry,
  Member,
  ProjectConfig,
  ProjectWorkflowSettings,
  Role,
  RolePermissions,
} from "../model/types";
import {
  readLocalStorageItem,
  removeLocalStorageItem,
  writeLocalStorageItem,
} from "../utils/browserStorage";

const CURRENT_USER_STORAGE_KEY = "textile.currentUser";

let currentUser: Member | null = readStoredUser();
let currentRolePermissions: RolePermissions | undefined;
let currentPermissionSchemaVersion = 1;
export const CURRENT_PERMISSION_SCHEMA_VERSION = 2;

function toSessionMember(user: Member): Member {
  const sessionMember = { ...user };

  delete sessionMember.password_hash;
  delete sessionMember.password_salt;
  delete sessionMember.password_updated_at;

  return sessionMember;
}

function readStoredUser(): Member | null {
  const text = readLocalStorageItem(CURRENT_USER_STORAGE_KEY);

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as Member;
  } catch {
    removeLocalStorageItem(CURRENT_USER_STORAGE_KEY);
    return null;
  }
}

function storeCurrentUser(user: Member | null): void {
  if (!user) {
    removeLocalStorageItem(CURRENT_USER_STORAGE_KEY);
    return;
  }

  writeLocalStorageItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
}

function normalizeAction(action: PermissionAction | string): string {
  const actionName = action.trim();

  if (actionName === "export.release") {
    return PERMISSION_ACTIONS.RELEASE_EXPORT;
  }

  if (actionName === "task.read") {
    return PERMISSION_ACTIONS.TASK_VIEW;
  }

  return actionName;
}

function getPermissionAliases(actionName: string): string[] {
  if (actionName === PERMISSION_ACTIONS.COMMENT_VIEW) {
    return [PERMISSION_ACTIONS.COMMENT_READ];
  }

  if (
    actionName === PERMISSION_ACTIONS.COMMENT_CREATE ||
    actionName === PERMISSION_ACTIONS.COMMENT_REPLY
  ) {
    return [PERMISSION_ACTIONS.COMMENT_WRITE];
  }

  return [];
}

function uniquePermissions(permissions: readonly string[]): string[] {
  return Array.from(
    new Set(
      permissions
        .map((permission) => normalizeAction(permission))
        .filter((permission) => ALL_PERMISSION_ACTIONS.includes(permission as PermissionAction)),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function cloneRolePermissions(source: Record<Role, readonly string[]>): RolePermissions {
  return Object.fromEntries(
    ROLE_ORDER.map((role) => [role, uniquePermissions(source[role] ?? [])]),
  ) as RolePermissions;
}

function getRolePermissionsSource(project?: ProjectConfig): RolePermissions | undefined {
  return project?.settings.role_permissions ?? currentRolePermissions;
}

function getPermissionSchemaVersion(project?: ProjectConfig): number {
  return (
    project?.settings.permission_schema_version ??
    (project ? 1 : currentPermissionSchemaVersion)
  );
}

const CHANGE_PACKAGE_PROTOCOL_PERMISSIONS = [
  PERMISSION_ACTIONS.CHANGE_PACKAGE_EXPORT_MEMBER_CHANGES,
  PERMISSION_ACTIONS.CHANGE_PACKAGE_IMPORT_MEMBER_CHANGES,
  PERMISSION_ACTIONS.CHANGE_PACKAGE_EXPORT_PROJECT_UPDATE,
  PERMISSION_ACTIONS.CHANGE_PACKAGE_IMPORT_PROJECT_UPDATE,
] as const;

const ENTRY_MANAGEMENT_COMPATIBILITY_PERMISSIONS = [
  PERMISSION_ACTIONS.ENTRY_LOCK,
  PERMISSION_ACTIONS.ENTRY_HIDE,
] as const;

function getConfiguredRolePermissions(project?: ProjectConfig): RolePermissions {
  const configured = getRolePermissionsSource(project);
  const permissionSchemaVersion = getPermissionSchemaVersion(project);
  const defaults = getDefaultRolePermissions();
  const rolePermissions: RolePermissions = {};
  const hasProtocolPermissions = ROLE_ORDER.some((role) =>
    configured?.[role]?.some((permission) =>
      CHANGE_PACKAGE_PROTOCOL_PERMISSIONS.includes(
        normalizeAction(permission) as (typeof CHANGE_PACKAGE_PROTOCOL_PERMISSIONS)[number],
      ),
    ),
  );

  for (const role of ROLE_ORDER) {
    const configuredPermissions = configured?.[role] ?? defaults[role] ?? [];
    const compatibilityPermissions =
      configured && !hasProtocolPermissions
        ? (defaults[role] ?? []).filter((permission) =>
            CHANGE_PACKAGE_PROTOCOL_PERMISSIONS.includes(
              permission as (typeof CHANGE_PACKAGE_PROTOCOL_PERMISSIONS)[number],
            ),
          )
        : [];
    const entryManagementCompatibilityPermissions =
      configured && permissionSchemaVersion < 2
        ? (defaults[role] ?? []).filter((permission) =>
            ENTRY_MANAGEMENT_COMPATIBILITY_PERMISSIONS.includes(
              permission as (typeof ENTRY_MANAGEMENT_COMPATIBILITY_PERMISSIONS)[number],
            ),
          )
        : [];

    rolePermissions[role] = uniquePermissions([
      ...configuredPermissions,
      ...compatibilityPermissions,
      ...entryManagementCompatibilityPermissions,
    ]);
  }

  for (const permission of OWNER_LOCKED_PERMISSIONS) {
    if (!rolePermissions.owner?.includes(permission)) {
      rolePermissions.owner = [...(rolePermissions.owner ?? []), permission];
    }
  }

  return rolePermissions;
}

function applySystemSafetyPermissions(
  user: Member,
  permissions: Set<string>,
): Set<string> {
  const nextPermissions = new Set(permissions);

  if (hasRole(user, "owner")) {
    for (const permission of OWNER_LOCKED_PERMISSIONS) {
      nextPermissions.add(permission);
    }
  }

  return nextPermissions;
}

export function setPermissionProject(project: ProjectConfig | null | undefined): void {
  currentRolePermissions = project?.settings.role_permissions;
  currentPermissionSchemaVersion =
    project?.settings.permission_schema_version ?? 1;
}

export function getDefaultRolePermissions(): RolePermissions {
  return cloneRolePermissions(ROLE_DEFAULT_PERMISSIONS);
}

export function resetRolePermissionsToDefault(): RolePermissions {
  return getDefaultRolePermissions();
}

export function getRolePermissions(project?: ProjectConfig): RolePermissions {
  return getConfiguredRolePermissions(project);
}

export function getEffectivePermissions(
  member: Member | null | undefined,
  project?: ProjectConfig,
): string[] {
  if (!member?.active) {
    return [];
  }

  const rolePermissions = getConfiguredRolePermissions(project);
  const permissions = new Set<string>();

  for (const role of member.roles) {
    for (const permission of rolePermissions[role] ?? []) {
      permissions.add(normalizeAction(permission));
    }
  }

  for (const permission of member.allow_permissions ?? []) {
    permissions.add(normalizeAction(permission));
  }

  for (const permission of member.deny_permissions ?? []) {
    permissions.delete(normalizeAction(permission));
  }

  return Array.from(applySystemSafetyPermissions(member, permissions)).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function validateRolePermissionChange(
  project: ProjectConfig,
  nextRolePermissions: RolePermissions,
  members: Member[] = [],
): void {
  for (const permission of OWNER_LOCKED_PERMISSIONS) {
    if (!nextRolePermissions.owner?.includes(permission)) {
      throw new Error("项目负责人关键权限不能取消。");
    }
  }

  if (members.length === 0) {
    return;
  }

  const simulatedProject: ProjectConfig = {
    ...project,
    settings: {
      ...project.settings,
      role_permissions: nextRolePermissions,
    },
  };
  const hasManager = members.some(
    (member) =>
      member.active &&
      can(member, PERMISSION_ACTIONS.PROJECT_MANAGE, simulatedProject) &&
      can(member, PERMISSION_ACTIONS.MEMBER_MANAGE, simulatedProject) &&
      can(member, PERMISSION_ACTIONS.ROLE_MANAGE, simulatedProject),
  );

  if (!hasManager) {
    throw new Error("至少需要保留一名可用成员拥有项目、成员和权限管理能力。");
  }
}

export function getCurrentUser(): Member | null {
  currentUser = currentUser ?? readStoredUser();

  return currentUser;
}

export function setCurrentUser(user: Member | null): void {
  currentUser = user ? toSessionMember(user) : null;
  storeCurrentUser(currentUser);
}

export function hasRole(user: Member | null | undefined, role: Role): boolean {
  return Boolean(user?.active && user.roles.includes(role));
}

export function isOwnerMember(user: Member | null | undefined): boolean {
  return hasRole(user, "owner");
}

export function can(
  user: Member | null | undefined,
  action: PermissionAction | string,
  project?: ProjectConfig,
): boolean {
  if (!user?.active) {
    return false;
  }

  const actionName = normalizeAction(action);
  const permissions = new Set(getEffectivePermissions(user, project));

  return (
    permissions.has(actionName) ||
    getPermissionAliases(actionName).some((permission) => permissions.has(permission))
  );
}

export function assertCan(
  user: Member | null | undefined,
  action: PermissionAction | string,
  project?: ProjectConfig,
  message = "当前成员没有执行此操作的权限。",
): asserts user is Member {
  if (!can(user, action, project)) {
    throw new Error(message);
  }
}

export function canEditEntry(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
): boolean {
  if (!entry || entry.locked || entry.hidden || entry.status === "reviewed") {
    return false;
  }

  return can(user, PERMISSION_ACTIONS.ENTRY_EDIT);
}

function canUseEntryWorkflow(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
  action: PermissionAction,
): boolean {
  if (!entry || entry.locked || entry.hidden) {
    return false;
  }

  return can(user, action);
}

export function canTranslateEntry(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
): boolean {
  if (!entry || entry.status === "reviewed") {
    return false;
  }

  return (
    canUseEntryWorkflow(user, entry, PERMISSION_ACTIONS.ENTRY_TRANSLATE) ||
    canEditEntry(user, entry)
  );
}

export type ProofreadBlockReason =
  | "missing_entry"
  | "missing_user"
  | "missing_permission"
  | "entry_locked"
  | "entry_hidden"
  | "entry_disputed"
  | "empty_target"
  | "proofread_disabled"
  | "already_reviewed"
  | "proofread_complete"
  | "self_proofread_disabled"
  | "already_proofread_by_user"
  | "invalid_status";

export function getProofreadBlockReason(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
  workflow?: ProjectWorkflowSettings,
): ProofreadBlockReason | null {
  if (!entry) {
    return "missing_entry";
  }

  if (!user?.id) {
    return "missing_user";
  }

  if (!can(user, PERMISSION_ACTIONS.ENTRY_PROOFREAD)) {
    return "missing_permission";
  }

  if (entry.locked) {
    return "entry_locked";
  }

  if (entry.hidden) {
    return "entry_hidden";
  }

  if (entry.disputed) {
    return "entry_disputed";
  }

  if (!hasWorkflowTarget(entry)) {
    return "empty_target";
  }

  const settings = normalizeWorkflowSettings(workflow);

  if (settings.proofread_required <= 0) {
    return "proofread_disabled";
  }

  if (entry.status === "reviewed") {
    return "already_reviewed";
  }

  if (getEntryProofreadCount(entry) >= settings.proofread_required) {
    return "proofread_complete";
  }

  if (
    !settings.allow_self_proofread &&
    getFirstTranslator(entry) === user.id
  ) {
    return "self_proofread_disabled";
  }

  if (
    !settings.allow_same_user_multi_proofread &&
    normalizeProofreadUsers(entry.proofread_by).includes(user.id)
  ) {
    return "already_proofread_by_user";
  }

  if (entry.status !== "translated" && entry.status !== "proofread") {
    return "invalid_status";
  }

  return null;
}

export function getProofreadBlockMessage(
  reason: ProofreadBlockReason | null,
): string {
  switch (reason) {
    case "entry_locked":
      return "当前词条已锁定，不能校对。";
    case "entry_hidden":
      return "当前词条已隐藏，不能校对。";
    case "entry_disputed":
      return "当前词条存在争议，解决争议后才能校对。";
    case "empty_target":
      return "当前词条没有译文，不能校对。";
    case "proofread_disabled":
      return "当前项目未启用校对流程。";
    case "already_reviewed":
      return "当前词条已经完成审核。";
    case "proofread_complete":
      return "当前词条已完成所需校对次数。";
    case "self_proofread_disabled":
      return "当前用户被记录为该译文的译者，项目未允许校对自己的译文。";
    case "already_proofread_by_user":
      return "当前用户已经校对过该词条，项目未允许同一成员重复校对。";
    case "invalid_status":
      return "当前词条尚未进入可校对阶段。";
    default:
      return "";
  }
}

export function canProofreadEntry(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
  workflow?: ProjectWorkflowSettings,
): boolean {
  return getProofreadBlockReason(user, entry, workflow) === null;
}

export function canReviewEntry(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
  workflow?: ProjectWorkflowSettings,
): boolean {
  return getReviewBlockReason(user, entry, workflow) === null;
}

export type ReviewBlockReason =
  | "missing_entry"
  | "missing_user"
  | "missing_permission"
  | "entry_locked"
  | "entry_hidden"
  | "entry_disputed"
  | "empty_target"
  | "review_disabled"
  | "proofread_incomplete"
  | "already_reviewed"
  | "self_review_disabled"
  | "invalid_status";

export function getReviewBlockReason(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
  workflow?: ProjectWorkflowSettings,
): ReviewBlockReason | null {
  if (!entry) {
    return "missing_entry";
  }

  if (!user?.id) {
    return "missing_user";
  }

  if (!can(user, PERMISSION_ACTIONS.ENTRY_REVIEW)) {
    return "missing_permission";
  }

  if (entry.locked) {
    return "entry_locked";
  }

  if (entry.hidden) {
    return "entry_hidden";
  }

  if (entry.disputed) {
    return "entry_disputed";
  }

  if (!hasWorkflowTarget(entry)) {
    return "empty_target";
  }

  const settings = normalizeWorkflowSettings(workflow);

  if (!settings.review_required) {
    return "review_disabled";
  }

  if (entry.status === "reviewed") {
    return "already_reviewed";
  }

  if (!isEntryProofreadComplete(entry, settings)) {
    return "proofread_incomplete";
  }

  if (
    !settings.allow_self_review &&
    getCurrentProofreadRoundFirstProofreader(entry) === user.id
  ) {
    return "self_review_disabled";
  }

  if (entry.status !== "translated" && entry.status !== "proofread") {
    return "invalid_status";
  }

  return null;
}

export function getReviewBlockMessage(
  reason: ReviewBlockReason | null,
): string {
  switch (reason) {
    case "entry_locked":
      return "当前词条已锁定，不能审核。";
    case "entry_hidden":
      return "当前词条已隐藏，不能审核。";
    case "entry_disputed":
      return "当前词条存在争议，解决争议后才能审核。";
    case "empty_target":
      return "当前词条没有译文，不能审核。";
    case "review_disabled":
      return "当前项目未启用审核流程。";
    case "proofread_incomplete":
      return "当前词条尚未完成所需校对次数。";
    case "already_reviewed":
      return "当前词条已经完成审核。";
    case "self_review_disabled":
      return "当前用户是最近一轮校对的首位校对者，项目未允许审核自己校对的译文。";
    case "invalid_status":
      return "当前词条尚未进入可审核阶段。";
    default:
      return "";
  }
}

export function canRollbackEntry(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
): boolean {
  return Boolean(
    entry &&
      (entry.status === "proofread" ||
        entry.status === "reviewed" ||
        getEntryProofreadCount(entry) > 0) &&
      canUseEntryWorkflow(user, entry, PERMISSION_ACTIONS.ENTRY_ROLLBACK),
  );
}

export function canRestoreEntryVersion(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
): boolean {
  if (!entry || entry.locked || entry.hidden) {
    return false;
  }

  return Boolean(
    can(user, PERMISSION_ACTIONS.ENTRY_EDIT) ||
      can(user, PERMISSION_ACTIONS.ENTRY_TRANSLATE),
  );
}

export function canLockEntry(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.ENTRY_LOCK);
}

export function canHideEntry(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.ENTRY_HIDE);
}

export function canMarkDisputed(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
): boolean {
  return Boolean(
    entry &&
      !entry.disputed &&
      canUseEntryWorkflow(user, entry, PERMISSION_ACTIONS.ENTRY_MARK_DISPUTED),
  );
}

export function canResolveDispute(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
): boolean {
  if (!entry || !entry.disputed || entry.locked || entry.hidden) {
    return false;
  }

  return Boolean(
    canUseEntryWorkflow(user, entry, PERMISSION_ACTIONS.ENTRY_RESOLVE_DISPUTE) ||
      can(user, PERMISSION_ACTIONS.COMMENT_RESOLVE),
  );
}

export function canManageTask(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.TASK_MANAGE);
}

export function canViewTask(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.TASK_VIEW);
}

export function canCreateTask(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.TASK_CREATE);
}

export function canUpdateTask(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.TASK_UPDATE) || canManageTask(user);
}

export function canAssignTask(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.TASK_ASSIGN) || canManageTask(user);
}

export function canSubmitTask(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.TASK_SUBMIT);
}

export function canCompleteTask(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.TASK_COMPLETE) || canManageTask(user);
}

export function canReclaimTask(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.TASK_RECLAIM) || canManageTask(user);
}

export function canDeleteTask(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.TASK_DELETE) || canManageTask(user);
}

export function canReopenTask(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.TASK_REOPEN) || canManageTask(user);
}

export function canViewComment(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.COMMENT_VIEW);
}

export function canCreateComment(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.COMMENT_CREATE);
}

export function canReplyComment(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.COMMENT_REPLY);
}

export function canResolveComment(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.COMMENT_RESOLVE);
}

export function canReopenComment(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.COMMENT_REOPEN);
}

export function canDeleteComment(
  user: Member | null | undefined,
  comment: Comment | null | undefined,
): boolean {
  if (!comment) {
    return false;
  }

  return (
    can(user, PERMISSION_ACTIONS.COMMENT_DELETE_ANY) ||
    (comment.user_id === user?.id && can(user, PERMISSION_ACTIONS.COMMENT_DELETE_OWN))
  );
}

export function canImportChangePackage(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CHANGE_PACKAGE_IMPORT);
}

export function canExportChangePackage(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CHANGE_PACKAGE_EXPORT);
}

export function canExportMemberChangePackage(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CHANGE_PACKAGE_EXPORT_MEMBER_CHANGES);
}

export function canImportMemberChangePackage(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CHANGE_PACKAGE_IMPORT_MEMBER_CHANGES);
}

export function canExportProjectUpdatePackage(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CHANGE_PACKAGE_EXPORT_PROJECT_UPDATE);
}

export function canImportProjectUpdatePackage(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CHANGE_PACKAGE_IMPORT_PROJECT_UPDATE);
}

export function canReviewChangePackage(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CHANGE_PACKAGE_REVIEW);
}

export function canSignChangePackage(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CHANGE_PACKAGE_SIGN);
}

export function canVerifyChangePackage(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CHANGE_PACKAGE_VERIFY);
}

export function canDangerousImportChangePackage(
  user: Member | null | undefined,
): boolean {
  return can(user, PERMISSION_ACTIONS.CHANGE_PACKAGE_DANGEROUS_IMPORT);
}

export function canExportMaintenanceChangePackage(
  user: Member | null | undefined,
): boolean {
  return can(user, PERMISSION_ACTIONS.CHANGE_PACKAGE_EXPORT_MAINTENANCE);
}

export function canImportMaintenanceChangePackage(
  user: Member | null | undefined,
): boolean {
  return can(user, PERMISSION_ACTIONS.CHANGE_PACKAGE_IMPORT_MAINTENANCE);
}

export function canExportRelease(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.RELEASE_EXPORT);
}

export function canProjectBackup(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.PROJECT_BACKUP);
}

export function canViewKey(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.KEY_VIEW);
}

export function canGenerateKey(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.KEY_GENERATE);
}

export function canImportPrivateKey(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.KEY_IMPORT_PRIVATE);
}

export function canExportPrivateKey(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.KEY_EXPORT_PRIVATE);
}

export function canRegisterPublicKey(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.KEY_REGISTER_PUBLIC);
}

export function canRotateKey(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.KEY_ROTATE);
}

export function canRevokeKey(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.KEY_REVOKE);
}

export function canRevokeOwnKey(user: Member | null | undefined): boolean {
  return canRevokeKey(user) || canRotateKey(user);
}

export function canConfigureStats(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.PROJECT_MANAGE);
}

export function canClearAppCache(
  user: Member | null | undefined,
  project?: ProjectConfig,
): boolean {
  return can(user, PERMISSION_ACTIONS.APP_CACHE_CLEAR, project);
}

export function canDeleteProject(
  user: Member | null | undefined,
  project?: ProjectConfig,
): boolean {
  return can(user, PERMISSION_ACTIONS.PROJECT_DELETE, project);
}

export function canManageRolePermissions(
  user: Member | null | undefined,
  project?: ProjectConfig,
): boolean {
  return can(user, PERMISSION_ACTIONS.ROLE_MANAGE, project);
}

export function canManageMemberPermissionOverrides(
  actor: Member | null | undefined,
  target: Member | null | undefined,
  project?: ProjectConfig,
): boolean {
  if (!actor?.active || !target) {
    return false;
  }

  if (!can(actor, PERMISSION_ACTIONS.MEMBER_MANAGE, project)) {
    return false;
  }

  if (hasRole(actor, "owner")) {
    return true;
  }

  return !hasRole(target, "owner");
}

export function canViewFile(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.FILE_VIEW);
}

export function canCreateFile(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.FILE_CREATE);
}

export function canUpdateFile(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.FILE_UPDATE);
}

export function canImportFileTranslation(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.FILE_IMPORT_TRANSLATION);
}

export function canRenameFile(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.FILE_RENAME);
}

export function canLockFile(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.FILE_LOCK);
}

export function canHideFile(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.FILE_HIDE);
}

export function canDeleteFile(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.FILE_DELETE);
}

export function canManageFileFolder(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.FILE_MANAGE_FOLDER);
}

export function canManageTerm(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.TERM_MANAGE);
}

function canUseTermPermission(
  user: Member | null | undefined,
  action: PermissionAction,
): boolean {
  return can(user, action) || canManageTerm(user);
}

export function canCreateTerm(user: Member | null | undefined): boolean {
  return canUseTermPermission(user, PERMISSION_ACTIONS.TERM_CREATE);
}

export function canUpdateTerm(user: Member | null | undefined): boolean {
  return canUseTermPermission(user, PERMISSION_ACTIONS.TERM_UPDATE);
}

export function canDeleteTerm(user: Member | null | undefined): boolean {
  return canUseTermPermission(user, PERMISSION_ACTIONS.TERM_DELETE);
}

export function canImportTerm(user: Member | null | undefined): boolean {
  return canUseTermPermission(user, PERMISSION_ACTIONS.TERM_IMPORT);
}

export function canExportTerm(user: Member | null | undefined): boolean {
  return canUseTermPermission(user, PERMISSION_ACTIONS.TERM_EXPORT);
}

export function canViewContext(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CONTEXT_VIEW);
}

export function canCreateContext(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CONTEXT_CREATE);
}

export function canUpdateContext(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CONTEXT_UPDATE);
}

export function canDeleteContext(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CONTEXT_DELETE);
}
