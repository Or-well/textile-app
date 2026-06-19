import packageInfo from "../../package.json";
import { registerSW } from "virtual:pwa-register";
import { getAppUpdateSafety } from "./updateSafety";

export type UpdateChannel = "stable" | "beta";
export type AppPlatform = "web" | "pwa" | "desktop";
export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "update-available"
  | "ready-to-refresh"
  | "refreshing"
  | "failed";

export interface VersionManifest {
  version: string;
  latest_version: string;
  build_id: string;
  assets_hash: string;
  schema_version: number;
  release_date: string;
  channel: UpdateChannel;
  critical: boolean;
  download_url: string;
  notes: string[];
}

export interface UpdateCheckResult {
  status: UpdateStatus;
  currentVersion: string;
  channel: UpdateChannel;
  platform: AppPlatform;
  sourceUrl: string;
  latest?: VersionManifest;
  checkedAt: string;
  message: string;
}

export interface AppUpdateState extends UpdateCheckResult {
  pwaRefreshReady: boolean;
  canAutoRefresh: boolean;
  refreshBlockedReason: string;
  latestDownloadedAt: string;
  dismissedVersion: string;
  errorMessage: string;
}

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
const VERSION_MANIFEST_URL = "/version.json";
const UNCONFIGURED_DOWNLOAD_URL = "";
const UPDATE_BROADCAST_CHANNEL = "textile.update.broadcast.v1";
const SERVICE_WORKER_CHECK_INTERVAL_MS = 30 * 60 * 1000;

const listeners = new Set<(state: AppUpdateState) => void>();
const sourceId = createSourceId();
let pwaSetupDone = false;
let isApplyingUpdate = false;
let reloadPwa: ((reloadPage?: boolean) => Promise<void>) | null = null;
let updateBroadcast: BroadcastChannel | null = null;

let state: AppUpdateState = {
  status: "idle",
  currentVersion: normalizeVersion(packageInfo.version),
  channel: readUpdateChannel(),
  platform: detectPlatform(),
  sourceUrl: VERSION_MANIFEST_URL,
  checkedAt: "",
  message: "尚未检查更新。",
  pwaRefreshReady: false,
  canAutoRefresh: true,
  refreshBlockedReason: "",
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
  listener: (state: AppUpdateState) => void,
): () => void {
  listeners.add(listener);
  listener(cloneState(state));

  return () => {
    listeners.delete(listener);
  };
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  state = {
    ...state,
    status: "checking",
    message: "正在检查更新...",
    errorMessage: "",
  };
  notifyListeners();

  const checkedAt = new Date().toISOString();

  try {
    const manifest = await fetchVersionManifest();
    const channelMatches = isManifestForChannel(manifest, state.channel);

    if (!channelMatches) {
      const result = buildResult({
        status: "up-to-date",
        latest: manifest,
        checkedAt,
        message: `当前 ${getChannelLabel(state.channel)} 通道没有可用更新。`,
      });

      state = { ...state, ...result, errorMessage: "" };
      notifyListeners();
      return result;
    }

    const hasNewVersion =
      compareVersions(manifest.latest_version, state.currentVersion) > 0 ||
      isDifferentBuild(manifest, state.latest);
    const result = buildResult({
      status: hasNewVersion ? "update-available" : "up-to-date",
      latest: manifest,
      checkedAt,
      message: hasNewVersion
        ? `发现新版本 v${normalizeVersion(manifest.latest_version)}。`
        : "当前已经是最新版本。",
    });

    state = { ...state, ...result, errorMessage: "" };
    notifyListeners();
    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "检查更新失败。请稍后重试，或联系负责人确认发布地址。";
    const result = buildResult({
      status: "failed",
      checkedAt,
      message: errorMessage,
    });

    state = { ...state, ...result, errorMessage };
    notifyListeners();
    return result;
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
  return Boolean(getSafeDownloadUrl(downloadUrl));
}

export function openDownloadPage(downloadUrl?: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const safeUrl = getSafeDownloadUrl(downloadUrl);
  if (!safeUrl) {
    return false;
  }

  window.open(safeUrl, "_blank", "noopener,noreferrer");
  return true;
}

export async function installUpdate(): Promise<UpdateCheckResult> {
  if (state.pwaRefreshReady && reloadPwa) {
    await applyReadyUpdate();
    return buildResult({
      status: "refreshing",
      latest: state.latest,
      checkedAt: new Date().toISOString(),
      message: "正在刷新到新版 Textile...",
    });
  }

  const openedDownloadPage = openDownloadPage(state.latest?.download_url);

  return buildResult({
    status: state.status,
    latest: state.latest,
    checkedAt: state.checkedAt || new Date().toISOString(),
    message: openedDownloadPage
      ? state.status === "update-available"
        ? "已打开下载页。Web / PWA 版本也会在后台准备可刷新更新。"
        : "已打开下载页。当前还没有可直接刷新的新版。"
      : "未配置发布地址。请联系负责人配置发布地址。",
  });
}

export function setupPwaUpdateListener(): void {
  if (pwaSetupDone || typeof window === "undefined") {
    return;
  }

  pwaSetupDone = true;
  setupBroadcastChannel();
  reloadPwa = registerSW({
    immediate: true,
    onNeedRefresh() {
      markPwaRefreshReady("Textile 新版本已准备好，刷新后即可使用。");
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

export function reevaluatePendingAppUpdate(): void {
  if (!state.pwaRefreshReady) {
    return;
  }

  syncSafetyState();
  notifyListeners();
  void applyReadyUpdateWhenSafe();
}

function markPwaRefreshReady(message: string): void {
  syncSafetyState();
  state = {
    ...state,
    status: "ready-to-refresh",
    platform: detectPlatform(),
    pwaRefreshReady: true,
    latestDownloadedAt: new Date().toISOString(),
    dismissedVersion: "",
    message,
    errorMessage: "",
  };
  writeStorage(DISMISSED_VERSION_STORAGE_KEY, "");
  notifyListeners();
  void applyReadyUpdateWhenSafe();
}

async function applyReadyUpdateWhenSafe(): Promise<void> {
  if (!state.pwaRefreshReady || !state.canAutoRefresh || !reloadPwa) {
    return;
  }

  if (state.dismissedVersion === "pwa-refresh") {
    return;
  }

  await applyReadyUpdate();
}

async function applyReadyUpdate(): Promise<void> {
  if (isApplyingUpdate || !reloadPwa) {
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
  await reloadPwa(true);
}

function syncSafetyState(): void {
  const safety = getAppUpdateSafety();
  state = {
    ...state,
    canAutoRefresh: safety.canAutoRefresh,
    refreshBlockedReason: safety.canAutoRefresh ? "" : safety.reason,
    message:
      state.pwaRefreshReady && !safety.canAutoRefresh
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

    if (message.type === "refreshing" && state.pwaRefreshReady && reloadPwa) {
      void applyReadyUpdate();
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
    nextState.checkedAt && nextState.checkedAt > state.checkedAt;

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
  void applyReadyUpdateWhenSafe();
}

function buildResult(input: {
  status: UpdateStatus;
  latest?: VersionManifest;
  checkedAt: string;
  message: string;
}): UpdateCheckResult {
  return {
    status: input.status,
    currentVersion: state.currentVersion,
    channel: state.channel,
    platform: state.platform,
    sourceUrl: VERSION_MANIFEST_URL,
    latest: input.latest,
    checkedAt: input.checkedAt,
    message: input.message,
  };
}

async function fetchVersionManifest(): Promise<VersionManifest> {
  const response = await fetch(`${VERSION_MANIFEST_URL}?t=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("无法读取版本信息。请稍后重试，或联系负责人确认发布地址。");
  }

  const data = (await response.json()) as Partial<VersionManifest>;
  return validateVersionManifest(data);
}

function validateVersionManifest(data: Partial<VersionManifest>): VersionManifest {
  const manifestVersion = data.latest_version ?? data.version;

  if (
    !manifestVersion ||
    !data.release_date ||
    !isUpdateChannel(data.channel) ||
    !Array.isArray(data.notes)
  ) {
    throw new Error("版本信息格式有问题，无法判断是否需要更新。");
  }

  const normalizedVersion = normalizeVersion(manifestVersion);

  return {
    version: normalizeVersion(data.version ?? normalizedVersion),
    latest_version: normalizedVersion,
    build_id: typeof data.build_id === "string" ? data.build_id : normalizedVersion,
    assets_hash:
      typeof data.assets_hash === "string" ? data.assets_hash : normalizedVersion,
    schema_version:
      typeof data.schema_version === "number" && Number.isFinite(data.schema_version)
        ? data.schema_version
        : 1,
    release_date: data.release_date,
    channel: data.channel,
    critical: data.critical === true,
    download_url: getSafeDownloadUrl(data.download_url),
    notes: data.notes.filter((note): note is string => typeof note === "string"),
  };
}

function isManifestForChannel(
  manifest: VersionManifest,
  channel: UpdateChannel,
): boolean {
  if (channel === "beta") {
    return manifest.channel === "beta" || manifest.channel === "stable";
  }

  return manifest.channel === "stable";
}

function isDifferentBuild(
  nextManifest: VersionManifest,
  previousManifest?: VersionManifest,
): boolean {
  if (!previousManifest) {
    return false;
  }

  return (
    nextManifest.latest_version === state.currentVersion &&
    previousManifest.build_id !== nextManifest.build_id
  );
}

function compareVersions(left: string, right: string): number {
  const leftParts = toVersionParts(left);
  const rightParts = toVersionParts(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue > rightValue) {
      return 1;
    }

    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function toVersionParts(version: string): number[] {
  return normalizeVersion(version)
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function detectPlatform(): AppPlatform {
  if (typeof window === "undefined") {
    return "web";
  }

  if ("__TEXTILE_DESKTOP_UPDATER__" in window) {
    return "desktop";
  }

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

  return isStandalone ? "pwa" : "web";
}

function readUpdateChannel(): UpdateChannel {
  const storedValue = readStorage(UPDATE_CHANNEL_STORAGE_KEY);
  return isUpdateChannel(storedValue) ? storedValue : "stable";
}

function readDismissedVersion(): string {
  return readStorage(DISMISSED_VERSION_STORAGE_KEY) ?? "";
}

function isUpdateChannel(value: unknown): value is UpdateChannel {
  return value === "stable" || value === "beta";
}

function getSafeDownloadUrl(url?: string): string {
  if (!url) {
    return UNCONFIGURED_DOWNLOAD_URL;
  }

  try {
    const parsedUrl = new URL(url);
    const isExampleUrl = parsedUrl.hostname === "github.com" &&
      parsedUrl.pathname.startsWith("/example/");

    return parsedUrl.protocol === "https:" && !isExampleUrl
      ? parsedUrl.toString()
      : UNCONFIGURED_DOWNLOAD_URL;
  } catch {
    return UNCONFIGURED_DOWNLOAD_URL;
  }
}

function getChannelLabel(channel: UpdateChannel): string {
  return channel === "beta" ? "beta" : "stable";
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
    // localStorage may be unavailable in private windows. Update checks still work.
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

  listeners.forEach((listener) => {
    listener(snapshot);
  });

  if (options.broadcast !== false) {
    broadcastMessage({ type: "state", sourceId, state: snapshot });
  }
}

function broadcastMessage(message: BroadcastMessage): void {
  try {
    updateBroadcast?.postMessage(message);
  } catch {
    // BroadcastChannel is best-effort. A single tab can still update safely.
  }
}

function createSourceId(): string {
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
