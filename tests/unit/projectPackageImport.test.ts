import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "../../src/model/types";
import {
  createMemoryProjectDirectory,
  type ProjectDirectoryHandle,
  type ProjectFileHandle,
  type ProjectWritableFileStream,
} from "../../src/services/projectFs";
import {
  ProjectPackageImportError,
  importProjectPackageToParentDirectory,
} from "../../src/services/projectPackage";
import { createZip, type ZipContent } from "../../src/utils/zip";
import { createProject } from "./factories";

interface ControlledDirectoryState {
  writeCount: number;
  failWriteAt?: number;
  topDeleteFailuresRemaining: number;
  failDeletePaths: Set<string>;
}

class ControlledWritableFileStream implements ProjectWritableFileStream {
  private readonly delegate: ProjectWritableFileStream;
  private readonly state: ControlledDirectoryState;

  constructor(
    delegate: ProjectWritableFileStream,
    state: ControlledDirectoryState,
  ) {
    this.delegate = delegate;
    this.state = state;
  }

  async write(content: string | Blob | Uint8Array): Promise<void> {
    this.state.writeCount += 1;

    if (this.state.writeCount === this.state.failWriteAt) {
      throw new Error("Injected package write failure.");
    }

    await this.delegate.write(content);
  }

  close(): Promise<void> {
    return this.delegate.close();
  }
}

class ControlledFileHandle implements ProjectFileHandle {
  private readonly delegate: ProjectFileHandle;
  private readonly state: ControlledDirectoryState;

  constructor(
    delegate: ProjectFileHandle,
    state: ControlledDirectoryState,
  ) {
    this.delegate = delegate;
    this.state = state;
  }

  getFile(): Promise<File> {
    return this.delegate.getFile();
  }

  async createWritable(): Promise<ProjectWritableFileStream> {
    return new ControlledWritableFileStream(
      await this.delegate.createWritable(),
      this.state,
    );
  }
}

class ControlledDirectoryHandle implements ProjectDirectoryHandle {
  private readonly delegate: ProjectDirectoryHandle;
  private readonly path: string;
  private readonly state: ControlledDirectoryState;

  constructor(
    delegate: ProjectDirectoryHandle,
    state: ControlledDirectoryState,
    path = "",
  ) {
    this.delegate = delegate;
    this.state = state;
    this.path = path;
  }

  get name(): string {
    return this.delegate.name;
  }

  get storageKind() {
    return this.delegate.storageKind;
  }

  get sourceFileName() {
    return this.delegate.sourceFileName;
  }

  isDirty() {
    return this.delegate.isDirty?.() ?? false;
  }

  markClean() {
    this.delegate.markClean?.();
  }

  queryPermission(descriptor?: { mode?: "read" | "readwrite" }) {
    return this.delegate.queryPermission?.(descriptor) ?? Promise.resolve("granted");
  }

  requestPermission(descriptor?: { mode?: "read" | "readwrite" }) {
    return this.delegate.requestPermission?.(descriptor) ?? Promise.resolve("granted");
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ProjectFileHandle> {
    return new ControlledFileHandle(
      await this.delegate.getFileHandle(name, options),
      this.state,
    );
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ProjectDirectoryHandle> {
    const childPath = [this.path, name].filter(Boolean).join("/");

    return new ControlledDirectoryHandle(
      await this.delegate.getDirectoryHandle(name, options),
      this.state,
      childPath,
    );
  }

  async removeEntry(
    name: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    const entryPath = [this.path, name].filter(Boolean).join("/");

    if (
      this.path === "" &&
      options?.recursive &&
      this.state.topDeleteFailuresRemaining > 0
    ) {
      this.state.topDeleteFailuresRemaining -= 1;
      throw new Error("Injected package cleanup failure.");
    }

    if (this.state.failDeletePaths.has(entryPath)) {
      throw new Error("Injected package cleanup failure.");
    }

    if (!this.delegate.removeEntry) {
      throw new Error("Delete is not supported.");
    }

    await this.delegate.removeEntry(name, options);
  }

  keys(): AsyncIterableIterator<string> {
    return this.delegate.keys();
  }
}

function createParentDirectory(
  overrides: Partial<ControlledDirectoryState> = {},
): {
  root: ProjectDirectoryHandle;
  controlledRoot: ProjectDirectoryHandle;
} {
  const root = createMemoryProjectDirectory({}, "imports");
  const state: ControlledDirectoryState = {
    writeCount: 0,
    topDeleteFailuresRemaining: 0,
    failDeletePaths: new Set(),
    ...overrides,
  };

  return {
    root,
    controlledRoot: new ControlledDirectoryHandle(root, state),
  };
}

async function createProjectPackageFile(
  overrides: Partial<ZipContent> = {},
): Promise<File> {
  const project: ProjectConfig = createProject({
    name: "Imported Project",
    files: [
      {
        id: "file-1",
        name: "dialog.txt",
        source_path: "source/dialog.txt",
        entries_path: "entries/file-1",
        type: "txt",
        hidden: false,
        locked: false,
      },
    ],
  });
  const content: ZipContent = {
    "project.json": `${JSON.stringify(project, null, 2)}\n`,
    "members.json": `${JSON.stringify({
      schema_version: 1,
      members: [],
    })}\n`,
    "source/dialog.txt": "Source",
    "entries/file-1/chunk_0001.jsonl": "\n",
    "terms/terms.jsonl": "\n",
    "tasks/tasks.jsonl": "\n",
    "comments/": null,
    "logs/": null,
    "exports/": null,
    "changes/": null,
    ...overrides,
  };
  const blob = await createZip(content);
  const fileBytes = new Uint8Array(await blob.arrayBuffer()) as Uint8Array & {
    name: string;
  };

  fileBytes.name = "import.hproj";

  return fileBytes as unknown as File;
}

describe(".hproj project import", () => {
  it("writes and verifies a complete local project", async () => {
    const file = await createProjectPackageFile();
    const { root, controlledRoot } = createParentDirectory();

    const imported = await importProjectPackageToParentDirectory(
      file,
      controlledRoot,
    );

    expect(imported.folderName).toBe("Imported Project-project1");
    await expect(
      imported.root.getFileHandle("project.json"),
    ).resolves.toBeDefined();
    await expect(
      imported.root.getDirectoryHandle("source"),
    ).resolves.toBeDefined();
    await expect(root.getDirectoryHandle(imported.folderName)).resolves.toBeDefined();
  });

  it("rejects malformed JSONL before creating the target directory", async () => {
    const file = await createProjectPackageFile({
      "terms/terms.jsonl": "{invalid}\n",
    });
    const { root, controlledRoot } = createParentDirectory();

    await expect(
      importProjectPackageToParentDirectory(file, controlledRoot),
    ).rejects.toThrow("terms/terms.jsonl");
    await expect(Array.fromAsync(root.keys())).resolves.toEqual([]);
  });

  it("keeps an existing target directory unchanged", async () => {
    const file = await createProjectPackageFile();
    const folderName = "Imported Project-project1";
    const root = createMemoryProjectDirectory(
      {
        [`${folderName}/keep.txt`]: "keep",
      },
      "imports",
    );

    await expect(
      importProjectPackageToParentDirectory(file, root),
    ).rejects.toThrow("目标位置已存在");
    const targetRoot = await root.getDirectoryHandle(folderName);
    const keepFile = await targetRoot.getFileHandle("keep.txt");

    await expect((await keepFile.getFile()).text()).resolves.toBe("keep");
  });

  it("removes the target directory when a package write fails", async () => {
    const file = await createProjectPackageFile();
    const { root, controlledRoot } = createParentDirectory({
      failWriteAt: 2,
    });

    await expect(
      importProjectPackageToParentDirectory(file, controlledRoot),
    ).rejects.toBeInstanceOf(ProjectPackageImportError);
    await expect(Array.fromAsync(root.keys())).resolves.toEqual([]);
  });

  it("falls back to leaf-first cleanup when recursive deletion fails", async () => {
    const file = await createProjectPackageFile();
    const { root, controlledRoot } = createParentDirectory({
      failWriteAt: 2,
      topDeleteFailuresRemaining: 1,
    });

    try {
      await importProjectPackageToParentDirectory(file, controlledRoot);
      throw new Error("Expected import to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectPackageImportError);
      expect((error as ProjectPackageImportError).residualPaths).toEqual([]);
    }

    await expect(Array.fromAsync(root.keys())).resolves.toEqual([]);
  });

  it("reports exact residual paths when cleanup cannot remove a file", async () => {
    const file = await createProjectPackageFile();
    const folderName = "Imported Project-project1";
    const residualFile = `${folderName}/entries/file-1/chunk_0001.jsonl`;
    const { controlledRoot } = createParentDirectory({
      failWriteAt: 2,
      topDeleteFailuresRemaining: 10,
      failDeletePaths: new Set([residualFile]),
    });

    try {
      await importProjectPackageToParentDirectory(file, controlledRoot);
      throw new Error("Expected import to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectPackageImportError);
      expect((error as ProjectPackageImportError).residualPaths).toContain(
        residualFile,
      );
      expect((error as Error).message).toContain(residualFile);
    }
  });
});
