import type { ProjectDirectoryHandle, ProjectStorageKind } from "./projectFs";
import {
  deleteEntry,
  ensureDirectory,
  fileExists,
  listFiles,
  readBinaryFile,
  readJson,
  readJsonl,
  readTextFile,
  writeBinaryFile,
  writeJson,
  writeJsonl,
  writeTextFile,
} from "./projectFs";

export interface ProjectStorage {
  readonly kind: ProjectStorageKind;
  readonly name: string;
  readonly sourceFileName?: string;
  readonly root: ProjectDirectoryHandle;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, content: Uint8Array): Promise<void>;
  readJson<T>(path: string): Promise<T>;
  writeJson<T>(path: string, data: T): Promise<void>;
  readJsonl<T>(path: string): Promise<T[]>;
  writeJsonl<T>(path: string, rows: T[]): Promise<void>;
  listFiles(path: string): Promise<string[]>;
  ensureDirectory(path: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  deleteEntry(path: string, options?: { recursive?: boolean }): Promise<void>;
  isDirty(): boolean;
  markClean(): void;
}

class HandleProjectStorage implements ProjectStorage {
  readonly root: ProjectDirectoryHandle;

  constructor(root: ProjectDirectoryHandle) {
    this.root = root;
  }

  get kind(): ProjectStorageKind {
    return this.root.storageKind ?? "folder";
  }

  get name(): string {
    return this.kind === "packed"
      ? this.root.sourceFileName ?? this.root.name
      : this.root.name;
  }

  get sourceFileName(): string | undefined {
    return this.root.sourceFileName;
  }

  readText(path: string): Promise<string> {
    return readTextFile(this.root, path);
  }

  writeText(path: string, content: string): Promise<void> {
    return writeTextFile(this.root, path, content);
  }

  readBinary(path: string): Promise<Uint8Array> {
    return readBinaryFile(this.root, path);
  }

  writeBinary(path: string, content: Uint8Array): Promise<void> {
    return writeBinaryFile(this.root, path, content);
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

  ensureDirectory(path: string): Promise<void> {
    return ensureDirectory(this.root, path);
  }

  fileExists(path: string): Promise<boolean> {
    return fileExists(this.root, path);
  }

  deleteEntry(
    path: string,
    options: { recursive?: boolean } = {},
  ): Promise<void> {
    return deleteEntry(this.root, path, options);
  }

  isDirty(): boolean {
    return this.root.isDirty?.() ?? false;
  }

  markClean(): void {
    this.root.markClean?.();
  }
}

export class FolderProjectStorage extends HandleProjectStorage {}

export class PackedProjectStorage extends HandleProjectStorage {}

export function createProjectStorage(
  root: ProjectDirectoryHandle,
): ProjectStorage {
  return root.storageKind === "packed"
    ? new PackedProjectStorage(root)
    : new FolderProjectStorage(root);
}
