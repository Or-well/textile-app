import JSZip from "jszip";

export type ZipContent = Record<string, string | Blob | Uint8Array | null>;

export interface ZipEntries {
  files: Record<string, Uint8Array>;
  directories: string[];
}

export async function createZip(files: ZipContent): Promise<Blob> {
  const zip = new JSZip();

  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      zip.folder(path.replace(/\/$/, ""));
      continue;
    }

    zip.file(path, content);
  }

  return zip.generateAsync({ type: "blob" });
}

export async function readZip(file: Blob): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(file);
  const entries: Record<string, string> = {};

  for (const [path, entry] of Object.entries(zip.files)) {
    if (!entry.dir) {
      entries[path] = await entry.async("string");
    }
  }

  return entries;
}

export async function readZipBytes(file: Blob): Promise<Record<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(file);
  const entries: Record<string, Uint8Array> = {};

  for (const [path, entry] of Object.entries(zip.files)) {
    if (!entry.dir) {
      entries[path] = await entry.async("uint8array");
    }
  }

  return entries;
}

export async function readZipEntries(file: Blob): Promise<ZipEntries> {
  const zip = await JSZip.loadAsync(file);
  const files: Record<string, Uint8Array> = {};
  const directories: string[] = [];

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) {
      directories.push(path);
    } else {
      files[path] = await entry.async("uint8array");
    }
  }

  return { files, directories };
}
