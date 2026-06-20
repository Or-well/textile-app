import type { ProjectStorage } from "../../src/services/projectStorage";

export class FailingProjectStorage implements ProjectStorage {
  private operationCount = 0;
  private readonly delegate: ProjectStorage;
  private readonly failAt: number;

  constructor(delegate: ProjectStorage, failAt: number) {
    this.delegate = delegate;
    this.failAt = failAt;
  }

  get kind() {
    return this.delegate.kind;
  }

  get name() {
    return this.delegate.name;
  }

  get sourceFileName() {
    return this.delegate.sourceFileName;
  }

  get root() {
    return this.delegate.root;
  }

  readText(path: string) {
    return this.delegate.readText(path);
  }

  writeText(path: string, content: string) {
    this.failWhenRequested();
    return this.delegate.writeText(path, content);
  }

  readBinary(path: string) {
    return this.delegate.readBinary(path);
  }

  writeBinary(path: string, content: Uint8Array) {
    this.failWhenRequested();
    return this.delegate.writeBinary(path, content);
  }

  readJson<T>(path: string) {
    return this.delegate.readJson<T>(path);
  }

  writeJson<T>(path: string, data: T) {
    this.failWhenRequested();
    return this.delegate.writeJson(path, data);
  }

  readJsonl<T>(path: string) {
    return this.delegate.readJsonl<T>(path);
  }

  writeJsonl<T>(path: string, rows: T[]) {
    this.failWhenRequested();
    return this.delegate.writeJsonl(path, rows);
  }

  listFiles(path: string) {
    return this.delegate.listFiles(path);
  }

  ensureDirectory(path: string) {
    this.failWhenRequested();
    return this.delegate.ensureDirectory(path);
  }

  fileExists(path: string) {
    return this.delegate.fileExists(path);
  }

  deleteEntry(path: string, options?: { recursive?: boolean }) {
    this.failWhenRequested();
    return this.delegate.deleteEntry(path, options);
  }

  isDirty() {
    return this.delegate.isDirty();
  }

  markClean() {
    this.delegate.markClean();
  }

  private failWhenRequested(): void {
    this.operationCount += 1;

    if (this.operationCount === this.failAt) {
      throw new Error("Injected write failure.");
    }
  }
}
