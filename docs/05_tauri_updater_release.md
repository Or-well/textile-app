# Tauri Updater 发布

桌面自动更新使用 Tauri Updater。Web / PWA 继续使用 `public/version.json`，两套清单不要混用。

## 首次配置

1. 运行 `npm run tauri signer generate -- -w <安全目录>/textile.key`。
2. 将公钥内容写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
3. 将 HTTPS 更新清单地址写入 `plugins.updater.endpoints`。
4. 私钥只保存在发布机或 CI 密钥库，不得放入仓库、项目包或应用存储。

## 每次发布

1. 同步 `package.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 的版本号。
2. 运行 `npm run tauri:release:check`。
3. 设置 `TAURI_SIGNING_PRIVATE_KEY` 和可选的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
4. 运行 `npm run tauri:build`。
5. 上传安装包、更新产物和对应 `.sig` 文件，再发布 Tauri `latest.json`。

`latest.json` 必须使用 Tauri Updater 格式，包含版本、平台下载 URL 和签名内容。签名字段是 `.sig` 文件内容，不是文件路径。

