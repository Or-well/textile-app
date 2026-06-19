export type UpdateChannel = "stable" | "beta";
export type AppPlatform = "web" | "pwa" | "desktop";
export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "update-available"
  | "downloading"
  | "downloaded"
  | "waiting-for-safe-state"
  | "installing"
  | "restarting"
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
  desktopUpdateDownloaded: boolean;
  canAutoRefresh: boolean;
  refreshBlockedReason: string;
  downloadProgress: number;
  downloadedBytes: number;
  totalBytes: number;
  latestDownloadedAt: string;
  dismissedVersion: string;
  errorMessage: string;
}

