import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveGeneratedFile,
  saveGeneratedFileFromFactory,
  saveGeneratedFilesFromFactories,
} from "../../src/utils/saveBlob";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

function setWindowMethod(name: string, value: unknown): void {
  const testWindow =
    (globalThis as typeof globalThis & { window?: Record<string, unknown> })
      .window ?? {};

  (globalThis as typeof globalThis & { window?: Record<string, unknown> }).window =
    testWindow;

  Object.defineProperty(testWindow, name, {
    configurable: true,
    value,
  });
}

describe("saveGeneratedFile", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    delete (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri;
    setWindowMethod("showSaveFilePicker", undefined);
    setWindowMethod("showDirectoryPicker", undefined);
  });

  it("does not fall back to browser downloads when reliable saving is unavailable", async () => {
    const result = await saveGeneratedFile(new Blob(["x"]), "sample.txt");

    expect(result).toMatchObject({
      saved: false,
      method: "unavailable",
      fileName: "sample.txt",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("opens the file picker before creating a generated blob", async () => {
    const write = vi.fn();
    const close = vi.fn();
    const createBlob = vi.fn(() => new Blob(["x"]));
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({ write, close }),
    }));

    setWindowMethod("showSaveFilePicker", showSaveFilePicker);

    const result = await saveGeneratedFileFromFactory("sample.txt", createBlob);

    expect(result).toEqual({
      saved: true,
      method: "file-picker",
      fileName: "sample.txt",
    });
    expect(showSaveFilePicker.mock.invocationCallOrder[0]).toBeLessThan(
      createBlob.mock.invocationCallOrder[0],
    );
    expect(write).toHaveBeenCalledWith(expect.any(Blob));
    expect(close).toHaveBeenCalled();
  });

  it("reports missing browser activation as unavailable instead of throwing", async () => {
    setWindowMethod(
      "showSaveFilePicker",
      vi.fn(async () => {
        throw new DOMException("activation required", "SecurityError");
      }),
    );

    const result = await saveGeneratedFileFromFactory(
      "sample.txt",
      () => new Blob(["x"]),
    );

    expect(result).toMatchObject({
      saved: false,
      method: "unavailable",
      fileName: "sample.txt",
    });
  });

  it("uses the Tauri save command in the desktop runtime", async () => {
    (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true;
    invokeMock
      .mockResolvedValueOnce({
        saved: true,
        saveId: "save-1",
        fileName: "sample.txt",
        path: "C:\\exports\\sample.txt",
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        saved: true,
        fileName: "sample.txt",
        path: "C:\\exports\\sample.txt",
      });

    const result = await saveGeneratedFile(new Blob(["x"]), "sample.txt");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "begin_generated_file_save", {
      fileName: "sample.txt",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "append_generated_file_chunk", {
      saveId: "save-1",
      bytes: [120],
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "finish_generated_file_save", {
      saveId: "save-1",
    });
    expect(result).toEqual({
      saved: true,
      method: "tauri",
      fileName: "sample.txt",
      path: "C:\\exports\\sample.txt",
    });
  });

  it("reports Tauri save cancellation without claiming success", async () => {
    (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true;
    invokeMock.mockResolvedValue({
      saved: false,
      fileName: "sample.txt",
      reason: "文件保存已取消。",
    });

    const result = await saveGeneratedFile(new Blob(["x"]), "sample.txt");

    expect(result).toEqual({
      saved: false,
      method: "tauri",
      fileName: "sample.txt",
      reason: "文件保存已取消。",
    });
  });

  it("aborts an active Tauri save session when chunk writing fails", async () => {
    (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true;
    invokeMock
      .mockResolvedValueOnce({
        saved: true,
        saveId: "save-1",
        fileName: "sample.txt",
        path: "C:\\exports\\sample.txt",
      })
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce(undefined);

    await expect(saveGeneratedFile(new Blob(["x"]), "sample.txt")).rejects.toThrow(
      "write failed",
    );
    expect(invokeMock).toHaveBeenLastCalledWith("abort_generated_file_save", {
      saveId: "save-1",
    });
  });

  it("saves related browser files through a single directory picker", async () => {
    const writes: string[] = [];
    const showDirectoryPicker = vi.fn(async () => ({
      getFileHandle: async (name: string) => ({
        createWritable: async () => ({
          write: async () => {
            writes.push(name);
          },
          close: async () => undefined,
        }),
      }),
    }));

    setWindowMethod("showDirectoryPicker", showDirectoryPicker);

    const result = await saveGeneratedFilesFromFactories([
      { fileName: "member-key.json", createBlob: () => new Blob(["key"]) },
      { fileName: "member-public-key.json", createBlob: () => new Blob(["pub"]) },
    ]);

    expect(showDirectoryPicker).toHaveBeenCalledTimes(1);
    expect(writes).toEqual(["member-key.json", "member-public-key.json"]);
    expect(result).toEqual({
      saved: true,
      method: "directory-picker",
      files: [
        { fileName: "member-key.json" },
        { fileName: "member-public-key.json" },
      ],
    });
  });
});
