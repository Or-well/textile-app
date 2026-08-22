import { afterEach, describe, expect, it } from "vitest";
import { setCurrentUser } from "../../src/services/permissions";
import {
  createMemoryProjectDirectory,
  type ProjectDirectoryHandle,
  type ProjectFileHandle,
} from "../../src/services/projectFs";
import { exportProjectPackage } from "../../src/services/projectPackage";
import { readZip } from "../../src/utils/zip";
import { createMember, createProject } from "./factories";

function createProjectRoot(): ProjectDirectoryHandle {
  const project = createProject();

  return createMemoryProjectDirectory(
    {
      "project.json": `${JSON.stringify(project, null, 2)}\n`,
      "members.json": `${JSON.stringify({ schema_version: 1, members: [] })}\n`,
      "source/dialog.txt": "Source",
      "entries/file-1/chunk_0001.jsonl": "\n",
      "terms/terms.jsonl": "\n",
      "tasks/tasks.jsonl": "\n",
      "logs/events/chunk_000001.jsonl": '{"id":"event-1"}\n',
      "logs/events.jsonl": "\n",
      "exports/old-release.zip": new Uint8Array([1, 2, 3]),
      "changes/workspace/baseline.json": "{}\n",
      "changes/transitions/transition.zip": new Uint8Array([4, 5, 6]),
    },
    "project",
  );
}

class UnreadableFileDirectory implements ProjectDirectoryHandle {
  constructor(
    private readonly delegate: ProjectDirectoryHandle,
    private readonly path = "",
  ) {}

  get name(): string {
    return this.delegate.name;
  }

  get storageKind() {
    return this.delegate.storageKind;
  }

  getFileHandle(name: string, options?: { create?: boolean }): Promise<ProjectFileHandle> {
    const path = [this.path, name].filter(Boolean).join("/");

    if (path === "source/dialog.txt") {
      return Promise.reject(new Error("Injected read failure."));
    }

    return this.delegate.getFileHandle(name, options);
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ProjectDirectoryHandle> {
    const path = [this.path, name].filter(Boolean).join("/");

    return new UnreadableFileDirectory(
      await this.delegate.getDirectoryHandle(name, options),
      path,
    );
  }

  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.delegate.removeEntry) {
      return Promise.reject(new Error("Delete is not supported."));
    }

    return this.delegate.removeEntry(name, options);
  }

  keys(): AsyncIterableIterator<string> {
    return this.delegate.keys();
  }
}

describe(".hproj project export", () => {
  afterEach(() => {
    setCurrentUser(null);
  });

  it("excludes generated exports and keeps collaboration transitions", async () => {
    const root = createProjectRoot();
    setCurrentUser(createMember(["owner"]));

    const result = await exportProjectPackage(root);
    const files = await readZip(await result.blob.arrayBuffer());

    expect(Object.keys(files).some((path) => path.startsWith("exports/"))).toBe(false);
    expect(files["changes/workspace/baseline.json"]).toBe("{}\n");
    expect(files["changes/transitions/transition.zip"]).toBeDefined();
    expect(files["logs/events/chunk_000001.jsonl"]).toBe(
      '{"id":"event-1"}\n',
    );
  });

  it("rejects nested project backups", async () => {
    const root = createProjectRoot();
    const source = await root.getDirectoryHandle("source");
    const nested = await source.getFileHandle("old-backup.hproj", { create: true });
    const writable = await nested.createWritable();
    await writable.write(new Uint8Array([1, 2, 3]));
    await writable.close();
    setCurrentUser(createMember(["owner"]));

    await expect(exportProjectPackage(root)).rejects.toThrow(
      "项目目录中包含嵌套备份“source/old-backup.hproj”",
    );
  });

  it("reports the path of an unreadable project file", async () => {
    const root = new UnreadableFileDirectory(createProjectRoot());
    setCurrentUser(createMember(["owner"]));

    await expect(exportProjectPackage(root)).rejects.toThrow(
      "项目路径“source/dialog.txt”无法读取",
    );
  });
});
