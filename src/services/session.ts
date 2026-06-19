import type { Member } from "../model/types";
import { nowIso } from "../utils/time";

export interface ProjectSession {
  projectId: string;
  userId: string;
  loginAt: string;
  expiresAt?: string;
}

const SESSION_STORAGE_KEY = "textile.projectSessions.v1";
const DEFAULT_REMEMBER_DAYS = 30;

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined";
}

function readSessions(): ProjectSession[] {
  if (!canUseBrowserStorage()) {
    return [];
  }

  const text = window.localStorage.getItem(SESSION_STORAGE_KEY);

  if (!text) {
    return [];
  }

  try {
    const rows = JSON.parse(text) as ProjectSession[];

    return Array.isArray(rows) ? rows : [];
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return [];
  }
}

function writeSessions(sessions: ProjectSession[]): void {
  if (!canUseBrowserStorage()) {
    return;
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
}

function getExpiryDate(rememberDays: number): string | undefined {
  if (!Number.isFinite(rememberDays) || rememberDays <= 0) {
    return undefined;
  }

  const expiresAt = new Date();

  expiresAt.setDate(expiresAt.getDate() + rememberDays);

  return expiresAt.toISOString();
}

export function saveProjectSession(
  projectId: string,
  userId: string,
  rememberDays = DEFAULT_REMEMBER_DAYS,
): ProjectSession {
  const nextSession: ProjectSession = {
    projectId,
    userId,
    loginAt: nowIso(),
    expiresAt: getExpiryDate(rememberDays),
  };
  const sessions = readSessions().filter(
    (session) => session.projectId !== projectId,
  );

  writeSessions([nextSession, ...sessions]);

  return nextSession;
}

export function clearProjectSession(projectId: string): void {
  writeSessions(
    readSessions().filter((session) => session.projectId !== projectId),
  );
}

export function clearAllProjectSessions(): void {
  writeSessions([]);
}

export function getProjectSession(projectId: string): ProjectSession | null {
  return (
    readSessions().find((session) => session.projectId === projectId) ?? null
  );
}

export function isSessionExpired(session: ProjectSession): boolean {
  if (!session.expiresAt) {
    return false;
  }

  return new Date(session.expiresAt).getTime() <= Date.now();
}

export function restoreProjectSession(
  projectId: string,
  members: Member[],
): Member | null {
  const session = getProjectSession(projectId);

  if (!session || session.projectId !== projectId || isSessionExpired(session)) {
    clearProjectSession(projectId);
    return null;
  }

  const member = members.find(
    (item) => item.id === session.userId && item.active,
  );

  if (!member) {
    clearProjectSession(projectId);
    return null;
  }

  return member;
}
