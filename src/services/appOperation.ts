export interface ActiveAppOperation {
  id: string;
  label: string;
  startedAt: string;
}

const operations = new Map<string, ActiveAppOperation>();
const listeners = new Set<(activeOperations: ActiveAppOperation[]) => void>();

export function beginAppOperation(label: string): () => void {
  const id = `operation-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  operations.set(id, {
    id,
    label,
    startedAt: new Date().toISOString(),
  });
  notifyListeners();

  let finished = false;

  return () => {
    if (finished) {
      return;
    }

    finished = true;
    operations.delete(id);
    notifyListeners();
  };
}

export async function withAppOperation<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  const finish = beginAppOperation(label);

  try {
    return await operation();
  } finally {
    finish();
  }
}

export function getActiveAppOperations(): ActiveAppOperation[] {
  return Array.from(operations.values(), (operation) => ({ ...operation }));
}

export function subscribeAppOperations(
  listener: (activeOperations: ActiveAppOperation[]) => void,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(): void {
  const snapshot = getActiveAppOperations();
  listeners.forEach((listener) => listener(snapshot));
}

