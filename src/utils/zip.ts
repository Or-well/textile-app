import JSZip from "jszip";

export type ZipContent = Record<string, string | Blob | Uint8Array | null>;

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
