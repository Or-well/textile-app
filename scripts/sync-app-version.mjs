import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJsonPath = join(root, "package.json");
const tauriConfigPath = join(root, "src-tauri", "tauri.conf.json");
const cargoTomlPath = join(root, "src-tauri", "Cargo.toml");
const cargoLockPath = join(root, "src-tauri", "Cargo.lock");

const packageInfo = readJson(packageJsonPath);
const version = normalizeVersion(packageInfo.version);

if (!version) {
  throw new Error("package.json version 不能为空。");
}

syncTauriConfig();
syncCargoToml();
syncCargoLock();

function syncTauriConfig() {
  const config = readJson(tauriConfigPath);
  if (config.version === version) {
    return;
  }

  config.version = version;
  writeIfChanged(tauriConfigPath, `${JSON.stringify(config, null, 2)}\n`);
}

function syncCargoToml() {
  const content = readText(cargoTomlPath);
  const nextContent = replacePackageVersion(content, cargoTomlPath);
  writeIfChanged(cargoTomlPath, nextContent);
}

function syncCargoLock() {
  const content = readText(cargoLockPath);
  let foundPackage = false;
  const nextContent = content.replace(
    /(\[\[package\]\]\r?\nname = "textile"\r?\nversion = )"[^"]+"/,
    (_, prefix) => {
      foundPackage = true;
      return `${prefix}"${version}"`;
    },
  );

  if (!foundPackage) {
    throw new Error("Cargo.lock 中没有找到 textile 包。");
  }

  writeIfChanged(cargoLockPath, nextContent);
}

function replacePackageVersion(content, filePath) {
  const packageHeader = content.match(/^\[package\]\r?$/m);
  if (!packageHeader || packageHeader.index === undefined) {
    throw new Error(`${filePath} 中没有找到 [package] 段。`);
  }

  const packageStart = packageHeader.index;
  const nextSectionIndex = content
    .slice(packageStart + packageHeader[0].length)
    .search(/\r?\n\[[^\]]+\]\r?$/m);
  const packageEnd =
    nextSectionIndex === -1
      ? content.length
      : packageStart + packageHeader[0].length + nextSectionIndex;
  const beforePackage = content.slice(0, packageStart);
  const packageSection = content.slice(packageStart, packageEnd);
  const afterPackage = content.slice(packageEnd);
  let foundVersion = false;
  const nextPackageSection = packageSection.replace(
    /^(\s*version\s*=\s*)"[^"]+"/m,
    (_, prefix) => {
      foundVersion = true;
      return `${prefix}"${version}"`;
    },
  );

  if (!foundVersion) {
    throw new Error(`${filePath} 的 [package] 段中没有找到 version 字段。`);
  }

  return `${beforePackage}${nextPackageSection}${afterPackage}`;
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}

function writeIfChanged(filePath, content) {
  if (readText(filePath) === content) {
    return;
  }

  writeFileSync(filePath, content, "utf8");
}

function normalizeVersion(version) {
  return String(version).trim().replace(/^v/i, "");
}
