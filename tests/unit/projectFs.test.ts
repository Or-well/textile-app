import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createNativeProjectDirectory,
  deleteEntry,
  ensureDirectory,
  fileExists,
  listFiles,
  readTextFile,
  writeTextFile,
} from "../../src/services/projectFs";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("native project directory adapter", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("exposes native folder metadata without changing the shared handle interface", () => {
    const root = createNativeProjectDirectory("C:\\Projects\\Demo");

    expect(root.name).toBe("Demo");
    expect(root.storageKind).toBe("native-folder");
    expect(root.nativePath).toBe("C:\\Projects\\Demo");
  });

  it("exposes a child handle's full native path while keeping file access relative to the selected root", async () => {
    invokeMock.mockImplementation(
      async (command: string, args: { relativePath?: string }) => {
        if (command === "ensure_project_directory") {
          return undefined;
        }

        if (command === "read_project_text_file") {
          return "project";
        }

        throw new Error(`Unexpected command: ${command}`);
      },
    );
    const root = createNativeProjectDirectory("C:\\Imports", "Imports");
    const projectRoot = await root.getDirectoryHandle("Demo-project1", {
      create: true,
    });

    expect(projectRoot.name).toBe("Demo-project1");
    expect(projectRoot.nativePath).toBe("C:\\Imports\\Demo-project1");
    await expect(readTextFile(projectRoot, "project.json")).resolves.toBe(
      "project",
    );
    expect(invokeMock).toHaveBeenCalledWith("ensure_project_directory", {
      rootPath: "C:\\Imports",
      relativePath: "Demo-project1",
    });
    expect(invokeMock).toHaveBeenCalledWith("read_project_text_file", {
      rootPath: "C:\\Imports",
      relativePath: "Demo-project1/project.json",
    });
  });

  it("reads project files through Tauri using relative project paths", async () => {
    invokeMock.mockImplementation(
      async (command: string, args: { relativePath?: string }) => {
        if (command === "read_project_text_file") {
          return "hello";
        }

        throw new Error(`Unexpected command: ${command}`);
      },
    );
    const root = createNativeProjectDirectory("C:\\Projects\\Demo", "Demo");

    const text = await readTextFile(root, "entries/000001.jsonl");

    expect(text).toBe("hello");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("read_project_text_file", {
      rootPath: "C:\\Projects\\Demo",
      relativePath: "entries/000001.jsonl",
    });
  });

  it("writes project files through Tauri using relative project paths", async () => {
    invokeMock.mockResolvedValue(undefined);
    const root = createNativeProjectDirectory("C:\\Projects\\Demo", "Demo");

    await writeTextFile(root, "entries/000001.jsonl", "updated");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("write_project_text_file", {
      rootPath: "C:\\Projects\\Demo",
      relativePath: "entries/000001.jsonl",
      content: "updated",
    });
  });

  it("lists native project directories through Tauri", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_project_directory") {
        return ["000002.jsonl", "000001.jsonl"];
      }

      throw new Error(`Unexpected command: ${command}`);
    });
    const root = createNativeProjectDirectory("C:\\Projects\\Demo", "Demo");

    await expect(listFiles(root, "entries")).resolves.toEqual([
      "000001.jsonl",
      "000002.jsonl",
    ]);
    expect(invokeMock).toHaveBeenCalledWith("list_project_directory", {
      rootPath: "C:\\Projects\\Demo",
      relativePath: "entries",
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("creates and deletes native project entries through Tauri", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "native_project_entry_status") {
        return { exists: true, kind: "directory" };
      }

      return undefined;
    });
    const root = createNativeProjectDirectory("C:\\Projects\\Demo", "Demo");

    await ensureDirectory(root, "exports/review");
    await deleteEntry(root, "entries/old.jsonl", { recursive: true });

    expect(invokeMock).toHaveBeenCalledWith("ensure_project_directory", {
      rootPath: "C:\\Projects\\Demo",
      relativePath: "exports/review",
    });
    expect(invokeMock).toHaveBeenCalledWith("delete_project_entry", {
      rootPath: "C:\\Projects\\Demo",
      relativePath: "entries/old.jsonl",
      recursive: true,
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("checks a nested native path with one status request", async () => {
    invokeMock.mockResolvedValue({ exists: true, kind: "file" });
    const root = createNativeProjectDirectory("C:\\Projects\\Demo", "Demo");

    await expect(fileExists(root, "entries/000001.jsonl")).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("native_project_entry_status", {
      rootPath: "C:\\Projects\\Demo",
      relativePath: "entries/000001.jsonl",
    });
  });
});
