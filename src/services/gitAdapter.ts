export interface GitAdapterStatus {
  available: boolean;
  message: string;
}

export async function isGitProject(): Promise<boolean> {
  return false;
}

export async function getWorkingTreeStatus(): Promise<GitAdapterStatus> {
  return {
    available: false,
    message: "当前版本暂未启用同步能力。",
  };
}

export async function pullLatest(): Promise<GitAdapterStatus> {
  return getWorkingTreeStatus();
}

export async function createCommit(_message: string): Promise<GitAdapterStatus> {
  return getWorkingTreeStatus();
}

export async function pushChanges(): Promise<GitAdapterStatus> {
  return getWorkingTreeStatus();
}

export async function getHistory(): Promise<string[]> {
  return [];
}
