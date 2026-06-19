import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const cargoToml = fs.readFileSync(
  path.join(root, "src-tauri", "Cargo.toml"),
  "utf8",
);
const cargoVersion = cargoToml.match(
  /^\s*version\s*=\s*"([^"]+)"\s*$/m,
)?.[1];
const updater = tauriConfig.plugins?.updater;
const errors = [];

if (
  packageJson.version !== tauriConfig.version ||
  packageJson.version !== cargoVersion
) {
  errors.push(
    `版本不一致：package.json=${packageJson.version}，tauri.conf.json=${tauriConfig.version}，Cargo.toml=${cargoVersion ?? "缺失"}`,
  );
}

if (!updater?.pubkey?.trim()) {
  errors.push("Tauri Updater 尚未配置签名公钥。");
}

if (
  !Array.isArray(updater?.endpoints) ||
  updater.endpoints.length === 0 ||
  updater.endpoints.some(
    (endpoint) =>
      typeof endpoint !== "string" || !endpoint.startsWith("https://"),
  )
) {
  errors.push("Tauri Updater 必须至少配置一个 HTTPS endpoint。");
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("Tauri 发布配置检查通过。");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

