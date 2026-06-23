import {
  readLocalStorageItem,
  removeLocalStorageItem,
  writeLocalStorageItem,
} from "../utils/browserStorage";
import { nowIso } from "../utils/time";

export interface ProjectWorkspacePosition {
  projectId: string;
  userId: string;
  lastFileId: string;
  entryByFileId: Record<string, string>;
  updatedAt: string;
}

const WORKSPACE_POSITIONS_STORAGE_KEY = "textile.workspacePositions.v1";
const MAX_WORKSPACE_POSITIONS = 50;

function normalizePosition(
  value: unknown,
): ProjectWorkspacePosition | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const row = value as Partial<ProjectWorkspacePosition>;

  if (
    typeof row.projectId !== "string" ||
    !row.projectId ||
    typeof row.userId !== "string" ||
    !row.userId
  ) {
    return undefined;
  }

  const entryByFileId =
    row.entryByFileId && typeof row.entryByFileId === "object"
      ? Object.fromEntries(
          Object.entries(row.entryByFileId).filter(
            ([fileId, entryId]) =>
              Boolean(fileId) && typeof entryId === "string" && Boolean(entryId),
          ),
        )
      : {};

  return {
    projectId: row.projectId,
    userId: row.userId,
    lastFileId: typeof row.lastFileId === "string" ? row.lastFileId : "",
    entryByFileId,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
  };
}

function readPositions(): ProjectWorkspacePosition[] {
  const text = readLocalStorageItem(WORKSPACE_POSITIONS_STORAGE_KEY);

  if (!text) {
    return [];
  }

  try {
    const rows = JSON.parse(text) as unknown;

    return Array.isArray(rows)
      ? rows
          .map(normalizePosition)
          .filter(
            (position): position is ProjectWorkspacePosition =>
              position !== undefined,
          )
      : [];
  } catch {
    removeLocalStorageItem(WORKSPACE_POSITIONS_STORAGE_KEY);
    return [];
  }
}

function writePositions(positions: ProjectWorkspacePosition[]): void {
  const sorted = [...positions].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );

  writeLocalStorageItem(
    WORKSPACE_POSITIONS_STORAGE_KEY,
    JSON.stringify(sorted.slice(0, MAX_WORKSPACE_POSITIONS)),
  );
}

function replacePosition(position: ProjectWorkspacePosition): void {
  writePositions([
    position,
    ...readPositions().filter(
      (item) =>
        item.projectId !== position.projectId || item.userId !== position.userId,
    ),
  ]);
}

export function getProjectWorkspacePosition(
  projectId: string,
  userId: string,
  validFileIds?: readonly string[],
): ProjectWorkspacePosition | null {
  const position = readPositions().find(
    (item) => item.projectId === projectId && item.userId === userId,
  );

  if (!position) {
    return null;
  }

  if (!validFileIds) {
    return position;
  }

  const validFiles = new Set(validFileIds);
  const normalizedPosition: ProjectWorkspacePosition = {
    ...position,
    lastFileId: validFiles.has(position.lastFileId) ? position.lastFileId : "",
    entryByFileId: Object.fromEntries(
      Object.entries(position.entryByFileId).filter(([fileId]) =>
        validFiles.has(fileId),
      ),
    ),
  };

  if (
    normalizedPosition.lastFileId !== position.lastFileId ||
    Object.keys(normalizedPosition.entryByFileId).length !==
      Object.keys(position.entryByFileId).length
  ) {
    replacePosition(normalizedPosition);
  }

  return normalizedPosition;
}

export function rememberProjectFilePosition(
  projectId: string,
  userId: string,
  fileId: string,
): void {
  if (!projectId || !userId || !fileId) {
    return;
  }

  const current = getProjectWorkspacePosition(projectId, userId);

  replacePosition({
    projectId,
    userId,
    lastFileId: fileId,
    entryByFileId: current?.entryByFileId ?? {},
    updatedAt: nowIso(),
  });
}

export function rememberProjectEntryPosition(
  projectId: string,
  userId: string,
  fileId: string,
  entryId: string,
): void {
  if (!projectId || !userId || !fileId || !entryId) {
    return;
  }

  const current = getProjectWorkspacePosition(projectId, userId);

  replacePosition({
    projectId,
    userId,
    lastFileId: fileId,
    entryByFileId: {
      ...current?.entryByFileId,
      [fileId]: entryId,
    },
    updatedAt: nowIso(),
  });
}

export function removeProjectWorkspacePositions(projectId: string): void {
  if (!projectId) {
    return;
  }

  writePositions(
    readPositions().filter((position) => position.projectId !== projectId),
  );
}

export function clearAllWorkspacePositions(): void {
  removeLocalStorageItem(WORKSPACE_POSITIONS_STORAGE_KEY);
}
