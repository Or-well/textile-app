import { spawnSync } from "node:child_process";
import process from "node:process";

if (process.env.TEXTILE_SKIP_FRONTEND_BUILD === "1") {
  console.log("Skipping Tauri beforeBuildCommand frontend build.");
  process.exit(0);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["run", "build"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
