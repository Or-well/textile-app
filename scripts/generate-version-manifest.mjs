import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJsonPath = join(root, "package.json");
const versionJsonPath = join(root, "public", "version.json");
const packageInfo = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const previousManifest = readPreviousManifest(versionJsonPath);
const assetsHash = calculateBuildHash([
  "src",
  "public",
  "index.html",
  "vite.config.ts",
  "package.json",
]);
const version = normalizeVersion(packageInfo.version);

const manifest = {
  version,
  latest_version: version,
  build_id: `${version}-${assetsHash.slice(0, 12)}`,
  assets_hash: assetsHash,
  schema_version: 1,
  release_date:
    previousManifest?.latest_version === version && previousManifest.release_date
      ? previousManifest.release_date
      : new Date().toISOString().slice(0, 10),
  channel: previousManifest?.channel === "beta" ? "beta" : "stable",
  critical: previousManifest?.critical === true,
  download_url:
    typeof previousManifest?.download_url === "string"
      ? previousManifest.download_url
      : "",
  notes: Array.isArray(previousManifest?.notes)
    ? previousManifest.notes.filter((note) => typeof note === "string")
    : ["更新 Textile 应用资源。"],
};

writeFileSync(versionJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

function readPreviousManifest(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function calculateBuildHash(paths) {
  const hash = createHash("sha256");

  for (const item of paths) {
    addPathToHash(hash, join(root, item));
  }

  return hash.digest("hex");
}

function addPathToHash(hash, targetPath) {
  if (!existsSync(targetPath)) {
    return;
  }

  const stats = statSync(targetPath);

  if (stats.isDirectory()) {
    const children = readdirSync(targetPath).sort();

    for (const child of children) {
      const childPath = join(targetPath, child);

      if (relative(root, childPath).replaceAll("\\", "/") === "public/version.json") {
        continue;
      }

      addPathToHash(hash, childPath);
    }

    return;
  }

  hash.update(relative(root, targetPath).replaceAll("\\", "/"));
  hash.update("\0");
  hash.update(readFileSync(targetPath));
  hash.update("\0");
}

function normalizeVersion(version) {
  return String(version).trim().replace(/^v/i, "");
}
