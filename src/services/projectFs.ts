import { parseJsonl, stringifyJsonl } from "../utils/jsonl";

export interface ProjectFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<ProjectWritableFileStream>;
}

export interface ProjectWritableFileStream {
  write(content: string): Promise<void>;
  close(): Promise<void>;
}

export interface ProjectDirectoryHandle {
  name: string;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ProjectFileHandle>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ProjectDirectoryHandle>;
  keys(): AsyncIterableIterator<string>;
}

type DirectoryPickerWindow = Window &
  typeof globalThis & {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<ProjectDirectoryHandle>;
  };

function splitProjectPath(path: string): string[] {
  return path
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter((part) => part && part !== ".");
}

function assertSafePath(path: string): string[] {
  const parts = splitProjectPath(path);

  if (parts.some((part) => part === "..")) {
    throw new Error("文件路径不正确，无法访问项目文件。");
  }

  return parts;
}

async function getDirectoryByPath(
  root: ProjectDirectoryHandle,
  path: string,
  create = false,
): Promise<ProjectDirectoryHandle> {
  const parts = assertSafePath(path);
  let current = root;

  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create });
  }

  return current;
}

async function getFileByPath(
  root: ProjectDirectoryHandle,
  path: string,
  create = false,
): Promise<ProjectFileHandle> {
  const parts = assertSafePath(path);
  const fileName = parts.pop();

  if (!fileName) {
    throw new Error("文件路径不正确，无法访问项目文件。");
  }

  const directory = await getDirectoryByPath(root, parts.join("/"), create);

  return directory.getFileHandle(fileName, { create });
}

export async function openProjectDirectory(): Promise<ProjectDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;

  if (!picker) {
    throw new Error("当前浏览器不支持打开本地文件夹。请使用 Chrome 或 Edge 浏览器。");
  }

  return picker({ mode: "readwrite" });
}

export async function readTextFile(
  root: ProjectDirectoryHandle,
  path: string,
): Promise<string> {
  const fileHandle = await getFileByPath(root, path);
  const file = await fileHandle.getFile();

  return file.text();
}

export async function writeTextFile(
  root: ProjectDirectoryHandle,
  path: string,
  content: string,
): Promise<void> {
  const fileHandle = await getFileByPath(root, path, true);
  const writable = await fileHandle.createWritable();

  await writable.write(content);
  await writable.close();
}

export async function readJson<T>(
  root: ProjectDirectoryHandle,
  path: string,
): Promise<T> {
  const text = await readTextFile(root, path);

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`项目文件 ${path} 格式有问题，无法读取。`);
  }
}

export async function writeJson<T>(
  root: ProjectDirectoryHandle,
  path: string,
  data: T,
): Promise<void> {
  await writeTextFile(root, path, `${JSON.stringify(data, null, 2)}\n`);
}

export async function readJsonl<T>(
  root: ProjectDirectoryHandle,
  path: string,
): Promise<T[]> {
  const text = await readTextFile(root, path);

  try {
    return parseJsonl<T>(text);
  } catch {
    throw new Error(`项目数据文件 ${path} 格式有问题，无法读取。`);
  }
}

export async function writeJsonl<T>(
  root: ProjectDirectoryHandle,
  path: string,
  rows: T[],
): Promise<void> {
  await writeTextFile(root, path, stringifyJsonl(rows));
}

export async function listFiles(
  root: ProjectDirectoryHandle,
  path: string,
): Promise<string[]> {
  const directory = await getDirectoryByPath(root, path);
  const names: string[] = [];

  for await (const name of directory.keys()) {
    names.push(name);
  }

  return names.sort((a, b) => a.localeCompare(b));
}

export async function ensureDirectory(
  root: ProjectDirectoryHandle,
  path: string,
): Promise<void> {
  await getDirectoryByPath(root, path, true);
}

export async function fileExists(
  root: ProjectDirectoryHandle,
  path: string,
): Promise<boolean> {
  const parts = assertSafePath(path);
  const name = parts.pop();

  if (!name) {
    return true;
  }

  try {
    const directory = await getDirectoryByPath(root, parts.join("/"));

    try {
      await directory.getFileHandle(name);
      return true;
    } catch {
      await directory.getDirectoryHandle(name);
      return true;
    }
  } catch {
    return false;
  }
}
