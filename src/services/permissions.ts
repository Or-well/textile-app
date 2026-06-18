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
