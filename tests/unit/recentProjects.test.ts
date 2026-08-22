import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRecentProjects,
  getRecentProjectHandle,
  listRecentProjects,
  rememberRecentProject,
} from "../../src/services/recentProjects";
import {
  createMemoryProjectDirectory,
  createNativeProjectDirectory,
  type ProjectDirectoryHandle,
} from "../../src/services/projectFs";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

interface FakeIdbRequest<T = unknown> {
  result: T;
  onerror: (() => void) | null;
  onsuccess: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
}

function createStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function createFakeIndexedDb() {
  const handles = new Map<string, ProjectDirectoryHandle>();
  const open = vi.fn(() => {
    const database = {
      objectStoreNames: {
        contains: () => true,
      },
      createObjectStore: vi.fn(),
      transaction: vi.fn((_storeName: string, _mode: IDBTransactionMode) => {
        const transaction = {
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
          objectStore: () => ({
            put(value: ProjectDirectoryHandle, key: string) {
              handles.set(key, value);
              queueMicrotask(() => transaction.oncomplete?.());
            },
            delete(key: string) {
              handles.delete(key);
              queueMicrotask(() => transaction.oncomplete?.());
            },
            clear() {
              handles.clear();
              queueMicrotask(() => transaction.oncomplete?.());
            },
            get(key: string) {
              const request: FakeIdbRequest<ProjectDirectoryHandle | undefined> = {
                result: undefined,
                onerror: null,
                onsuccess: null,
              };

              queueMicrotask(() => {
                request.result = handles.get(key);
                request.onsuccess?.();
              });

              return request;
            },
          }),
        };

        return transaction;
      }),
      close: vi.fn(),
    };
    const request: FakeIdbRequest<typeof database> = {
      result: database,
      onerror: null,
      onsuccess: null,
      onupgradeneeded: null,
    };

    queueMicrotask(() => {
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });

    return request;
  });

  return { handles, open };
}

function setFolderStorageKind(root: ProjectDirectoryHandle): ProjectDirectoryHandle {
  Object.defineProperty(root, "storageKind", {
    configurable: true,
    value: "folder",
  });

  return root;
}

describe("recent projects", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: createStorage() },
    });
  });

  afterEach(async () => {
    await clearRecentProjects();
    Reflect.deleteProperty(globalThis, "indexedDB");
    Reflect.deleteProperty(globalThis, "window");
  });

  it("does not write IndexedDB directory handles for native-folder projects", async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: { open: fakeIndexedDb.open },
    });
    const root = createNativeProjectDirectory("\\\\?\\C:\\Projects\\Demo", "Demo");

    await rememberRecentProject(
      {
        projectId: "project-1",
        name: "Demo",
        sourceType: "folder",
        displayPath: "\\\\?\\C:\\Projects\\Demo",
      },
      root,
    );

    expect(fakeIndexedDb.open).not.toHaveBeenCalled();
    expect(listRecentProjects()[0]).toMatchObject({
      projectId: "project-1",
      displayPath: "C:\\Projects\\Demo",
      sourceType: "folder",
    });
  });

  it("records an imported native child project instead of its parent folder", async () => {
    invokeMock.mockResolvedValue({ exists: true, kind: "directory" });
    const importRoot = createNativeProjectDirectory("C:\\Imports", "Imports");
    const projectRoot = await importRoot.getDirectoryHandle("Demo-project1");

    await rememberRecentProject(
      {
        projectId: "project-1",
        name: "Demo",
        sourceType: "folder",
        displayPath: projectRoot.nativePath ?? projectRoot.name,
      },
      projectRoot,
    );

    expect(listRecentProjects()[0]).toMatchObject({
      projectId: "project-1",
      displayPath: "C:\\Imports\\Demo-project1",
      sourceType: "folder",
    });
  });

  it("normalizes legacy extended-length display paths when listing recent projects", () => {
    window.localStorage.setItem(
      "textile.recentProjects.v1",
      JSON.stringify([
        {
          recordId: "project-1::folder::\\\\?\\C:\\Projects\\Demo",
          projectId: "project-1",
          name: "Demo",
          sourceType: "folder",
          displayPath: "\\\\?\\C:\\Projects\\Demo",
          lastOpenedAt: "2026-07-04T00:00:00.000Z",
        },
      ]),
    );

    expect(listRecentProjects()[0]).toMatchObject({
      recordId: "project-1::folder::C:\\Projects\\Demo",
      displayPath: "C:\\Projects\\Demo",
    });
  });

  it("keeps storing IndexedDB handles for Web/PWA folder projects", async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: { open: fakeIndexedDb.open },
    });
    const root = setFolderStorageKind(
      createMemoryProjectDirectory({}, "Demo"),
    );

    const records = await rememberRecentProject(
      {
        projectId: "project-1",
        name: "Demo",
        sourceType: "folder",
        displayPath: "Demo",
      },
      root,
    );

    expect(fakeIndexedDb.open).toHaveBeenCalledTimes(1);
    await expect(getRecentProjectHandle(records[0].recordId)).resolves.toBe(root);
  });

  it("does not store IndexedDB handles for packed .hproj projects", async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: { open: fakeIndexedDb.open },
    });

    await rememberRecentProject(
      {
        projectId: "project-1",
        name: "Demo",
        sourceType: "hproj",
        displayPath: "demo.hproj",
      },
      createMemoryProjectDirectory({}, "demo.hproj"),
    );

    expect(fakeIndexedDb.open).not.toHaveBeenCalled();
  });
});
