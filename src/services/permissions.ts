import {
  PERMISSION_ACTIONS,
  ROLE_DEFAULT_PERMISSIONS,
  type PermissionAction,
} from "../model/permissions";
import type { Entry, Member, Role } from "../model/types";

const CURRENT_USER_STORAGE_KEY = "textile.currentUser";

let currentUser: Member | null = readStoredUser();

function readStoredUser(): Member | null {
  if (typeof window === "undefined") {
    return null;
  }

  const text = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as Member;
  } catch {
    window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    return null;
  }
}

function storeCurrentUser(user: Member | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!user) {
    window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
}

function normalizeAction(action: PermissionAction | string): string {
  return action.trim();
}

export function getCurrentUser(): Member | null {
  currentUser = currentUser ?? readStoredUser();

  return currentUser;
}

export function setCurrentUser(user: Member | null): void {
  currentUser = user;
  storeCurrentUser(user);
}

export function hasRole(user: Member | null | undefined, role: Role): boolean {
  return Boolean(user?.active && user.roles.includes(role));
}

export function can(
  user: Member | null | undefined,
  action: PermissionAction | string,
): boolean {
  if (!user?.active) {
    return false;
  }

  const actionName = normalizeAction(action);
  const permissions = new Set<string>();

  for (const role of user.roles) {
    for (const permission of ROLE_DEFAULT_PERMISSIONS[role] ?? []) {
      permissions.add(permission);
    }
  }

  for (const permission of user.allow_permissions ?? []) {
    permissions.add(permission);
  }

  for (const permission of user.deny_permissions ?? []) {
    permissions.delete(permission);
  }

  return permissions.has(actionName);
}

export function canEditEntry(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
): boolean {
  if (!entry || entry.locked || entry.hidden) {
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

export function canProofreadEntry(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
): boolean {
  return Boolean(
    entry &&
      entry.status === "translated" &&
      !entry.disputed &&
      canUseEntryWorkflow(user, entry, PERMISSION_ACTIONS.ENTRY_PROOFREAD),
  );
}

export function canReviewEntry(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
): boolean {
  return Boolean(
    entry &&
      entry.status === "proofread" &&
      !entry.disputed &&
      canUseEntryWorkflow(user, entry, PERMISSION_ACTIONS.ENTRY_REVIEW),
  );
}

export function canRollbackEntry(
  user: Member | null | undefined,
  entry: Entry | null | undefined,
): boolean {
  return Boolean(
    entry &&
      (entry.status === "proofread" || entry.status === "reviewed") &&
      canUseEntryWorkflow(user, entry, PERMISSION_ACTIONS.ENTRY_ROLLBACK),
  );
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

export function canResolveComment(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.COMMENT_RESOLVE);
}

export function canImportChangePackage(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.CHANGE_PACKAGE_IMPORT);
}

export function canExportRelease(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.RELEASE_EXPORT);
}

export function canConfigureStats(user: Member | null | undefined): boolean {
  return can(user, PERMISSION_ACTIONS.PROJECT_MANAGE);
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
