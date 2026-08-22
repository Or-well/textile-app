import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "../../src/model/types";
import {
  deleteCurrentProjectSource,
  scanProjectDeletion,
} from "../../src/services/projectDeletion";
import {
  createMemoryProjectDirectory,
  createNativeProjectDirectory,
  type ProjectDirectoryHandle,
} from "../../src/services/projectFs";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const project = {
  project_id: "project-1",
  name: "Demo",
} as ProjectConfig;

function setTauriRuntime(enabled: boolean): void {
  if (enabled) {
    (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true;
    return;
  }

  delete (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri;
}

function createProjectRoot(
  metadata: Partial<Pick<ProjectDirectoryHandle, "storageKind" | "nativePath">> = {},
): ProjectDirectoryHandle {
  const root = createMemoryProjectDirectory(
    {
      "project.json": JSON.stringify({ project_id: project.project_id }),
      "members.json": JSON.stringify({ members: [] }),
      "entries/000001.jsonl": "{}\n",
      "notes/readme.txt": "local note",
    },
    "Demo",
    ["entries", "notes"],
  );

  for (const [key, value] of Object.entries(metadata)) {
    Object.defineProperty(root, key, {
      configurable: true,
      value,
    });
  }

  return root;
}

describe("project deletion", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setTauriRuntime(false);
  });

  it("scans a native project folder as deletable in the desktop runtime", async () => {
    setTauriRuntime(true);
    const root = createProjectRoot({
      storageKind: "native-folder",
      nativePath: "\\\\?\\C:\\Projects\\Demo",
    });

    const scan = await scanProjectDeletion(root, project, "native_project_folder");

    expect(scan).toMatchObject({
      canDelete: true,
      mode: "native_project_folder",
      deleteTarget: "C:\\Projects\\Demo",
      fileCount: 4,
      directoryCount: 2,
    });
    expect(scan.entries).toContain("删除本地项目文件夹及其中所有文件");
  });

  it("reports Web/PWA projects as not deletable through native folder deletion", async () => {
    const root = createProjectRoot({ storageKind: "folder" });

    const scan = await scanProjectDeletion(root, project, "native_project_folder");

    expect(scan.canDelete).toBe(false);
    expect(scan.entries.join("\n")).toContain("当前项目没有可删除的 Tauri native 路径");
  });

  it("reports packed .hproj projects as not deletable through native folder deletion", async () => {
    setTauriRuntime(true);
    const root = createProjectRoot({
      storageKind: "packed",
      nativePath: "C:\\Projects\\Demo",
    });

    const scan = await scanProjectDeletion(root, project, "native_project_folder");

    expect(scan.canDelete).toBe(false);
    expect(scan.warnings.join("\n")).toContain("只有 Tauri 桌面版");
  });

  it("removes only local records in local-record mode and never calls native deletion", async () => {
    const root = createProjectRoot({
      storageKind: "native-folder",
      nativePath: "C:\\Projects\\Demo",
    });

    const result = await deleteCurrentProjectSource(
      root,
      project,
      null,
      "local_record_only",
    );

    expect(result).toMatchObject({
      diskFilesDeleted: false,
      rootFolderDeleted: false,
      deletedEntries: [],
      failedEntries: [],
    });
    expect(result.message).toContain("不会自动删除磁盘上的项目文件");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("calls native project-folder deletion for native path projects", async () => {
    setTauriRuntime(true);
    invokeMock.mockResolvedValue({
      deletedPath: "\\\\?\\C:\\Projects\\Demo",
      fileCount: 4,
      directoryCount: 2,
    });
    const root = createProjectRoot({
      storageKind: "native-folder",
      nativePath: "\\\\?\\C:\\Projects\\Demo",
    });

    const result = await deleteCurrentProjectSource(
      root,
      project,
      null,
      "native_project_folder",
    );

    expect(invokeMock).toHaveBeenCalledWith("delete_project_directory_path", {
      rootPath: "\\\\?\\C:\\Projects\\Demo",
      projectId: "project-1",
    });
    expect(result).toMatchObject({
      diskFilesDeleted: true,
      rootFolderDeleted: true,
      deletedEntries: ["C:\\Projects\\Demo"],
      failedEntries: [],
    });
    expect(result.message).toContain("4 个文件、2 个目录");
  });

  it("deletes an imported child project without targeting its parent folder", async () => {
    setTauriRuntime(true);
    invokeMock.mockImplementation(
      async (command: string, args: { relativePath?: string }) => {
        if (command === "native_project_entry_status") {
          return {
            exists: true,
            kind:
              args.relativePath === "Demo-project1" ||
              args.relativePath?.endsWith("/entries")
                ? "directory"
                : "file",
          };
        }

        if (command === "read_project_text_file") {
          return JSON.stringify({ project_id: project.project_id });
        }

        if (command === "delete_project_directory_path") {
          return {
            deletedPath: "C:\\Imports\\Demo-project1",
            fileCount: 3,
            directoryCount: 1,
          };
        }

        throw new Error(`Unexpected command: ${command}`);
      },
    );
    const importRoot = createNativeProjectDirectory("C:\\Imports", "Imports");
    const projectRoot = await importRoot.getDirectoryHandle("Demo-project1");

    await deleteCurrentProjectSource(
      projectRoot,
      project,
      null,
      "native_project_folder",
    );

    expect(invokeMock).toHaveBeenCalledWith("delete_project_directory_path", {
      rootPath: "C:\\Imports\\Demo-project1",
      projectId: "project-1",
    });
  });

  it("does not pretend native deletion succeeded when the native command fails", async () => {
    setTauriRuntime(true);
    invokeMock.mockRejectedValue(new Error("access denied"));
    const root = createProjectRoot({
      storageKind: "native-folder",
      nativePath: "C:\\Projects\\Demo",
    });

    await expect(
      deleteCurrentProjectSource(root, project, null, "native_project_folder"),
    ).rejects.toThrow("access denied");
  });

  it("blocks deletion when the opened source does not match the current project", async () => {
    const root = createMemoryProjectDirectory(
      {
        "project.json": JSON.stringify({ project_id: "other-project" }),
        "members.json": JSON.stringify({ members: [] }),
        "entries/000001.jsonl": "{}\n",
      },
      "Other",
      ["entries"],
    );

    await expect(
      scanProjectDeletion(root, project, "local_record_only"),
    ).rejects.toThrow("项目来源与正在打开的项目不一致");
  });
});
