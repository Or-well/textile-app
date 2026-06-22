import { isTauriRuntime } from "./tauriRuntime";

interface WritableFileHandle {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
  }) => Promise<WritableFileHandle>;
  showDirectoryPicker?: () => Promise<{
    getFileHandle(
      name: string,
      options: { create: boolean },
    ): Promise<WritableFileHandle>;
  }>;
}

export type SaveGeneratedFileResult =
  | {
      saved: true;
      method: "file-picker" | "directory-picker" | "tauri";
      fileName: string;
      path?: string;
    }
  | {
      saved: false;
      method: "file-picker" | "directory-picker" | "tauri" | "unavailable";
      fileName: string;
      reason: string;
    };

export type PreparedGeneratedFileSave =
  | {
      prepared: true;
      method: "file-picker";
      fileName: string;
      handle: WritableFileHandle;
    }
  | {
      prepared: true;
      method: "tauri";
      saveId: string;
      fileName: string;
      path: string;
    };

export type PrepareGeneratedFileSaveResult =
  | PreparedGeneratedFileSave
  | {
      prepared: false;
      method: "file-picker" | "tauri" | "unavailable";
      fileName: string;
      reason: string;
    };

export interface GeneratedFileFactory {
  fileName: string;
  createBlob: () => Blob | Promise<Blob>;
}

export type SaveGeneratedFilesResult =
  | {
      saved: true;
      method: "directory-picker" | "tauri";
      files: Array<{ fileName: string; path?: string }>;
    }
  | {
      saved: false;
      method: "directory-picker" | "tauri" | "unavailable";
      fileName?: string;
      reason: string;
      files: Array<{ fileName: string; path?: string }>;
    };

type TauriGeneratedFileSaveResult =
  | { saved: true; fileName: string; path: string }
  | { saved: false; fileName: string; reason: string };

type TauriGeneratedFileSaveSessionResult =
  | { saved: true; saveId: string; fileName: string; path: string }
  | { saved: false; saveId?: undefined; fileName: string; reason: string };

const RELIABLE_SAVE_UNAVAILABLE_MESSAGE =
  "当前运行环境不能确认文件已保存。为避免项目状态和导出文件不一致，请使用桌面版可靠保存能力或支持保存对话框的浏览器。";
const SAVE_CANCELED_MESSAGE = "文件保存已取消。";
const TAURI_SAVE_CHUNK_SIZE = 1024 * 1024;

export async function saveGeneratedFile(
  blob: Blob,
  fileName: string,
): Promise<SaveGeneratedFileResult> {
  return saveGeneratedFileFromFactory(fileName, () => blob);
}

export async function saveGeneratedFileFromFactory(
  fileName: string,
  createBlob: () => Blob | Promise<Blob>,
): Promise<SaveGeneratedFileResult> {
  const prepared = await prepareGeneratedFileSave(fileName);

  if (!prepared.prepared) {
    return {
      saved: false,
      method: prepared.method,
      fileName: prepared.fileName,
      reason: prepared.reason,
    };
  }

  try {
    return await writePreparedGeneratedFile(prepared, await createBlob());
  } catch (error) {
    await abortPreparedGeneratedFileSave(prepared);
    throw error;
  }
}

export async function prepareGeneratedFileSave(
  fileName: string,
): Promise<PrepareGeneratedFileSaveResult> {
  if (isTauriRuntime()) {
    return prepareGeneratedFileSaveWithTauri(fileName);
  }

  const saveFilePicker =
    typeof window === "undefined"
      ? undefined
      : (window as SaveFilePickerWindow).showSaveFilePicker;

  if (!saveFilePicker) {
    return {
      prepared: false,
      method: "unavailable",
      fileName,
      reason: RELIABLE_SAVE_UNAVAILABLE_MESSAGE,
    };
  }

  try {
    return {
      prepared: true,
      method: "file-picker",
      fileName,
      handle: await saveFilePicker({ suggestedName: fileName }),
    };
  } catch (error) {
    if (isUserCanceledSave(error)) {
      return {
        prepared: false,
        method: "file-picker",
        fileName,
        reason: SAVE_CANCELED_MESSAGE,
      };
    }

    if (isReliableSaveUnavailableError(error)) {
      return {
        prepared: false,
        method: "unavailable",
        fileName,
        reason: RELIABLE_SAVE_UNAVAILABLE_MESSAGE,
      };
    }

    throw error;
  }
}

export async function writePreparedGeneratedFile(
  prepared: PreparedGeneratedFileSave,
  blob: Blob,
): Promise<SaveGeneratedFileResult> {
  if (prepared.method === "tauri") {
    return writePreparedGeneratedFileWithTauri(prepared, blob);
  }

  const writable = await prepared.handle.createWritable();

  await writable.write(blob);
  await writable.close();

  return {
    saved: true,
    method: "file-picker",
    fileName: prepared.fileName,
  };
}

export async function abortPreparedGeneratedFileSave(
  prepared: PreparedGeneratedFileSave,
): Promise<void> {
  if (prepared.method !== "tauri") {
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");

  await Promise.resolve(
    invoke("abort_generated_file_save", {
      saveId: prepared.saveId,
    }),
  ).catch(() => undefined);
}

export async function saveGeneratedFilesFromFactories(
  files: GeneratedFileFactory[],
): Promise<SaveGeneratedFilesResult> {
  if (files.length === 0) {
    return {
      saved: true,
      method: "directory-picker",
      files: [],
    };
  }

  if (isTauriRuntime()) {
    return saveGeneratedFilesWithTauri(files);
  }

  const showDirectoryPicker =
    typeof window === "undefined"
      ? undefined
      : (window as SaveFilePickerWindow).showDirectoryPicker;

  if (!showDirectoryPicker) {
    return {
      saved: false,
      method: "unavailable",
      reason: RELIABLE_SAVE_UNAVAILABLE_MESSAGE,
      files: [],
    };
  }

  try {
    const directory = await showDirectoryPicker();
    const savedFiles: Array<{ fileName: string }> = [];

    for (const file of files) {
      const handle = await directory.getFileHandle(file.fileName, {
        create: true,
      });
      const writable = await handle.createWritable();

      await writable.write(await file.createBlob());
      await writable.close();
      savedFiles.push({ fileName: file.fileName });
    }

    return {
      saved: true,
      method: "directory-picker",
      files: savedFiles,
    };
  } catch (error) {
    if (isUserCanceledSave(error)) {
      return {
        saved: false,
        method: "directory-picker",
        reason: SAVE_CANCELED_MESSAGE,
        files: [],
      };
    }

    if (isReliableSaveUnavailableError(error)) {
      return {
        saved: false,
        method: "unavailable",
        reason: RELIABLE_SAVE_UNAVAILABLE_MESSAGE,
        files: [],
      };
    }

    throw error;
  }
}

async function prepareGeneratedFileSaveWithTauri(
  fileName: string,
): Promise<PrepareGeneratedFileSaveResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  const session = await invoke<TauriGeneratedFileSaveSessionResult>(
    "begin_generated_file_save",
    { fileName },
  );

  if (!session.saved) {
    return {
      prepared: false,
      method: "tauri",
      fileName: session.fileName,
      reason: session.reason || SAVE_CANCELED_MESSAGE,
    };
  }

  return {
    prepared: true,
    method: "tauri",
    saveId: session.saveId,
    fileName: session.fileName,
    path: session.path,
  };
}

async function writePreparedGeneratedFileWithTauri(
  prepared: Extract<PreparedGeneratedFileSave, { method: "tauri" }>,
  blob: Blob,
): Promise<SaveGeneratedFileResult> {
  const { invoke } = await import("@tauri-apps/api/core");

  try {
    for (let offset = 0; offset < blob.size; offset += TAURI_SAVE_CHUNK_SIZE) {
      const chunk = blob.slice(offset, offset + TAURI_SAVE_CHUNK_SIZE);
      const bytes = Array.from(new Uint8Array(await chunk.arrayBuffer()));

      await invoke("append_generated_file_chunk", {
        saveId: prepared.saveId,
        bytes,
      });
    }

    const result = await invoke<TauriGeneratedFileSaveResult>(
      "finish_generated_file_save",
      { saveId: prepared.saveId },
    );

    if (result.saved) {
      return {
        saved: true,
        method: "tauri",
        fileName: result.fileName,
        path: result.path,
      };
    }

    return {
      saved: false,
      method: "tauri",
      fileName: result.fileName,
      reason: result.reason || SAVE_CANCELED_MESSAGE,
    };
  } catch (error) {
    await abortPreparedGeneratedFileSave(prepared);
    throw error;
  }
}

async function saveGeneratedFilesWithTauri(
  files: GeneratedFileFactory[],
): Promise<SaveGeneratedFilesResult> {
  const preparedFiles: PreparedGeneratedFileSave[] = [];
  const savedFiles: Array<{ fileName: string; path?: string }> = [];

  for (const file of files) {
    const prepared = await prepareGeneratedFileSaveWithTauri(file.fileName);

    if (!prepared.prepared) {
      await Promise.all(preparedFiles.map(abortPreparedGeneratedFileSave));
      return {
        saved: false,
        method: "tauri",
        fileName: prepared.fileName,
        reason: prepared.reason,
        files: savedFiles,
      };
    }

    preparedFiles.push(prepared);
  }

  try {
    for (let index = 0; index < files.length; index += 1) {
      const result = await writePreparedGeneratedFile(
        preparedFiles[index],
        await files[index].createBlob(),
      );

      if (!result.saved) {
        await Promise.all(
          preparedFiles.slice(index).map(abortPreparedGeneratedFileSave),
        );

        return {
          saved: false,
          method: "tauri",
          fileName: result.fileName,
          reason: result.reason,
          files: savedFiles,
        };
      }

      savedFiles.push({
        fileName: result.fileName,
        path: result.path,
      });
    }

    return {
      saved: true,
      method: "tauri",
      files: savedFiles,
    };
  } catch (error) {
    await Promise.all(preparedFiles.map(abortPreparedGeneratedFileSave));
    throw error;
  }
}

function isUserCanceledSave(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isReliableSaveUnavailableError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "SecurityError";
}
