# Tauri Updater 发布流程

本文档说明 Textile 桌面版如何通过 GitHub Releases 分发，并让已安装用户通过 Tauri Updater 自动更新。Web / PWA 使用 `public/version.json`；Tauri 桌面版使用 updater endpoint 返回的 `latest.json`，两者格式不同，不能混用。

## 发布边界

- GitHub 仓库保存程序源码。
- GitHub Releases 保存安装包、更新产物、签名文件和 `latest.json`。
- 用户项目数据不进入安装包。项目文件夹、`.hproj`、修改包和项目更新包继续走 Textile 内部协作流程。
- Tauri Updater 只更新 Textile 程序本身，不更新某个翻译项目。

## 首次配置

1. 生成 updater 签名密钥：

```powershell
npm.cmd run tauri signer generate -- -w "$env:USERPROFILE\.tauri\textile.key"
```

2. 将生成出来的公钥写入 `src-tauri/tauri.conf.json`：

```json
"plugins": {
  "updater": {
    "pubkey": "<这里填公钥>",
    "endpoints": [
      "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
    ],
    "windows": {
      "installMode": "passive"
    }
  }
}
```

3. 私钥文件只保存在发布机或 CI 密钥库，不得提交到仓库，不得放进项目文件夹、`.hproj`、修改包或应用存储。
4. 第一个公开安装包必须已经配置好 `pubkey` 和 `endpoints`，否则已安装用户无法通过自动更新补上这些配置。

## 发布前检查

每次发布前只手动修改 `package.json` 的版本号，然后同步桌面配置：

```powershell
npm.cmd run version:sync
```

该脚本会更新 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 中 Textile 自身的版本号。

然后运行：

```powershell
npm.cmd run tauri:release:check
```

该脚本会检查版本号是否一致、updater 公钥是否存在、endpoint 是否为 HTTPS。检查失败时不要绕过，应先修正配置。

## 构建发布包

设置签名私钥：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY="$env:USERPROFILE\.tauri\textile.key"
```

如果私钥有密码，再设置：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>"
```

构建：

```powershell
npm.cmd run tauri:build
```

Windows 常见产物目录：

```text
src-tauri/target/release/bundle/nsis/
src-tauri/target/release/bundle/msi/
```

普通用户优先下载 NSIS `.exe` 安装包。自动更新还需要安装包对应的 `.sig` 文件内容。

## GitHub Release

1. 在 GitHub 仓库进入 Releases。
2. 创建新 release，tag 使用版本号，例如 `v0.1.1`。
3. 上传安装包和对应 `.sig` 文件。
4. 上传 `latest.json`。

`latest.json` 示例：

```json
{
  "version": "0.1.1",
  "notes": "修复导入项目文件预览显示。",
  "pub_date": "2026-06-20T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<粘贴 .sig 文件里的完整内容>",
      "url": "https://github.com/<owner>/<repo>/releases/download/v0.1.1/Textile_0.1.1_x64-setup.exe"
    }
  }
}
```

约束：

- `signature` 是 `.sig` 文件中的文本内容，不是 `.sig` 文件路径。
- `url` 必须是可以直接下载到安装包的 HTTPS 地址。
- 文件名必须与实际上传的 release asset 完全一致。
- 每次发布必须使用同一把 updater 私钥签名，否则旧版本无法验证新版本。
- 私有仓库或受限 release 资源可能导致普通用户无法下载更新。

## 用户安装和更新

首次安装：

1. 用户打开 GitHub Release 页面。
2. 下载 Windows 安装包。
3. 安装并启动 Textile。
4. 如需项目数据，用户另行导入 `.hproj` 或打开本地项目文件夹。

后续更新：

1. 维护者提高版本号并发布新的 GitHub Release。
2. 新 release 上传新的安装包、`.sig` 和 `latest.json`。
3. 已安装用户启动 Textile 后，Tauri Updater 读取 endpoint 的 `latest.json`。
4. 如果发现更高版本，应用下载并安装更新。

## 常见问题

- 自动更新没有反应：先确认已安装版本的 `tauri.conf.json` 在发布时已经配置了 `pubkey` 和 `endpoints`。
- 验签失败：确认使用的是同一把 updater 私钥，并且 `latest.json` 中的 `signature` 来自当前安装包对应的 `.sig` 文件。
- 下载失败：确认 GitHub Release asset 是公开可访问的，`url` 文件名和 tag 路径完全正确。
- 项目数据没有更新：这是预期行为。Tauri Updater 只更新程序；项目数据通过 `.hproj`、普通修改包或签名项目更新包分发。
