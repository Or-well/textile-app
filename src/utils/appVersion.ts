import packageInfo from "../../package.json";

export const APP_VERSION = normalizeAppVersion(packageInfo.version);

function normalizeAppVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}
