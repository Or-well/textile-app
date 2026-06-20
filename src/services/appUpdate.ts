import { subscribeAppOperations } from "./appOperation";
import { APP_VERSION } from "../utils/appVersion";
import type {
  AppPlatform,
  AppUpdateState,
  UpdateChannel,
  UpdateCheckResult,
  UpdateStatus,
  VersionManifest,
} from "./appUpdateTypes";
import {
  applyPwaUpdate,
  canApplyPwaUpdate,
  isPwaRuntime,
  setupPwaUpdateAdapter,
} from "./pwaUpdateAdapter";
import {
  checkTauriUpdate,
  downloadTauriUpdate,
  hasPendingTauriUpdate,
  installAndRelaunchTauriUpdate,
  isTauriRuntime,
  isTauriUpdateDownloaded,
} from "./tauriUpdateAdapter";
import { getAppUpdateSafety } from "./updateSafety";
import {
  checkWebUpdate,
  hasConfiguredWebDownloadUrl,
  openWebDownloadPage,
  WEB_VERSION_MANIFEST_URL,
} from "./webUpdateAdapter";

export type {
  AppPlatform,
  AppUpdateState,
  UpdateChannel,
  UpdateCheckResult,
  UpdateStatus,
  VersionManifest,
} from "./appUpdateTypes";

type BroadcastMessage =
  | {
      type: "state";
      sourceId: string;
      state: AppUpdateState;
    }
  | {
      type: "refreshing";
      sourceId: string;
    };

const UPDATE_CHANNEL_STORAGE_KEY = "textile.update.channel";
const DISMISSED_VERSION_STORAGE_KEY = "textile.update.dismissed_version";
const UPDATE_BROADCAST_CHANNEL = "textile.update.broadcast.v2";
const DESKTOP_UPDATE_SOURCE = "Tauri Updater";

const listeners = new Set<(state: AppUpdateState) => void>();
const sourceId = createSourceId();

let setupDone = false;
let isApplyingUpdate = false;
let updateBroadcast: BroadcastChannel | null = null;
let unsubscribeOperations: (() => void) | null = null;

let state: AppUpdateState = {
  status: "idle",
  currentVersion: APP_VERSION,
  channel: readUpdateChannel(),
  platform: detectPlatform(),
  sourceUrl: getSourceUrl(detectPlatform()),
  checkedAt: "",
  message: "尚未检查更新。",
  pwaRefreshReady: false,
  desktopUpdateDownloaded: false,
  canAutoRefresh: true,
  refreshBlockedReason: "",
  downloadProgress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  latestDownloadedAt: "",
  dismissedVersion: readDismissedVersion(),
  errorMessage: "",
};

export function getCurrentVersion(): string {
  return state.currentVersion;
}

export function getUpdateChannel(): UpdateChannel {
  return state.channel;
}

export function setUpdateChannel(channel: UpdateChannel): void {
  state = {
    ...state,
    channel,
    status: "idle",
    latest: undefined,
    desktopUpdateDownloaded: false,
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    message: "更新通道已切换，请重新检查更新。",
    errorMessage: "",
  };
  writeStorage(UPDATE_CHANNEL_STORAGE_KEY, channel);
  notifyListeners();
}

export function getAppUpdateState(): AppUpdateState {
  return cloneState(state);
}

export function subscribeAppUpdate(
  listener: (nextState: AppUpdateState) => void,
): () => void {
  listeners.add(listener);
  listener(cloneState(state));

  return () => {
    listeners.delete(listener);
  };
}

export function setupAppUpdate(): void {
  if (setupDone || typeof window === "undefined") {
    return;
  }

  setupDone = true;
  state = {
    ...state,
    platform: detectPlatform(),
    sourceUrl: getSourceUrl(detectPlatform()),
  };
  unsubscribeOperations = subscribeAppOperations(() => {
    reevaluatePendingAppUpdate();
  });

  if (state.platform === "desktop") {
    notifyListeners();
    return;
  }

  setupBroadcastChannel();
  setupPwaUpdateAdapter({
    onRefreshReady() {
      markPwaRefreshReady();
    },
    onOfflineReady() {
      if (state.status === "idle") {
        state = {
          ...state,
          message: "Textile 已可离线使用。",
        };
        notifyListeners();
      }
    },
  });
}

export function disposeAppUpdate(): void {
  unsubscribeOperations?.();
  unsubscribeOperations = null;
  updateBroadcast?.close();
  updateBroadcast = null;
  setupDone = false;
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  state = {
    ...state,
    status: "checking",
    platform: detectPlatform(),
    sourceUrl: getSourceUrl(detectPlatform()),
    desktopUpdateDownloaded: false,
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    message: "正在检查更新...",
    errorMessage: "",
  };
  notifyListeners();

  const checkedAt = new Date().toISOString();

  try {
    if (state.platform === "desktop") {
      const result = await checkTauriUpdate(state.channel);
      return commitCheckResult(
        result.available ? "update-available" : "up-to-date",
        result.manifest,
        checkedAt,
        result.available
          ? `发现桌面新版本 v${result.manifest?.latest_version ?? ""}。`
          : "当前已经是最新桌面版本。",
      );
    }

    const result = await checkWebUpdate(
      state.currentVersion,
      state.channel,
      state.latest,
    );
    const channelMatches =
      state.channel === "beta"
        ? result.manifest.channel === "beta" ||
          result.manifest.channel === "stable"
        : result.manifest.channel === "stable";

    return commitCheckResult(
      result.available ? "update-available" : "up-to-date",
      result.manifest,
      checkedAt,
      !channelMatches
        ? `当前 ${getChannelLabel(state.channel)} 通道没有可用更新。`
        : result.available
          ? `发现新版本 v${result.manifest.latest_version}。`
          : "当前已经是最新版本。",
    );
  } catch (error) {
    return commitFailure(
      error instanceof Error
        ? error.message
        : "检查更新失败。请稍后重试，或联系负责人确认发布配置。",
      checkedAt,
    );
  }
}

export function dismissUpdate(): void {
  const dismissedVersion = state.pwaRefreshReady
    ? "pwa-refresh"
    : state.latest?.latest_version ?? "";

  state = {
    ...state,
    dismissedVersion,
  };
  writeStorage(DISMISSED_VERSION_STORAGE_KEY, dismissedVersion);
  notifyListeners();
}

export function hasConfiguredDownloadUrl(downloadUrl?: string): boolean {
  return hasConfiguredWebDownloadUrl(downloadUrl);
}

export function openDownloadPage(downloadUrl?: string): boolean {
  if (state.platform === "desktop") {
    return false;
  }

  return openWebDownloadPage(downloadUrl);
}

export async function installUpdate(): Promise<UpdateCheckResult> {
  if (state.platform === "desktop") {
    return handleDesktopUpdateAction();
  }

  if (state.pwaRefreshReady && canApplyPwaUpdate()) {
    await applyReadyPwaUpdate();
    return buildResult(
      "refreshing",
      state.latest,
      new Date().toISOString(),
      "正在刷新到新版 Textile...",
    );
  }

  const openedDownloadPage = openWebDownloadPage(state.latest?.download_url);

  return buildResult(
    state.status,
    state.latest,
    state.checkedAt || new Date().toISOString(),
    openedDownloadPage
      ? "已打开正式下载页。"
      : "当前 Web 版本不支持自动安装，且未配置正式下载地址。",
  );
}

export function reevaluatePendingAppUpdate(): void {
  syncSafetyState();

  if (
    state.platform === "desktop" &&
    state.desktopUpdateDownloaded &&
    state.status === "waiting-for-safe-state" &&
    state.canAutoRefresh
  ) {
    state = {
      ...state,
      status: "downloaded",
      message: "桌面更新已下载，可以安装并重启。",
    };
  }

  notifyListeners();

  if (state.pwaRefreshReady) {
    void applyReadyPwaUpdateWhenSafe();
  }
}

function commitCheckResult(
  status: UpdateStatus,
  latest: VersionManifest | undefined,
  checkedAt: string,
  message: string,
): UpdateCheckResult {
  const result = buildResult(status, latest, checkedAt, message);

  state = {
    ...state,
    ...result,
    dismissedVersion:
      latest?.latest_version === state.dismissedVersion
        ? state.dismissedVersion
        : "",
    errorMessage: "",
  };
  notifyListeners();
  return result;
}

function commitFailure(message: string, checkedAt = new Date().toISOString()): UpdateCheckResult {
  const result = buildResult("failed", state.latest, checkedAt, message);

  state = {
    ...state,
    ...result,
    errorMessage: message,
  };
  notifyListeners();
  return result;
}

async function handleDesktopUpdateAction(): Promise<UpdateCheckResult> {
  if (!hasPendingTauriUpdate()) {
    return commitFailure("没有待处理的桌面更新，请先检查更新。");
  }

  if (!isTauriUpdateDownloaded()) {
    state = {
      ...state,
      status: "downloading",
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      message: "正在下载桌面更新...",
      errorMessage: "",
    };
    notifyListeners();

    try {
      await downloadTauriUpdate((progress) => {
        state = {
          ...state,
          downloadProgress: progress.progress,
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes,
        };
        notifyListeners();
      });
    } catch (error) {
      return commitFailure(
        error instanceof Error ? error.message : "桌面更新下载失败。",
      );
    }

    syncSafetyState();
    state = {
      ...state,
      status: state.canAutoRefresh ? "downloaded" : "waiting-for-safe-state",
      desktopUpdateDownloaded: true,
      downloadProgress: 100,
      latestDownloadedAt: new Date().toISOString(),
      message: state.canAutoRefresh
        ? "桌面更新已下载，可以安装并重启。"
        : state.refreshBlockedReason,
    };
    notifyListeners();
    return buildResult(
      state.status,
      state.latest,
      state.checkedAt,
      state.message,
    );
  }

  syncSafetyState();

  if (!state.canAutoRefresh) {
    state = {
      ...state,
      status: "waiting-for-safe-state",
      message: state.refreshBlockedReason,
    };
    notifyListeners();
    return buildResult(
      state.status,
      state.latest,
      state.checkedAt,
      state.message,
    );
  }

  state = {
    ...state,
    status: "installing",
    message: "正在安装桌面更新，请勿关闭 Textile...",
    errorMessage: "",
  };
  notifyListeners();

  try {
    await installAndRelaunchTauriUpdate();
    state = {
      ...state,
      status: "restarting",
      message: "更新安装完成，正在重新启动 Textile...",
    };
    notifyListeners();
    return buildResult(
      "restarting",
      state.latest,
      state.checkedAt,
      state.message,
    );
  } catch (error) {
    return commitFailure(
      error instanceof Error ? error.message : "桌面更新安装失败。",
    );
  }
}

function markPwaRefreshReady(): void {
  syncSafetyState();
  state = {
    ...state,
    status: "ready-to-refresh",
    pwaRefreshReady: true,
    latestDownloadedAt: new Date().toISOString(),
    dismissedVersion: "",
    message: state.canAutoRefresh
      ? "Textile 新版本已准备好，刷新后即可使用。"
      : state.refreshBlockedReason,
    errorMessage: "",
  };
  writeStorage(DISMISSED_VERSION_STORAGE_KEY, "");
  notifyListeners();
  void applyReadyPwaUpdateWhenSafe();
}

async function applyReadyPwaUpdateWhenSafe(): Promise<void> {
  if (
    !state.pwaRefreshReady ||
    !state.canAutoRefresh ||
    state.dismissedVersion === "pwa-refresh"
  ) {
    return;
  }

  await applyReadyPwaUpdate();
}

async function applyReadyPwaUpdate(): Promise<void> {
  if (isApplyingUpdate || !canApplyPwaUpdate()) {
    return;
  }

  isApplyingUpdate = true;
  state = {
    ...state,
    status: "refreshing",
    message: "正在刷新到新版 Textile...",
    errorMessage: "",
  };
  notifyListeners();
  broadcastMessage({ type: "refreshing", sourceId });

  try {
    await applyPwaUpdate();
  } finally {
    isApplyingUpdate = false;
  }
}

function syncSafetyState(): void {
  const safety = getAppUpdateSafety();
  const updateWaiting =
    state.pwaRefreshReady ||
    state.desktopUpdateDownloaded ||
    state.status === "waiting-for-safe-state";

  state = {
    ...state,
    canAutoRefresh: safety.canAutoRefresh,
    refreshBlockedReason: safety.canAutoRefresh ? "" : safety.reason,
    message:
      updateWaiting && !safety.canAutoRefresh
        ? safety.reason
        : state.message,
  };
}

function setupBroadcastChannel(): void {
  if (!("BroadcastChannel" in window) || updateBroadcast) {
    return;
  }

  updateBroadcast = new BroadcastChannel(UPDATE_BROADCAST_CHANNEL);
  updateBroadcast.onmessage = (event: MessageEvent<BroadcastMessage>) => {
    const message = event.data;

    if (!message || message.sourceId === sourceId) {
      return;
    }

    if (message.type === "refreshing" && state.pwaRefreshReady) {
      void applyReadyPwaUpdate();
      return;
    }

    if (message.type === "state") {
      mergeBroadcastState(message.state);
    }
  };
}

function mergeBroadcastState(nextState: AppUpdateState): void {
  const shouldAdoptRefreshReady =
    nextState.pwaRefreshReady && !state.pwaRefreshReady;
  const shouldAdoptNewerCheck =
    Boolean(nextState.checkedAt) && nextState.checkedAt > state.checkedAt;

  if (!shouldAdoptRefreshReady && !shouldAdoptNewerCheck) {
    return;
  }

  state = {
    ...state,
    status: nextState.status,
    latest: nextState.latest,
    checkedAt: nextState.checkedAt,
    message: nextState.message,
    pwaRefreshReady: nextState.pwaRefreshReady,
    latestDownloadedAt: nextState.latestDownloadedAt,
    errorMessage: nextState.errorMessage,
  };
  syncSafetyState();
  notifyListeners({ broadcast: false });
  void applyReadyPwaUpdateWhenSafe();
}

function buildResult(
  status: UpdateStatus,
  latest: VersionManifest | undefined,
  checkedAt: string,
  message: string,
): UpdateCheckResult {
  return {
    status,
    currentVersion: state.currentVersion,
    channel: state.channel,
    platform: state.platform,
    sourceUrl: state.sourceUrl,
    latest,
    checkedAt,
    message,
  };
}

function detectPlatform(): AppPlatform {
  if (isTauriRuntime()) {
    return "desktop";
  }

  return isPwaRuntime() ? "pwa" : "web";
}

function getSourceUrl(platform: AppPlatform): string {
  return platform === "desktop" ? DESKTOP_UPDATE_SOURCE : WEB_VERSION_MANIFEST_URL;
}

function getChannelLabel(channel: UpdateChannel): string {
  return channel === "beta" ? "beta" : "stable";
}

function readUpdateChannel(): UpdateChannel {
  const storedValue = readStorage(UPDATE_CHANNEL_STORAGE_KEY);
  return storedValue === "beta" ? "beta" : "stable";
}

function readDismissedVersion(): string {
  return readStorage(DISMISSED_VERSION_STORAGE_KEY) ?? "";
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Update checks continue to work when localStorage is unavailable.
  }
}

function cloneState(currentState: AppUpdateState): AppUpdateState {
  return {
    ...currentState,
    latest: currentState.latest
      ? {
          ...currentState.latest,
          notes: [...currentState.latest.notes],
        }
      : undefined,
  };
}

function notifyListeners(options: { broadcast?: boolean } = {}): void {
  syncSafetyState();
  const snapshot = cloneState(state);

  listeners.forEach((listener) => listener(snapshot));

  if (options.broadcast !== false && state.platform !== "desktop") {
    broadcastMessage({ type: "state", sourceId, state: snapshot });
  }
}

function broadcastMessage(message: BroadcastMessage): void {
  try {
    updateBroadcast?.postMessage(message);
  } catch {
    // Cross-tab synchronization is best-effort.
  }
}

function createSourceId(): string {
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
