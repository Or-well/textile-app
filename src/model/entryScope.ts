import type { Entry } from "./types";

/** 固定导航顺序，内容始终使用当前词条；不复制或持久化项目数据。 */
export function resolveEntryScope(ids: readonly string[], entries: readonly Entry[]): Entry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return Array.from(new Set(ids)).flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
}
