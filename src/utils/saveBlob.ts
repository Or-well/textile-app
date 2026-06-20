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

function startBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function saveBlobWithConfirmation(
  blob: Blob,
  fileName: string,
  fallbackConfirmation: string,
): Promise<boolean> {
  const saveFilePicker = (window as SaveFilePickerWindow).showSaveFilePicker;

  if (saveFilePicker) {
    try {
      const handle = await saveFilePicker({ suggestedName: fileName });
      const writable = await handle.createWritable();

      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return false;
      }

      throw error;
    }
  }

  startBrowserDownload(blob, fileName);
  return window.confirm(fallbackConfirmation);
}
