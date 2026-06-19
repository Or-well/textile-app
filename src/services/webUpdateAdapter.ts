import type {
  UpdateChannel,
  VersionManifest,
} from "./appUpdateTypes";

export const WEB_VERSION_MANIFEST_URL = "/version.json";

export async function checkWebUpdate(
  currentVersion: string,
  channel: UpdateChannel,
  previousManifest?: VersionManifest,
): Promise<{ available: boolean; manifest: VersionManifest }> {
  const manifest = await fetchVersionManifest();
  const channelMatches =
    channel === "beta"
      ? manifest.channel === "beta" || manifest.channel === "stable"
      : manifest.channel === "stable";
  const available =
    channelMatches &&
    (compareVersions(manifest.latest_version, currentVersion) > 0 ||
      isDifferentBuild(manifest, previousManifest, currentVersion));

  return { available, manifest };
}

export function hasConfiguredWebDownloadUrl(downloadUrl?: string): boolean {
  return Boolean(getSafeDownloadUrl(downloadUrl));
}

export function openWebDownloadPage(downloadUrl?: string): boolean {
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

function asyncManifestUrl(): string {
  return `${WEB_VERSION_MANIFEST_URL}?t=${Date.now()}`;
}

async function fetchVersionManifest(): Promise<VersionManifest> {
  const response = await fetch(asyncManifestUrl(), { cache: "no-store" });

  if (!response.ok) {
    throw new Error("无法读取版本信息。请稍后重试，或联系负责人确认发布地址。");
  }

  return validateVersionManifest((await response.json()) as Partial<VersionManifest>);
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

function getSafeDownloadUrl(url?: string): string {
  if (!url) {
    return "";
  }

  try {
    const parsedUrl = new URL(url);
    const isExampleUrl =
      parsedUrl.hostname === "github.com" &&
      parsedUrl.pathname.startsWith("/example/");

    return parsedUrl.protocol === "https:" && !isExampleUrl
      ? parsedUrl.toString()
      : "";
  } catch {
    return "";
  }
}

function isDifferentBuild(
  nextManifest: VersionManifest,
  previousManifest: VersionManifest | undefined,
  currentVersion: string,
): boolean {
  return Boolean(
    previousManifest &&
      nextManifest.latest_version === currentVersion &&
      previousManifest.build_id !== nextManifest.build_id,
  );
}

function compareVersions(left: string, right: string): number {
  const leftParts = toVersionParts(left);
  const rightParts = toVersionParts(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue !== rightValue) {
      return leftValue > rightValue ? 1 : -1;
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

function isUpdateChannel(value: unknown): value is UpdateChannel {
  return value === "stable" || value === "beta";
}

