import { clearRecentProjects } from "./recentProjects";
import { clearAllProjectSessions, clearProjectSession } from "./session";

export type CacheCleanupItemId =
  | "import_preview"
  | "export_temp"
  | "update_check"
  | "recent_projects"
  | "current_session";

export interface CacheCleanupOption {
  id: CacheCleanupItemId;
  label: string;
  description: string;
  defaultSelected: boolean;
}

export interface CacheCleanupResultItem {
  id: CacheCleanupItemId;
  label: string;
  details: string[];
}

export interface CacheCleanupResult {
  cleaned: CacheCleanupResultItem[];
  missing: CacheCleanupResultItem[];
}

interface CleanupContext {
  projectId?: string;
}

const STORAGE_KEY_GROUPS: Record<
  Exclude<CacheCleanupItemId, "recent_projects" | "current_session">,
  string[]
> = {
  import_preview: [
    "textile.import.preview",
    "textile.import.preview.v1",
    "textile.change_package.preview",
  ],
  export_temp: [
    "textile.export.temp",
    "textile.export.temp.v1",
    "textile.release_export.temp",
  ],
  update_check: [
    "textile.update.dismissed_version",
    "textile.update.latest",
    "textile.update.checked_at",
  ],
};

export const CACHE_CLEANUP_OPTIONS: CacheCleanupOption[] = [
  {
    id: "import_preview",
    label: "导入预览缓存",
    description: "清理导入修改包或文件预览时留下的临时内容。",
    defaultSelected: true,
  },
  {
    id: "export_temp",
    label: "导出临时缓存",
    description: "清理导出过程可能留下的临时状态。",
    defaultSelected: true,
  },
  {
    id: "update_check",
    label: "更新检查缓存",
    description: "清理更新提示的临时记录，不改变项目数据。",
    defaultSelected: true,
  },
  {
    id: "recent_projects",
    label: "最近项目记录",
    description: "清空启动页的最近项目列表和本地授权记录。",
    defaultSelected: false,
  },
  {
    id: "current_session",
    label: "当前登录会话",
    description: "清除当前项目的登录记忆，之后需要重新登录。",
    defaultSelected: false,
  },
];

const optionLabels = Object.fromEntries(
  CACHE_CLEANUP_OPTIONS.map((option) => [option.id, option.label]),
) as Record<CacheCleanupItemId, string>;

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function removeStorageKeys(keys: string[]): string[] {
  if (!canUseStorage()) {
    return [];
  }

  const removed: string[] = [];
  let storages: Storage[];

  try {
    storages = [window.localStorage, window.sessionStorage];
  } catch {
    return [];
  }

  for (const storage of storages) {
    for (const key of keys) {
      try {
        if (storage.getItem(key) !== null) {
          storage.removeItem(key);
          removed.push(key);
        }
      } catch {
        // Storage cleanup is best-effort.
      }
    }
  }

  return removed;
}

function makeItem(
  id: CacheCleanupItemId,
  details: string[],
): CacheCleanupResultItem {
  return {
    id,
    label: optionLabels[id],
    details,
  };
}

export async function clearSelectedCache(
  selectedItems: CacheCleanupItemId[],
  context: CleanupContext = {},
): Promise<CacheCleanupResult> {
  const cleaned: CacheCleanupResultItem[] = [];
  const missing: CacheCleanupResultItem[] = [];
  const selected = new Set(selectedItems);

  for (const id of selected) {
    if (id === "recent_projects") {
      await clearRecentProjects();
      cleaned.push(makeItem(id, ["已清空最近项目记录和本地授权记录。"]));
      continue;
    }

    if (id === "current_session") {
      if (context.projectId) {
        clearProjectSession(context.projectId);
        cleaned.push(makeItem(id, ["已清除当前项目登录会话。"]));
      } else {
        clearAllProjectSessions();
        cleaned.push(makeItem(id, ["已清除全部项目登录会话。"]));
      }
      continue;
    }

    const removedKeys = removeStorageKeys(STORAGE_KEY_GROUPS[id]);

    if (removedKeys.length > 0) {
      cleaned.push(makeItem(id, removedKeys));
    } else {
      missing.push(makeItem(id, ["未发现可清理的缓存。"]));
    }
  }

  return { cleaned, missing };
}
