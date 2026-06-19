import { registerSW } from "virtual:pwa-register";

export interface PwaUpdateCallbacks {
  onRefreshReady: () => void;
  onOfflineReady: () => void;
}

const SERVICE_WORKER_CHECK_INTERVAL_MS = 30 * 60 * 1000;

let setupDone = false;
let reloadPwa: ((reloadPage?: boolean) => Promise<void>) | null = null;

export function isPwaRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function setupPwaUpdateAdapter(callbacks: PwaUpdateCallbacks): void {
  if (setupDone || typeof window === "undefined") {
    return;
  }

  setupDone = true;
  reloadPwa = registerSW({
    immediate: true,
    onNeedRefresh: callbacks.onRefreshReady,
    onOfflineReady: callbacks.onOfflineReady,
    onRegistered(registration: ServiceWorkerRegistration | undefined) {
      if (!registration) {
        return;
      }

      window.setInterval(() => {
        if (navigator.onLine) {
          void registration.update();
        }
      }, SERVICE_WORKER_CHECK_INTERVAL_MS);
    },
  });
}

export function canApplyPwaUpdate(): boolean {
  return Boolean(reloadPwa);
}

export async function applyPwaUpdate(): Promise<void> {
  if (!reloadPwa) {
    throw new Error("PWA 更新尚未准备完成。");
  }

  await reloadPwa(true);
}

