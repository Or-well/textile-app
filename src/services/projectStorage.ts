import type { ProjectDirectoryHandle, ProjectStorageKind } from "./projectFs";
import {
  listFiles,
  readJson,
  readJsonl,
  readTextFile,
  writeJson,
  writeJsonl,
  writeTextFile,
} from "./projectFs";

export interface ProjectStorage {
  readonly kind: ProjectStorageKind;
  readonly name: string;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  readJson<T>(path: string): Promise<T>;
  writeJson<T>(path: string, data: T): Promise<void>;
  readJsonl<T>(path: string): Promise<T[]>;
  writeJsonl<T>(path: string, rows: T[]): Promise<void>;
  listFiles(path: string): Promise<string[]>;
}

/**
 * FolderProjectStorage is the future adapter for normal project folders.
 * Current services still call projectFs directly, so this wrapper is kept as
 * an explicit migration target instead of forcing a broad storage rewrite now.
 */
export class FolderProjectStorage implements ProjectStorage {
  readonly kind = "folder" as const;
  readonly root: ProjectDirectoryHandle;

  constructor(root: ProjectDirectoryHandle) {
    this.root = root;
  }

  get name(): string {
    return this.root.name;
  }

  readText(path: string): Promise<string> {
    return readTextFile(this.root, path);
  }

  writeText(path: string, content: string): Promise<void> {
    return writeTextFile(this.root, path, content);
  }

  readJson<T>(path: string): Promise<T> {
    return readJson<T>(this.root, path);
  }

  writeJson<T>(path: string, data: T): Promise<void> {
    return writeJson<T>(this.root, path, data);
  }

  readJsonl<T>(path: string): Promise<T[]> {
    return readJsonl<T>(this.root, path);
  }

  writeJsonl<T>(path: string, rows: T[]): Promise<void> {
    return writeJsonl<T>(this.root, path, rows);
  }

  listFiles(path: string): Promise<string[]> {
    return listFiles(this.root, path);
  }
}

/**
 * PackedProjectStorage is the future adapter for .hproj project files.
 * Writes currently update the in-memory project root only; callers should
 * export a fresh .hproj file when they want those changes persisted.
 */
export class PackedProjectStorage implements ProjectStorage {
  readonly kind = "packed" as const;
  readonly root: ProjectDirectoryHandle;

  constructor(root: ProjectDirectoryHandle) {
    this.root = root;
  }

  get name(): string {
    return this.root.sourceFileName ?? this.root.name;
  }

  readText(path: string): Promise<string> {
    return readTextFile(this.root, path);
  }

  writeText(path: string, content: string): Promise<void> {
    return writeTextFile(this.root, path, content);
  }

  readJson<T>(path: string): Promise<T> {
    return readJson<T>(this.root, path);
  }

  writeJson<T>(path: string, data: T): Promise<void> {
    return writeJson<T>(this.root, path, data);
  }

  readJsonl<T>(path: string): Promise<T[]> {
    return readJsonl<T>(this.root, path);
  }

  writeJsonl<T>(path: string, rows: T[]): Promise<void> {
    return writeJsonl<T>(this.root, path, rows);
  }

  listFiles(path: string): Promise<string[]> {
    return listFiles(this.root, path);
  }
}
