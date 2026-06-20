export interface ActiveAppDraft {
  id: string;
  label: string;
}

const drafts = new Map<string, ActiveAppDraft>();
const listeners = new Set<(activeDrafts: ActiveAppDraft[]) => void>();

export function setAppDraft(
  id: string,
  label: string,
  hasUnsavedChanges: boolean,
): void {
  if (hasUnsavedChanges) {
    drafts.set(id, { id, label });
  } else {
    drafts.delete(id);
  }

  notifyListeners();
}

export function clearAppDraft(id: string): void {
  if (drafts.delete(id)) {
    notifyListeners();
  }
}

export function getActiveAppDrafts(): ActiveAppDraft[] {
  return Array.from(drafts.values(), (draft) => ({ ...draft }));
}

export function subscribeAppDrafts(
  listener: (activeDrafts: ActiveAppDraft[]) => void,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(): void {
  const snapshot = getActiveAppDrafts();
  listeners.forEach((listener) => listener(snapshot));
}
