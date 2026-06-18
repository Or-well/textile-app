import packageInfo from "../../package.json";
import { registerSW } from "virtual:pwa-register";

export type UpdateChannel = "stable" | "beta";
export type AppPlatform = "web" | "pwa" | "desktop";
export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "update-available"
  | "failed";

export interface VersionManifest {
  latest_version: string;
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
  dismissedVersion: string;
  errorMessage: string;
}

const UPDATE_CHANNEL_STORAGE_KEY = "textile.update.channel";
const DISMISSED_VERSION_STORAGE_KEY = "textile.update.dismissed_version";
const VERSION_MANIFEST_URL = "/version.json";
const OFFICIAL_DOWNLOAD_URL =
  "https://github.com/example/patchwork/releases/latest";

const listeners = new Set<(state: AppUpdateState) => void>();
let pwaSetupDone = false;
let reloadPwa: ((reloadPage?: boolean) => Promise<void>) | null = null;

let state: AppUpdateState = {
  status: "idle",
  currentVersion: normalizeVersion(packageInfo.version),
  channel: readUpdateChannel(),
  platform: detectPlatform(),
  sourceUrl: VERSION_MANIFEST_URL,
  checkedAt: "",
  message: "尚未检查更新。",
  pwaRefreshReady: false,
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
      compareVersions(manifest.latest_version, state.currentVersion) > 0;
    const result = buildResult({
      status: hasNewVersion ? "update-available" : "up-to-date",
      latest: manifest,
      checkedAt,
      message: hasNewVersion
        ? `发现新版本 v${normalizeVersion(manifest.latest_version)}。`
        : "当前已经是最新版。",
    });

    state = { ...state, ...result, errorMessage: "" };
    notifyListeners();
    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "检查更新失败。请稍后重试，或打开下载页手动确认。";
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
    pwaRefreshReady: false,
    dismissedVersion,
  };

  writeStorage(DISMISSED_VERSION_STORAGE_KEY, dismissedVersion);
  notifyListeners();
}

export function openDownloadPage(downloadUrl = OFFICIAL_DOWNLOAD_URL): void {
  if (typeof window === "undefined") {
    return;
  }

  const safeUrl = getSafeDownloadUrl(downloadUrl);
  window.open(safeUrl, "_blank", "noopener,noreferrer");
}

export async function installUpdate(): Promise<UpdateCheckResult> {
  if (state.platform === "pwa" && state.pwaRefreshReady && reloadPwa) {
    await reloadPwa(true);
    return buildResult({
      status: "up-to-date",
      latest: state.latest,
      checkedAt: new Date().toISOString(),
      message: "正在刷新到新版程序。",
    });
  }

  openDownloadPage(state.latest?.download_url);

  return buildResult({
    status: state.status,
    latest: state.latest,
    checkedAt: state.checkedAt || new Date().toISOString(),
    message:
      state.platform === "desktop"
        ? "桌面自动安装尚未接入。请从官方发布页下载安装包；后续接入时需要签名校验。"
        : "已打开官方下载页，请手动下载新版程序。",
  });
}

export function setupPwaUpdateListener(): void {
  if (pwaSetupDone || typeof window === "undefined") {
    return;
  }

  pwaSetupDone = true;
  reloadPwa = registerSW({
    immediate: true,
    onNeedRefresh() {
      state = {
        ...state,
        platform: "pwa",
        pwaRefreshReady: true,
        dismissedVersion: "",
        message: "新版本已准备好，刷新后即可使用新版程序。",
      };
      writeStorage(DISMISSED_VERSION_STORAGE_KEY, "");
      notifyListeners();
    },
  });
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
    throw new Error("无法读取版本信息。请稍后重试，或打开下载页手动确认。");
  }

  const data = (await response.json()) as Partial<VersionManifest>;
  return validateVersionManifest(data);
}

function validateVersionManifest(data: Partial<VersionManifest>): VersionManifest {
  if (
    !data.latest_version ||
    !data.release_date ||
    !isUpdateChannel(data.channel) ||
    !Array.isArray(data.notes)
  ) {
    throw new Error("版本信息格式有问题，无法判断是否需要更新。");
  }

  return {
    latest_version: normalizeVersion(data.latest_version),
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
    return OFFICIAL_DOWNLOAD_URL;
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "https:" ? parsedUrl.toString() : OFFICIAL_DOWNLOAD_URL;
  } catch {
    return OFFICIAL_DOWNLOAD_URL;
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

function notifyListeners(): void {
  const snapshot = cloneState(state);

  listeners.forEach((listener) => {
    listener(snapshot);
  });
}
