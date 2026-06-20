import { stringifyJsonl } from "../utils/jsonl";
import type { ProjectStorage } from "./projectStorage";

type WritePlanOperation =
  | {
      kind: "write";
      path: string;
      content: Uint8Array;
    }
  | {
      kind: "delete_file";
      path: string;
    }
  | {
      kind: "ensure_directory";
      path: string;
    }
  | {
      kind: "delete_directory";
      path: string;
    };

interface FileSnapshot {
  existed: boolean;
  content?: Uint8Array;
}

interface DirectorySnapshot {
  existed: boolean;
}

export interface ProjectWritePlanResult {
  appliedPaths: string[];
}

export class ProjectWritePlanError extends Error {
  readonly cause: unknown;
  readonly rollbackFailures: string[];

  constructor(cause: unknown, rollbackFailures: string[]) {
    const reason = cause instanceof Error ? cause.message : "未知错误。";
    const rollbackMessage =
      rollbackFailures.length > 0
        ? ` 回滚失败路径：${rollbackFailures.join("、")}。`
        : "";

    super(`项目写入失败，已尝试恢复原数据。原因：${reason}${rollbackMessage}`);
    this.name = "ProjectWritePlanError";
    this.cause = cause;
    this.rollbackFailures = rollbackFailures;
  }
}

const textEncoder = new TextEncoder();

function normalizePath(path: string): string {
  const parts = path
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter((part) => part && part !== ".");

  if (parts.length === 0 || parts.some((part) => part === "..")) {
    throw new Error(`项目写入路径不正确：${path}`);
  }

  return parts.join("/");
}

function getParentPaths(path: string): string[] {
  const parts = normalizePath(path).split("/");
  const parents: string[] = [];

  for (let index = 1; index < parts.length; index += 1) {
    parents.push(parts.slice(0, index).join("/"));
  }

  return parents;
}

function sortDeepestFirst(paths: Iterable<string>): string[] {
  return Array.from(paths).sort((left, right) => {
    const depthDiff = right.split("/").length - left.split("/").length;

    return depthDiff || right.localeCompare(left);
  });
}

export class ProjectWritePlan {
  private readonly storage: ProjectStorage;
  private readonly operations: WritePlanOperation[] = [];
  private readonly registeredPaths = new Set<string>();

  constructor(storage: ProjectStorage) {
    this.storage = storage;
  }

  writeText(path: string, content: string): this {
    return this.writeBinary(path, textEncoder.encode(content));
  }

  writeBinary(path: string, content: Uint8Array): this {
    const normalizedPath = this.registerPath(path);

    this.operations.push({
      kind: "write",
      path: normalizedPath,
      content: new Uint8Array(content),
    });

    return this;
  }

  writeJson<T>(path: string, data: T): this {
    return this.writeText(path, `${JSON.stringify(data, null, 2)}\n`);
  }

  writeJsonl<T>(path: string, rows: T[]): this {
    return this.writeText(path, stringifyJsonl(rows));
  }

  deleteFile(path: string): this {
    const normalizedPath = this.registerPath(path);

    this.operations.push({ kind: "delete_file", path: normalizedPath });

    return this;
  }

  ensureDirectory(path: string): this {
    const normalizedPath = this.registerPath(path);

    this.operations.push({
      kind: "ensure_directory",
      path: normalizedPath,
    });

    return this;
  }

  deleteDirectory(path: string): this {
    const normalizedPath = this.registerPath(path);

    this.operations.push({
      kind: "delete_directory",
      path: normalizedPath,
    });

    return this;
  }

  async execute(): Promise<ProjectWritePlanResult> {
    const fileSnapshots = new Map<string, FileSnapshot>();
    const directorySnapshots = new Map<string, DirectorySnapshot>();
    const implicitParentSnapshots = new Map<string, DirectorySnapshot>();

    await this.captureSnapshots(
      fileSnapshots,
      directorySnapshots,
      implicitParentSnapshots,
    );

    const appliedOperations: WritePlanOperation[] = [];

    try {
      for (const operation of this.operations) {
        appliedOperations.push(operation);
        await this.applyOperation(operation);
      }

      return {
        appliedPaths: appliedOperations.map((operation) => operation.path),
      };
    } catch (error) {
      const rollbackFailures = await this.rollback(
        appliedOperations,
        fileSnapshots,
        directorySnapshots,
        implicitParentSnapshots,
      );

      throw new ProjectWritePlanError(error, rollbackFailures);
    }
  }

  private registerPath(path: string): string {
    const normalizedPath = normalizePath(path);

    if (this.registeredPaths.has(normalizedPath)) {
      throw new Error(`同一写入计划不能重复操作路径：${normalizedPath}`);
    }

    this.registeredPaths.add(normalizedPath);

    return normalizedPath;
  }

  private async captureSnapshots(
    fileSnapshots: Map<string, FileSnapshot>,
    directorySnapshots: Map<string, DirectorySnapshot>,
    implicitParentSnapshots: Map<string, DirectorySnapshot>,
  ): Promise<void> {
    for (const operation of this.operations) {
      if (
        operation.kind === "write" ||
        operation.kind === "delete_file"
      ) {
        const existed = await this.storage.fileExists(operation.path);

        fileSnapshots.set(operation.path, {
          existed,
          content: existed
            ? await this.storage.readBinary(operation.path)
            : undefined,
        });

        for (const parentPath of getParentPaths(operation.path)) {
          if (!implicitParentSnapshots.has(parentPath)) {
            implicitParentSnapshots.set(parentPath, {
              existed: await this.storage.fileExists(parentPath),
            });
          }
        }
      } else {
        directorySnapshots.set(operation.path, {
          existed: await this.storage.fileExists(operation.path),
        });
      }
    }
  }

  private async applyOperation(operation: WritePlanOperation): Promise<void> {
    if (operation.kind === "write") {
      await this.storage.writeBinary(operation.path, operation.content);
      return;
    }

    if (operation.kind === "delete_file") {
      if (await this.storage.fileExists(operation.path)) {
        await this.storage.deleteEntry(operation.path);
      }
      return;
    }

    if (operation.kind === "ensure_directory") {
      await this.storage.ensureDirectory(operation.path);
      return;
    }

    if (await this.storage.fileExists(operation.path)) {
      await this.storage.deleteEntry(operation.path);
    }
  }

  private async rollback(
    appliedOperations: WritePlanOperation[],
    fileSnapshots: Map<string, FileSnapshot>,
    directorySnapshots: Map<string, DirectorySnapshot>,
    implicitParentSnapshots: Map<string, DirectorySnapshot>,
  ): Promise<string[]> {
    const rollbackFailures: string[] = [];

    for (const operation of [...appliedOperations].reverse()) {
      try {
        if (
          operation.kind === "write" ||
          operation.kind === "delete_file"
        ) {
          const snapshot = fileSnapshots.get(operation.path);

          if (snapshot?.existed && snapshot.content) {
            await this.storage.writeBinary(operation.path, snapshot.content);
          } else if (await this.storage.fileExists(operation.path)) {
            await this.storage.deleteEntry(operation.path);
          }
          continue;
        }

        const snapshot = directorySnapshots.get(operation.path);

        if (snapshot?.existed) {
          await this.storage.ensureDirectory(operation.path);
        } else if (await this.storage.fileExists(operation.path)) {
          await this.storage.deleteEntry(operation.path);
        }
      } catch {
        rollbackFailures.push(operation.path);
      }
    }

    for (const path of sortDeepestFirst(
      Array.from(implicitParentSnapshots.entries())
        .filter(([, snapshot]) => !snapshot.existed)
        .map(([path]) => path),
    )) {
      try {
        if (await this.storage.fileExists(path)) {
          await this.storage.deleteEntry(path);
        }
      } catch {
        if (!rollbackFailures.includes(path)) {
          rollbackFailures.push(path);
        }
      }
    }

    return rollbackFailures;
  }
}

export function createProjectWritePlan(
  storage: ProjectStorage,
): ProjectWritePlan {
  return new ProjectWritePlan(storage);
}
