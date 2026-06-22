export function isTauriRuntime(): boolean {
  return Boolean(
    (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri,
  );
}
