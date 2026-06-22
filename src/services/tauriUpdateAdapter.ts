import type {
  DownloadEvent,
  Update,
} from "@tauri-apps/plugin-updater";
import type {
  UpdateChannel,
  VersionManifest,
} from "./appUpdateTypes";
export { isTauriRuntime } from "../utils/tauriRuntime";

export interface DesktopDownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
}

let pendingUpdate: Update | null = null;
let updateDownloaded = false;

export function hasPendingTauriUpdate(): boolean {
  return Boolean(pendingUpdate);
}

export function isTauriUpdateDownloaded(): boolean {
  return updateDownloaded;
}

export async function checkTauriUpdate(
  channel: UpdateChannel,
): Promise<{ available: boolean; manifest?: VersionManifest }> {
  await closePendingUpdate();

  try {
    const { check } = await import("@tauri-apps/plugin-updater");

    pendingUpdate = await check({
      headers: {
        "X-Textile-Update-Channel": channel,
      },
      timeout: 30_000,
    });
  } catch (error) {
    throw new Error(normalizeUpdaterError(error));
  }

  updateDownloaded = false;

  if (!pendingUpdate) {
    return { available: false };
  }

  return {
    available: true,
    manifest: toVersionManifest(pendingUpdate, channel),
  };
}

export async function downloadTauriUpdate(
  onProgress: (progress: DesktopDownloadProgress) => void,
): Promise<void> {
  if (!pendingUpdate) {
    throw new Error("没有待下载的桌面更新，请先检查更新。");
  }

  let downloadedBytes = 0;
  let totalBytes = 0;

  try {
    await pendingUpdate.download((event: DownloadEvent) => {
      if (event.event === "Started") {
        totalBytes = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
      }

      onProgress({
        downloadedBytes,
        totalBytes,
        progress:
          totalBytes > 0
            ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
            : event.event === "Finished"
              ? 100
              : 0,
      });
    });
    updateDownloaded = true;
  } catch (error) {
    throw new Error(normalizeUpdaterError(error));
  }
}

export async function installAndRelaunchTauriUpdate(): Promise<void> {
  if (!pendingUpdate || !updateDownloaded) {
    throw new Error("桌面更新尚未下载完成。");
  }

  try {
    await pendingUpdate.install();
    const { relaunch } = await import("@tauri-apps/plugin-process");

    await relaunch();
  } catch (error) {
    throw new Error(normalizeUpdaterError(error));
  }
}

function toVersionManifest(
  update: Update,
  channel: UpdateChannel,
): VersionManifest {
  const raw = update.rawJson;
  const rawNotes = raw.notes;
  const notes =
    Array.isArray(rawNotes)
      ? rawNotes.filter((note): note is string => typeof note === "string")
      : update.body
        ? update.body.split(/\r?\n/).filter(Boolean)
        : [];

  return {
    version: update.version,
    latest_version: update.version,
    build_id:
      typeof raw.build_id === "string" ? raw.build_id : update.version,
    assets_hash:
      typeof raw.assets_hash === "string" ? raw.assets_hash : update.version,
    schema_version:
      typeof raw.schema_version === "number" ? raw.schema_version : 1,
    release_date: update.date ?? "",
    channel:
      raw.channel === "stable" || raw.channel === "beta"
        ? raw.channel
        : channel,
    critical: raw.critical === true,
    download_url: "",
    notes,
  };
}

async function closePendingUpdate(): Promise<void> {
  if (!pendingUpdate) {
    return;
  }

  try {
    await pendingUpdate.close();
  } finally {
    pendingUpdate = null;
    updateDownloaded = false;
  }
}

function normalizeUpdaterError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("endpoint") ||
    lowerMessage.includes("public key") ||
    lowerMessage.includes("pubkey")
  ) {
    return "桌面自动更新尚未配置发布地址或签名公钥。";
  }

  return message || "桌面更新操作失败。";
}
