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
}

export type SaveBlobResult =
  | { saved: true; method: "file-picker" | "browser-download"; fileName: string }
  | { saved: false; method: "file-picker"; fileName: string };

export function startBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function saveBlob(
  blob: Blob,
  fileName: string,
): Promise<SaveBlobResult> {
  const saveFilePicker = (window as SaveFilePickerWindow).showSaveFilePicker;

  if (saveFilePicker) {
    try {
      const handle = await saveFilePicker({ suggestedName: fileName });
      const writable = await handle.createWritable();

      await writable.write(blob);
      await writable.close();
      return { saved: true, method: "file-picker", fileName };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { saved: false, method: "file-picker", fileName };
      }

      throw error;
    }
  }

  startBrowserDownload(blob, fileName);
  return { saved: true, method: "browser-download", fileName };
}

export async function saveBlobWithConfirmation(
  blob: Blob,
  fileName: string,
  fallbackConfirmation: string,
): Promise<boolean> {
  const result = await saveBlob(blob, fileName);

  if (!result.saved) {
    return false;
  }

  return result.method === "file-picker" || window.confirm(fallbackConfirmation);
}
