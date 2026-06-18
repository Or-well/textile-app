import { parseJsonl, stringifyJsonl } from "../utils/jsonl";

export type ProjectStorageKind = "folder" | "packed";

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
  storageKind?: ProjectStorageKind;
  sourceFileName?: string;
  isDirty?: () => boolean;
  markClean?: () => void;
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

type PackedProjectContent = Record<string, string | Uint8Array>;

interface PackedProjectState {
  name: string;
  files: Map<string, Uint8Array>;
  directories: Set<string>;
  dirty: boolean;
}

const textEncoder = new TextEncoder();

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

function normalizeProjectPath(path: string): string {
  return assertSafePath(path).join("/");
}

function joinProjectPath(basePath: string, name: string): string {
  return normalizeProjectPath([basePath, name].filter(Boolean).join("/"));
}

function getParentPath(path: string): string {
  const parts = assertSafePath(path);

  parts.pop();

  return parts.join("/");
}

function getFileName(path: string): string {
  const parts = assertSafePath(path);

  return parts[parts.length - 1] ?? "";
}

function ensurePackedDirectory(state: PackedProjectState, path: string): void {
  const normalizedPath = normalizeProjectPath(path);
  const parts = normalizedPath ? normalizedPath.split("/") : [];

  state.directories.add("");

  for (let index = 1; index <= parts.length; index += 1) {
    state.directories.add(parts.slice(0, index).join("/"));
  }
}

function rememberPackedFilePath(state: PackedProjectState, path: string): void {
  ensurePackedDirectory(state, getParentPath(path));
}

function packedDirectoryExists(
  state: PackedProjectState,
  path: string,
): boolean {
  const normalizedPath = normalizeProjectPath(path);
  const prefix = normalizedPath ? `${normalizedPath}/` : "";

  return (
    state.directories.has(normalizedPath) ||
    Array.from(state.files.keys()).some((filePath) => filePath.startsWith(prefix))
  );
}

function notifyPackedProjectWrite(state: PackedProjectState): void {
  state.dirty = true;

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("hproj-project-dirty", {
        detail: { name: state.name },
      }),
    );
  }
}

class PackedProjectWritableFileStream implements ProjectWritableFileStream {
  private content = "";
  private readonly state: PackedProjectState;
  private readonly path: string;

  constructor(
    state: PackedProjectState,
    path: string,
  ) {
    this.state = state;
    this.path = path;
  }

  async write(content: string): Promise<void> {
    this.content = content;
  }

  async close(): Promise<void> {
    this.state.files.set(this.path, textEncoder.encode(this.content));
    rememberPackedFilePath(this.state, this.path);
    notifyPackedProjectWrite(this.state);
  }
}

class PackedProjectFileHandle implements ProjectFileHandle {
  private readonly state: PackedProjectState;
  private readonly path: string;

  constructor(
    state: PackedProjectState,
    path: string,
  ) {
    this.state = state;
    this.path = path;
  }

  async getFile(): Promise<File> {
    const content = this.state.files.get(this.path);

    if (!content) {
      throw new Error("项目文件不存在。");
    }

    const buffer = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;

    return new File([buffer], getFileName(this.path), {
      type: "text/plain;charset=utf-8",
    });
  }

  async createWritable(): Promise<ProjectWritableFileStream> {
    return new PackedProjectWritableFileStream(this.state, this.path);
  }
}

class PackedProjectDirectoryHandle implements ProjectDirectoryHandle {
  readonly storageKind = "packed" as const;
  private readonly state: PackedProjectState;
  private readonly path: string;

  constructor(
    state: PackedProjectState,
    path = "",
  ) {
    this.state = state;
    this.path = path;
  }

  get name(): string {
    return this.path ? getFileName(this.path) : this.state.name;
  }

  get sourceFileName(): string {
    return this.state.name;
  }

  isDirty(): boolean {
    return this.state.dirty;
  }

  markClean(): void {
    this.state.dirty = false;

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("hproj-project-exported", {
          detail: { name: this.state.name },
        }),
      );
    }
  }

  async getFileHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<ProjectFileHandle> {
    const filePath = joinProjectPath(this.path, name);

    if (!this.state.files.has(filePath)) {
      if (!options.create) {
        throw new Error("项目文件不存在。");
      }

      this.state.files.set(filePath, new Uint8Array());
      rememberPackedFilePath(this.state, filePath);
    }

    return new PackedProjectFileHandle(this.state, filePath);
  }

  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<ProjectDirectoryHandle> {
    const directoryPath = joinProjectPath(this.path, name);

    if (!packedDirectoryExists(this.state, directoryPath)) {
      if (!options.create) {
        throw new Error("项目目录不存在。");
      }

      ensurePackedDirectory(this.state, directoryPath);
    }

    return new PackedProjectDirectoryHandle(this.state, directoryPath);
  }

  async *keys(): AsyncIterableIterator<string> {
    const prefix = this.path ? `${this.path}/` : "";
    const names = new Set<string>();

    for (const directoryPath of this.state.directories) {
      if (directoryPath === this.path || !directoryPath.startsWith(prefix)) {
        continue;
      }

      const rest = directoryPath.slice(prefix.length);
      const [name] = rest.split("/");

      if (name) {
        names.add(name);
      }
    }

    for (const filePath of this.state.files.keys()) {
      if (!filePath.startsWith(prefix)) {
        continue;
      }

      const rest = filePath.slice(prefix.length);
      const [name] = rest.split("/");

      if (name) {
        names.add(name);
      }
    }

    yield* Array.from(names).sort((a, b) => a.localeCompare(b));
  }
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

export function createMemoryProjectDirectory(
  files: PackedProjectContent,
  sourceFileName: string,
): ProjectDirectoryHandle {
  const state: PackedProjectState = {
    name: sourceFileName,
    files: new Map(),
    directories: new Set([""]),
    dirty: false,
  };

  for (const [path, content] of Object.entries(files)) {
    const normalizedPath = normalizeProjectPath(path);

    if (!normalizedPath) {
      continue;
    }

    state.files.set(
      normalizedPath,
      typeof content === "string" ? textEncoder.encode(content) : content,
    );
    rememberPackedFilePath(state, normalizedPath);
  }

  return new PackedProjectDirectoryHandle(state);
}

export function isPackedProjectRoot(root: ProjectDirectoryHandle): boolean {
  return root.storageKind === "packed";
}

export function isPackedProjectDirty(root: ProjectDirectoryHandle): boolean {
  return root.isDirty?.() ?? false;
}

export function markProjectPackageExported(root: ProjectDirectoryHandle): void {
  root.markClean?.();
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

export async function readBinaryFile(
  root: ProjectDirectoryHandle,
  path: string,
): Promise<Uint8Array> {
  const fileHandle = await getFileByPath(root, path);
  const file = await fileHandle.getFile();

  return new Uint8Array(await file.arrayBuffer());
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
