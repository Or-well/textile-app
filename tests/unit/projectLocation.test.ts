import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenedProject } from "../../src/services/project";
import {
  createMemoryProjectDirectory,
  createNativeProjectDirectory,
} from "../../src/services/projectFs";
import { openProjectLocation } from "../../src/services/projectLocation";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

function setTauriRuntime(enabled: boolean): void {
  if (enabled) {
    (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true;
    return;
  }

  delete (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri;
}

function createOpenedProject(
  root: OpenedProject["root"],
  storageKind: OpenedProject["storageKind"],
): OpenedProject {
  return {
    root,
    storage: {} as OpenedProject["storage"],
    config: { project_id: "project-1", name: "Demo" } as OpenedProject["config"],
    members: [],
    storageKind,
  };
}

describe("project location", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setTauriRuntime(false);
  });

  it("opens a Tauri native project folder through the native command", async () => {
    setTauriRuntime(true);
    const project = createOpenedProject(
      createNativeProjectDirectory("C:\\Projects\\Demo", "Demo"),
      "native-folder",
    );

    await openProjectLocation(project);

    expect(invokeMock).toHaveBeenCalledWith("open_project_directory_path", {
      rootPath: "C:\\Projects\\Demo",
    });
  });

  it("opens an imported child project instead of its selected parent folder", async () => {
    setTauriRuntime(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "native_project_entry_status") {
        return { exists: true, kind: "directory" };
      }

      if (command === "open_project_directory_path") {
        return undefined;
      }

      throw new Error(`Unexpected command: ${command}`);
    });
    const importRoot = createNativeProjectDirectory("C:\\Imports", "Imports");
    const projectRoot = await importRoot.getDirectoryHandle("Demo-project1");
    const project = createOpenedProject(projectRoot, "native-folder");

    await openProjectLocation(project);

    expect(invokeMock).toHaveBeenCalledWith("open_project_directory_path", {
      rootPath: "C:\\Imports\\Demo-project1",
    });
  });

  it("rejects packed project files because they have no system folder", async () => {
    const project = createOpenedProject(
      createMemoryProjectDirectory({}, "demo.hproj"),
      "packed",
    );

    await expect(openProjectLocation(project)).rejects.toThrow(
      "没有可直接打开的本地项目文件夹",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects Web/PWA projects without a native path", async () => {
    const project = createOpenedProject(
      { name: "Demo" } as OpenedProject["root"],
      "folder",
    );

    await expect(openProjectLocation(project)).rejects.toThrow(
      "当前 Web/PWA 环境无法获取项目系统路径",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects old desktop records that do not contain a native path", async () => {
    setTauriRuntime(true);
    const project = createOpenedProject(
      { name: "Demo", storageKind: "folder" } as OpenedProject["root"],
      "folder",
    );

    await expect(openProjectLocation(project)).rejects.toThrow(
      "当前项目没有记录系统路径",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects native paths when the runtime cannot open the system file manager", async () => {
    const project = createOpenedProject(
      createNativeProjectDirectory("C:\\Projects\\Demo", "Demo"),
      "native-folder",
    );

    await expect(openProjectLocation(project)).rejects.toThrow(
      "当前运行环境不能打开系统文件管理器",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
