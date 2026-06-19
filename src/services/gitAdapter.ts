export type GitAdapterKind = "disabled" | "browser" | "desktop";

export type GitAdapterState = "disabled" | "ready" | "conflict" | "error";

export interface GitAdapterStatus {
  available: false;
  state: GitAdapterState;
  message: string;
  hasLocalChanges: false;
  hasRemoteChanges: false;
  hasConflicts: false;
  lastSyncAt?: string;
  errorMessage?: string;
}

export interface GitLogEntry {
  id: string;
  message: string;
  createdAt?: string;
  author?: string;
}

export interface GitConflictResolution {
  path: string;
  action: "keep_main" | "use_local" | "manual_merge" | "skip";
  content?: string;
}

export interface GitAdapter {
  kind: GitAdapterKind;
  isGitProject(): Promise<boolean>;
  getStatus(): Promise<GitAdapterStatus>;
  pull(): Promise<GitAdapterStatus>;
  commit(message: string): Promise<GitAdapterStatus>;
  push(): Promise<GitAdapterStatus>;
  getLog(): Promise<GitLogEntry[]>;
  getCurrentBranch(): Promise<string>;
  resolveConflict(resolutions?: GitConflictResolution[]): Promise<GitAdapterStatus>;
}

const disabledStatus: GitAdapterStatus = {
  available: false,
  state: "disabled",
  message: "当前项目使用修改包协作。请导出修改包，交给负责人导入合并。",
  hasLocalChanges: false,
  hasRemoteChanges: false,
  hasConflicts: false,
};

export class DisabledGitAdapter implements GitAdapter {
  kind: GitAdapterKind = "disabled";

  async isGitProject(): Promise<boolean> {
    return false;
  }

  async getStatus(): Promise<GitAdapterStatus> {
    return { ...disabledStatus };
  }

  async pull(): Promise<GitAdapterStatus> {
    return this.getStatus();
  }

  async commit(_message: string): Promise<GitAdapterStatus> {
    return this.getStatus();
  }

  async push(): Promise<GitAdapterStatus> {
    return this.getStatus();
  }

  async getLog(): Promise<GitLogEntry[]> {
    return [];
  }

  async getCurrentBranch(): Promise<string> {
    return "";
  }

  async resolveConflict(): Promise<GitAdapterStatus> {
    return this.getStatus();
  }
}

export class BrowserGitAdapter extends DisabledGitAdapter {
  override kind: GitAdapterKind = "browser";
}

export class DesktopGitAdapter extends DisabledGitAdapter {
  override kind: GitAdapterKind = "desktop";
}

let activeAdapter: GitAdapter = new DisabledGitAdapter();

export function setGitAdapter(adapter: GitAdapter): void {
  activeAdapter = adapter;
}

export function getGitAdapter(): GitAdapter {
  return activeAdapter;
}

export async function isGitProject(): Promise<boolean> {
  return activeAdapter.isGitProject();
}

export async function getStatus(): Promise<GitAdapterStatus> {
  return activeAdapter.getStatus();
}

export async function pull(): Promise<GitAdapterStatus> {
  return activeAdapter.pull();
}

export async function commit(message: string): Promise<GitAdapterStatus> {
  return activeAdapter.commit(message);
}

export async function push(): Promise<GitAdapterStatus> {
  return activeAdapter.push();
}

export async function getLog(): Promise<GitLogEntry[]> {
  return activeAdapter.getLog();
}

export async function getCurrentBranch(): Promise<string> {
  return activeAdapter.getCurrentBranch();
}

export async function resolveConflict(
  resolutions?: GitConflictResolution[],
): Promise<GitAdapterStatus> {
  return activeAdapter.resolveConflict(resolutions);
}

export async function getWorkingTreeStatus(): Promise<GitAdapterStatus> {
  return getStatus();
}

export async function pullLatest(): Promise<GitAdapterStatus> {
  return pull();
}

export async function createCommit(message: string): Promise<GitAdapterStatus> {
  return commit(message);
}

export async function pushChanges(): Promise<GitAdapterStatus> {
  return push();
}

export async function getHistory(): Promise<string[]> {
  return [];
}
