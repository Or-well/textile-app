import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_MANIFEST_HASH_PATHS = [
  "src",
  "public",
  "index.html",
  "vite.config.ts",
  "package.json",
];

const TEXT_FILE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".webmanifest",
]);
const TEXT_FILE_NAMES = new Set(["package-lock.json", "package.json"]);
const root = fileURLToPath(new URL("..", import.meta.url));

if (isMainModule()) {
  writeVersionManifest(root);
}

export function writeVersionManifest(rootDirectory) {
  const versionJsonPath = join(rootDirectory, "public", "version.json");
  const manifest = createVersionManifest(rootDirectory);

  writeFileSync(versionJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function createVersionManifest(rootDirectory, now = new Date()) {
  const packageJsonPath = join(rootDirectory, "package.json");
  const versionJsonPath = join(rootDirectory, "public", "version.json");
  const packageInfo = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const previousManifest = readPreviousManifest(versionJsonPath);
  const assetsHash = calculateBuildHash(rootDirectory);
  const version = normalizeVersion(packageInfo.version);

  return {
    version,
    latest_version: version,
    build_id: `${version}-${assetsHash.slice(0, 12)}`,
    assets_hash: assetsHash,
    schema_version: 1,
    release_date:
      previousManifest?.latest_version === version && previousManifest.release_date
        ? previousManifest.release_date
        : now.toISOString().slice(0, 10),
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
}

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

export function calculateBuildHash(
  rootDirectory,
  paths = DEFAULT_MANIFEST_HASH_PATHS,
) {
  const hash = createHash("sha256");

  for (const item of paths) {
    addPathToHash(hash, rootDirectory, join(rootDirectory, item));
  }

  return hash.digest("hex");
}

function addPathToHash(hash, rootDirectory, targetPath) {
  if (!existsSync(targetPath)) {
    return;
  }

  const stats = statSync(targetPath);

  if (stats.isDirectory()) {
    const children = readdirSync(targetPath).sort();

    for (const child of children) {
      const childPath = join(targetPath, child);

      if (
        relative(rootDirectory, childPath).replaceAll("\\", "/") ===
        "public/version.json"
      ) {
        continue;
      }

      addPathToHash(hash, rootDirectory, childPath);
    }

    return;
  }

  hash.update(relative(rootDirectory, targetPath).replaceAll("\\", "/"));
  hash.update("\0");
  hash.update(readHashContent(targetPath));
  hash.update("\0");
}

export function readHashContent(filePath) {
  const content = readFileSync(filePath);

  if (!isTextFileForManifest(filePath)) {
    return content;
  }

  return Buffer.from(content.toString("utf8").replace(/\r\n?/g, "\n"), "utf8");
}

export function isTextFileForManifest(filePath) {
  const fileName = basename(filePath).toLowerCase();
  return (
    TEXT_FILE_NAMES.has(fileName) ||
    TEXT_FILE_EXTENSIONS.has(extname(fileName).toLowerCase())
  );
}

function normalizeVersion(version) {
  return String(version).trim().replace(/^v/i, "");
}

function isMainModule() {
  return normalize(process.argv[1] ?? "") === normalize(fileURLToPath(import.meta.url));
}
