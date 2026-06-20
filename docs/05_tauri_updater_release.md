# Textile 从代码修改到 GitHub Release 的完整发布手册

本文档面向第一次维护和发布 Textile 的人员，说明如何在 Windows 上完成以下完整流程：

1. 修改代码。
2. 维护 `CHANGELOG.md`。
3. 更新应用版本号。
4. 运行测试和构建检查。
5. 提交并推送代码到 GitHub。
6. 使用固定的 Tauri Updater 私钥构建 Windows 安装包和签名。
7. 生成 `latest.json`。
8. 创建 Git tag 和 GitHub Release。
9. 上传安装包、签名和更新清单。
10. 验证首次安装和自动更新。

本文以 **Windows PowerShell、本机手动构建、GitHub 网页发布** 为主流程，并在第 19 节提供 GitHub Actions 自动发布作为补充选择。当前仓库尚未提交 `.github/workflows`；只有按第 19 节添加并启用 workflow 后，GitHub 才会自动构建和上传文件。

---

## 1. 先理解四类不同的东西

### 1.1 程序源代码

程序源代码保存在 Git 仓库中，例如：

```text
src/
src-tauri/
scripts/
package.json
```

它们通过普通 Git commit 和 push 上传到 GitHub 仓库。

### 1.2 GitHub Release

GitHub Release 是面向用户的程序发布页。它通常包含：

- Windows 安装包，例如 `.exe`。
- Tauri Updater 签名文件，例如 `.exe.sig`。
- Tauri Updater 更新清单 `latest.json`。
- 发布说明。

只把代码 push 到 GitHub **不会自动创建 Release**，也不会自动上传安装包。

### 1.3 Web/PWA 更新清单

Web/PWA 使用：

```text
public/version.json
```

该文件由以下命令生成：

```powershell
npm.cmd run version:manifest
```

它用于 Textile Web/PWA 的版本检查。

### 1.4 Tauri 桌面更新清单

Windows 桌面版自动更新使用：

```text
latest.json
```

它发布在 GitHub Release 中，由 `src-tauri/tauri.conf.json` 的 updater endpoint 下载。

`public/version.json` 和 `latest.json` **格式不同、用途不同，不能互相替代**。

### 1.5 用户项目数据

用户的项目文件夹、`.hproj`、普通修改包和项目更新包不属于程序 Release：

- 不要把用户项目打进安装包。
- 不要把 `.hproj` 上传为程序更新。
- Tauri Updater 只更新 Textile 程序，不更新翻译项目内容。

---

## 2. 当前仓库的发布状态

当前版本源是根目录：

```text
package.json
```

版本同步关系：

```text
package.json
  -> src-tauri/tauri.conf.json
  -> src-tauri/Cargo.toml
  -> src-tauri/Cargo.lock 中 textile 自身版本
```

同步命令：

```powershell
npm.cmd run version:sync
```

当前 Tauri 已经具备：

- `tauri-plugin-updater`。
- `tauri-plugin-process`。
- `updater:default` 权限。
- `process:allow-restart` 权限。
- `bundle.createUpdaterArtifacts: true`。
- 应用内更新检查、下载、安装和重启逻辑。

但是在正式配置前，以下字段仍可能为空：

```json
{
  "plugins": {
    "updater": {
      "pubkey": "",
      "endpoints": []
    }
  }
}
```

如果为空：

- `npm.cmd run tauri:release:check` 会失败。
- 已构建程序无法从 GitHub 检查自动更新。
- 正式发布前必须先完成第 5 节的首次配置。

重要：如果旧安装包发布时没有 updater 公钥和 endpoint，该旧版本不能依靠自动更新补上配置。用户需要手动安装第一个正确配置 updater 的版本，之后才能自动更新。

---

## 3. 发布机只需准备一次

以下步骤只需在用于发布的 Windows 电脑上准备一次。

### 3.1 安装 Git

安装 Git for Windows，然后在 PowerShell 检查：

```powershell
git --version
```

第一次使用 Git 时设置身份：

```powershell
git config --global user.name "你的 GitHub 用户名或姓名"
git config --global user.email "你的 GitHub 邮箱"
```

检查：

```powershell
git config --global user.name
git config --global user.email
```

### 3.2 安装 Node.js

安装 Node.js LTS，然后重新打开 PowerShell：

```powershell
node --version
npm --version
```

项目命令在 Windows 文档中统一写成 `npm.cmd`，可以避免某些 PowerShell 执行策略阻止 `npm.ps1`。

### 3.3 安装 Rust

可以通过 `winget` 安装：

```powershell
winget install --id Rustlang.Rustup
```

重新打开 PowerShell，然后选择稳定版 MSVC 工具链：

```powershell
rustup default stable-msvc
rustc --version
cargo --version
```

### 3.4 安装 Microsoft C++ Build Tools

安装 Visual Studio Build Tools，并勾选：

```text
Desktop development with C++
```

Tauri 在 Windows 上需要 MSVC 编译工具。

### 3.5 检查 WebView2

Windows 10 1803 及之后的系统通常已经安装 WebView2。

如果 Tauri 启动或构建报告缺少 WebView2，请安装 Microsoft Edge WebView2 Evergreen Runtime。

### 3.6 MSI 构建失败时检查 VBSCRIPT

当前 `tauri.conf.json` 使用：

```json
{
  "bundle": {
    "targets": "all"
  }
}
```

因此除了 NSIS `.exe`，还可能构建 MSI。MSI 构建依赖 Windows VBSCRIPT 可选功能。

如果出现 `light.exe` 或 VBSCRIPT 相关错误：

1. 打开 Windows 设置。
2. 进入“应用” > “可选功能” > “更多 Windows 功能”。
3. 确认 VBSCRIPT 已启用。

如果团队只发布 NSIS，也可以将 Tauri target 单独调整为 NSIS，但这属于配置变更，不能只为绕过一次构建失败临时修改后忘记提交。

### 3.7 安装项目依赖

进入项目根目录：

```powershell
cd D:\documents\Textile_Project\textile
```

从锁文件安装依赖：

```powershell
npm.cmd ci
```

普通开发可以使用 `npm.cmd install`，正式发布前优先使用 `npm.cmd ci`，这样依赖版本与 `package-lock.json` 一致。

如果 Windows 上 `npm.cmd ci` 报类似下面的错误：

```text
EPERM: operation not permitted, unlink ... node_modules\...\*.node
```

这通常表示 `node_modules` 里的原生模块正在被占用，例如还开着 `npm run dev`、`npm run build`、`tauri dev`、编辑器插件或杀毒扫描。处理顺序：

1. 关闭正在运行的开发服务器、构建、测试和 Tauri 进程。
2. 普通开发场景先运行 `npm.cmd install`，它不会像 `ci` 一样先删除整个 `node_modules`。
3. 如果必须验证正式发布的锁定依赖，重启电脑或换一个干净工作区后再运行 `npm.cmd ci`。

不要为了绕过一次 `EPERM` 手工删除不确定的系统目录；只处理当前仓库下的 `node_modules`，并确认没有进程正在占用。

---

## 4. 第一次把本地仓库连接到 GitHub

如果仓库已经配置 remote，可以跳过本节。

### 4.1 在 GitHub 创建空仓库

1. 登录 GitHub。
2. 点击右上角 `+`。
3. 选择 `New repository`。
4. 填写仓库名。
5. 如果要让普通用户直接下载 Release，建议使用公开仓库。
6. 不要勾选自动创建 README、`.gitignore` 或 License，避免与本地仓库产生无关的首次合并。
7. 点击 `Create repository`。

### 4.2 检查本地是否已经有 remote

```powershell
git remote -v
```

如果没有任何输出，添加 GitHub 仓库：

```powershell
git remote add origin https://github.com/<owner>/<repo>.git
```

将 `<owner>` 替换为 GitHub 用户名或组织名，将 `<repo>` 替换为仓库名。

再次检查：

```powershell
git remote -v
```

### 4.3 首次推送当前分支

先确认当前分支：

```powershell
git branch --show-current
```

推送当前分支：

```powershell
git push -u origin HEAD
```

GitHub 可能要求在浏览器登录，或通过 Git Credential Manager 授权。

如果 push 提示没有权限：

- 检查 remote URL 是否属于自己的仓库。
- 检查 GitHub 登录账号。
- 检查组织仓库是否授予写权限。
- 不要把密码直接写进 remote URL。

---

## 5. 第一次配置 Tauri Updater 签名

这一节只做一次，但生成的私钥以后每个版本都必须继续使用。

### 5.1 updater 签名与 Windows 代码签名不是一回事

Tauri Updater 签名用于：

- 验证自动更新包确实由维护者发布。
- 防止更新包被替换或篡改。

Windows Authenticode 代码签名用于：

- 向 Windows 证明安装包发布者身份。
- 减少 SmartScreen 的“未知发布者”警告。

配置 Tauri Updater 私钥不会自动消除 SmartScreen 警告。没有购买 Windows 代码签名证书时，安装包仍可运行，但用户可能看到安全提示。

### 5.2 生成 updater 密钥

在项目根目录运行：

```powershell
npm.cmd run tauri signer generate -- -w "$env:USERPROFILE\.tauri\textile.key"
```

命令会要求设置私钥密码。请使用密码管理器保存。

通常会得到：

```text
%USERPROFILE%\.tauri\textile.key
%USERPROFILE%\.tauri\textile.key.pub
```

其中：

- `textile.key` 是私钥，绝不能公开。
- `textile.key.pub` 是公钥，可以写入应用配置。

如果 CLI 直接在终端打印公钥，也可以复制终端中显示的公钥。

### 5.3 备份私钥

至少保存两份：

- 发布电脑上的受保护目录。
- 加密的离线备份或密码管理器附件。

不要放入：

- Git 仓库。
- GitHub Release。
- 项目目录。
- `.hproj`。
- 修改包。
- 聊天群和公共网盘。
- `.env` 文件。

如果私钥丢失，已经安装旧版 Textile 的用户将无法验证由新密钥签名的更新。

### 5.4 将公钥写入 Tauri 配置

打开：

```text
src-tauri/tauri.conf.json
```

找到：

```json
{
  "plugins": {
    "updater": {
      "pubkey": "",
      "endpoints": [],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

修改为：

```json
{
  "plugins": {
    "updater": {
      "pubkey": "<粘贴公钥内容>",
      "endpoints": [
        "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

注意：

- `pubkey` 填公钥内容，不是公钥文件路径。
- endpoint 必须是 HTTPS。
- `<owner>` 和 `<repo>` 必须替换。
- 当前 endpoint 使用 GitHub 的最新正式 Release。
- 如果 Release 被标为 prerelease，不能假设 `/releases/latest/` 会选中它。
- 私有仓库的 Release 资源通常不能被普通安装程序匿名下载，不适合当前静态 endpoint 方案。

### 5.5 提交首次 updater 配置

检查配置：

```powershell
npm.cmd run tauri:release:check
```

通过后提交：

```powershell
git status --short
git add src-tauri/tauri.conf.json
git diff --cached
git commit -m "chore: configure Tauri updater"
git push
```

第一个公开安装包必须包含正确的公钥和 endpoint。

---

## 6. 平时修改代码的标准流程

### 6.1 开始修改前更新本地代码

确认当前分支：

```powershell
git branch --show-current
```

确认没有不明修改：

```powershell
git status --short
```

拉取远端更新：

```powershell
git pull --ff-only
```

`--ff-only` 会在本地分支已经分叉时停止，避免新手不小心生成复杂的合并提交。

### 6.2 修改代码

修改过程中按功能运行：

```powershell
npm.cmd run test:unit
npm.cmd run build
```

如果修改桌面能力，再运行：

```powershell
npm.cmd run tauri:dev
```

### 6.3 更新 Changelog

所有用户可见功能、行为变化、兼容性变化、数据语义变化和重要修复都写入：

```text
CHANGELOG.md
```

开发期间写在：

```markdown
## [Unreleased]
```

按实际内容使用：

```markdown
### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security
```

不要记录：

- 纯格式化。
- 无行为变化的内部重构。
- 构建 hash。
- 临时调试过程。
- 尚未完成的计划。

### 6.4 提交代码

先查看：

```powershell
git status --short
git diff
```

不要在没有检查的情况下直接执行 `git add .`。

推荐逐块暂存：

```powershell
git add -p
```

检查将要提交的内容：

```powershell
git diff --cached
```

提交：

```powershell
git commit -m "fix: describe the actual change"
```

推送：

```powershell
git push
```

确认私钥、密码、用户项目和构建产物没有被提交：

```powershell
git status --short
git ls-files | Select-String -Pattern "\.key$|target/|node_modules/|dist/"
```

### 6.5 只把细碎修改推送到 GitHub，不发布新版本

文档修正、测试补充、小范围代码整理或尚未准备发布的功能，可以正常提交并推送到 GitHub，不需要提高应用版本号。

操作：

```powershell
git status --short
git diff

git add -p
git diff --cached

git commit -m "docs: update project documentation"
git push origin HEAD
```

提交信息应按实际内容选择，例如：

```text
docs: update release guide
test: add manual regression cases
fix: correct change package shortcut
refactor: simplify update presentation logic
```

这类普通 push：

- 不运行 `npm.cmd version`。
- 不手工修改 `package.json` 版本号。
- 不运行只为发布准备的版本同步流程。
- 不创建 `v<version>` tag。
- 不创建 GitHub Release。
- 不构建或上传正式安装包。
- 不生成或上传新的 Tauri `latest.json`。

如果修改包含用户可见功能、行为、兼容性、数据语义或重要修复，应把说明写入 `CHANGELOG.md` 的 `[Unreleased]`。纯文档排版、内部重构或测试补充不需要制造 Changelog 噪声。

普通 push 不会触发第 19 节的发布 workflow，因为该 workflow 只监听 `v*` tag。只有明确准备正式发布时，才进入第 7 节的版本发布流程。

---

## 7. 准备一个正式版本

下面示例假设准备发布 `0.2.1`。当前 `0.2.0` 已经写入版本文件时，不要重复运行 `npm version 0.2.0`。

### 7.0 当前要发布的就是 v0.2.0

先检查 GitHub 是否已经存在公开的 `v0.2.0` tag 或 Release。

本地检查：

```powershell
git tag --list "v0.2.0"
```

远端检查：

```powershell
git ls-remote --tags origin "refs/tags/v0.2.0"
```

处理规则：

- 如果 `v0.2.0` 从未公开发布，可以继续使用当前 `0.2.0`。
- 如果 `v0.2.0` 已经公开发布，不要用同一版本号覆盖新代码，应改为 `0.2.1`。
- 如果旧 `v0.2.0` 安装包没有 updater 公钥和 endpoint，已经安装它的用户不能自动更新；应发布更高版本并要求这些用户至少手动安装一次正确配置 updater 的版本。

如果确认当前发布仍是 `0.2.0`：

```powershell
$Version = "0.2.0"

(Get-Content package.json -Raw | ConvertFrom-Json).version
```

输出已经是 `0.2.0` 时，跳过：

```powershell
npm.cmd version $Version --no-git-tag-version
```

直接运行：

```powershell
npm.cmd run version:sync
npm.cmd run version:manifest
```

然后继续第 7.5 节检查 Changelog。不要因为示例写的是 `0.2.1` 就在未决定发布新版本时盲目升级。

### 7.1 选择版本号

Textile 使用语义化版本：

```text
主版本.次版本.修订版本
```

例如：

- `0.2.0 -> 0.2.1`：修复问题，没有明显破坏性变化。
- `0.2.0 -> 0.3.0`：增加一组新功能或较大的行为变化。
- `0.x -> 1.0.0`：准备承诺稳定的正式版本。

版本号必须比已经发布的版本高，否则 Tauri Updater 不会认为它是新版本。

### 7.2 用 npm 修改版本源

设置准备发布的版本：

```powershell
$Version = "0.2.1"
```

更新 `package.json` 和 `package-lock.json`，但暂时不让 npm 自动创建 Git commit 和 tag：

```powershell
npm.cmd version $Version --no-git-tag-version
```

为什么使用 `--no-git-tag-version`：

- npm 默认可能立即创建版本提交和 tag。
- 此时 Changelog、Tauri 版本和构建清单还没检查完成。
- 发布提交应该在所有版本文件和文档都准备好之后统一创建。

### 7.3 同步 Tauri 版本

```powershell
npm.cmd run version:sync
```

该命令同步：

```text
package.json
src-tauri/tauri.conf.json
src-tauri/Cargo.toml
src-tauri/Cargo.lock
```

不要手工分别修改四处版本号。

### 7.4 生成 Web/PWA 版本清单

```powershell
npm.cmd run version:manifest
```

该命令更新：

```text
public/version.json
```

当版本号变化时，`release_date` 会更新为运行命令当天的日期。

### 7.5 将 Changelog 的未发布内容归档

将：

```markdown
## [Unreleased]

### Fixed

- 修复……
```

改成：

```markdown
## [Unreleased]

## [0.2.1] - 2026-06-20

### Fixed

- 修复……
```

要求：

- 保留新的空 `[Unreleased]`，供下一个版本继续记录。
- 日期使用实际发布日期。
- 版本必须与 `package.json` 一致。
- Release 发布说明应从这里整理，不要临时写一份与 Changelog 相互矛盾的说明。

### 7.6 检查所有版本号

```powershell
Select-String -Path package.json -Pattern '"version"'
Select-String -Path package-lock.json -Pattern '"version"' | Select-Object -First 2
Select-String -Path src-tauri\tauri.conf.json -Pattern '"version"'
Select-String -Path src-tauri\Cargo.toml -Pattern '^version ='
Select-String -Path src-tauri\Cargo.lock -Pattern '^name = "textile"$' -Context 0,1
Select-String -Path public\version.json -Pattern '"version"|"latest_version"|"release_date"'
```

它们应显示同一个版本，例如：

```text
0.2.1
```

### 7.7 安装锁定依赖并运行测试

```powershell
npm.cmd ci
npm.cmd run test:unit
npm.cmd run build
```

`npm.cmd run build` 会：

- 再次同步版本。
- 重新生成 `public/version.json`。
- 运行 TypeScript/Vue 类型检查。
- 构建 Web/PWA。

如果构建后 `public/version.json` 变化，应把最终版本提交进去。

### 7.8 运行桌面发布检查

```powershell
npm.cmd run tauri:release:check
```

它会检查：

- `package.json`、`tauri.conf.json` 和 `Cargo.toml` 版本一致。
- updater 公钥不为空。
- 至少有一个 HTTPS updater endpoint。

检查失败时不要绕过。

### 7.9 检查发布差异

```powershell
git status --short
git diff --check
git diff
```

重点确认没有误加入：

- 示例项目测试数据。
- 用户项目文件。
- 密码或私钥。
- `node_modules/`。
- `dist/`。
- `src-tauri/target/`。
- 临时日志。

### 7.10 创建发布准备提交

逐块暂存：

```powershell
git add -p
```

版本文件也可以明确暂存：

```powershell
git add package.json package-lock.json public/version.json
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git add CHANGELOG.md
```

检查：

```powershell
git diff --cached
```

提交：

```powershell
git commit -m "chore: prepare v$Version release"
```

确认发布提交已经包含全部需要的代码：

```powershell
git status --short
git log -1 --oneline
```

发布前工作树应为空。忽略目录中的构建产物不会显示，这是正常的。

---

## 8. 使用 updater 私钥构建正式 Windows 安装包

必须从刚才通过测试的发布提交构建，构建后不要再修改源代码。

### 8.1 设置私钥环境变量

确认私钥存在：

```powershell
Test-Path "$env:USERPROFILE\.tauri\textile.key"
```

应返回：

```text
True
```

把私钥路径放入当前 PowerShell 会话：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\textile.key"
```

如果私钥设置了密码，使用安全输入，避免把密码直接留在命令历史中：

```powershell
$SecurePassword = Read-Host "输入 Tauri updater 私钥密码" -AsSecureString
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Net.NetworkCredential]::new("", $SecurePassword).Password
```

环境变量只对当前 PowerShell 窗口有效。不要写进 `.env`，Tauri 官方也明确说明构建签名不应依赖 `.env`。

### 8.2 再运行发布检查

```powershell
npm.cmd run tauri:release:check
```

### 8.3 构建桌面安装包

```powershell
npm.cmd run tauri:build
```

该命令会：

1. 同步 Tauri 版本。
2. 调用 Tauri build。
3. 通过 Tauri 的 `beforeBuildCommand` 运行 Web build。
4. 构建 Windows 安装包。
5. 因为 `createUpdaterArtifacts` 为 `true`，生成 updater `.sig` 文件。

不要关闭 PowerShell，直到构建明确成功。

### 8.4 找到构建产物

先确认当前 Rust 构建目标：

```powershell
rustc -vV | Select-String '^host:'
```

本文示例按当前常见输出编写：

```text
host: x86_64-pc-windows-msvc
```

因此 `latest.json` 使用 `windows-x86_64`。如果以后改为 Windows ARM64 构建，必须使用实际目标对应的 `windows-aarch64`，不能继续照抄 x64 平台键。

NSIS：

```powershell
Get-ChildItem src-tauri\target\release\bundle\nsis
```

MSI：

```powershell
Get-ChildItem src-tauri\target\release\bundle\msi
```

Windows 下通常会看到类似：

```text
Textile_0.2.1_x64-setup.exe
Textile_0.2.1_x64-setup.exe.sig
Textile_0.2.1_x64_en-US.msi
Textile_0.2.1_x64_en-US.msi.sig
```

具体文件名以实际输出为准。

本手册推荐：

- 普通用户下载 NSIS `.exe`。
- Tauri Updater 也使用同一个 NSIS `.exe`。
- `latest.json` 中使用对应 `.exe.sig` 的内容。

不要把 MSI 的签名放到 NSIS 的 URL 上，也不要混用不同构建产生的安装包和签名。

### 8.5 检查安装包和签名是否成对存在

```powershell
$Installer = Get-ChildItem "src-tauri\target\release\bundle\nsis\*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

$SignaturePath = "$($Installer.FullName).sig"

$Installer.FullName
$SignaturePath
Test-Path $SignaturePath
```

最后一行必须返回：

```text
True
```

读取签名：

```powershell
Get-Content $SignaturePath
```

它应是签名文本，不应为空。

### 8.6 记录安装包哈希

```powershell
Get-FileHash $Installer.FullName -Algorithm SHA256
```

可以把 SHA-256 写进 GitHub Release 说明，方便人工校验下载文件。

### 8.7 清除当前终端中的私钥变量

构建完成后执行：

```powershell
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
$SecurePassword = $null
```

这不会删除私钥文件，只是清除当前 PowerShell 会话里的变量。

---

## 9. 生成 Tauri Updater 的 latest.json

下面脚本会：

- 自动读取 `package.json` 版本。
- 自动找到最新的 NSIS `.exe`。
- 读取对应 `.sig` 的完整内容。
- 生成 `latest.json`。
- 把准备上传的三个文件复制到系统临时目录，避免在仓库留下发布垃圾。

先替换 GitHub 仓库信息：

```powershell
$Owner = "<owner>"
$Repo = "<repo>"
```

必须把尖括号占位符替换成真实值。例如仓库地址是：

```text
https://github.com/Or-well/textile-app
```

则填写：

```powershell
$Owner = "Or-well"
$Repo = "textile-app"
```

运行：

```powershell
$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$Tag = "v$Version"

if (
  [string]::IsNullOrWhiteSpace($Owner) -or
  [string]::IsNullOrWhiteSpace($Repo) -or
  $Owner.Contains("<") -or
  $Owner.Contains(">") -or
  $Repo.Contains("<") -or
  $Repo.Contains(">")
) {
  throw "请先把 Owner 和 Repo 替换为真实 GitHub 仓库信息。"
}

$Installer = Get-ChildItem "src-tauri\target\release\bundle\nsis\*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $Installer) {
  throw "没有找到 NSIS 安装包，请先运行 npm.cmd run tauri:build"
}

if ($Installer.Name -notlike "*$Version*") {
  throw "最新安装包文件名不包含当前版本 $Version，可能选中了旧构建：$($Installer.Name)"
}

$SignaturePath = "$($Installer.FullName).sig"

if (-not (Test-Path $SignaturePath)) {
  throw "没有找到对应签名：$SignaturePath"
}

$Signature = (Get-Content $SignaturePath -Raw).Trim()

if (-not $Signature) {
  throw "签名文件为空：$SignaturePath"
}

$AssetName = $Installer.Name
$EncodedAssetName = [Uri]::EscapeDataString($AssetName)
$DownloadUrl = "https://github.com/$Owner/$Repo/releases/download/$Tag/$EncodedAssetName"
$ReleaseDirectory = Join-Path $env:TEMP "Textile-release-$Version"
$ResolvedTempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd("\") + "\"
$ResolvedReleaseDirectory = [System.IO.Path]::GetFullPath($ReleaseDirectory)

if (
  -not $ResolvedReleaseDirectory.StartsWith(
    $ResolvedTempRoot,
    [System.StringComparison]::OrdinalIgnoreCase
  ) -or
  [System.IO.Path]::GetFileName($ResolvedReleaseDirectory) -ne "Textile-release-$Version"
) {
  throw "拒绝清理预期临时目录以外的路径：$ResolvedReleaseDirectory"
}

if (Test-Path -LiteralPath $ResolvedReleaseDirectory) {
  Remove-Item -LiteralPath $ResolvedReleaseDirectory -Recurse -Force
}

New-Item -ItemType Directory -Path $ResolvedReleaseDirectory | Out-Null
$ReleaseDirectory = $ResolvedReleaseDirectory
Copy-Item $Installer.FullName -Destination $ReleaseDirectory -Force
Copy-Item $SignaturePath -Destination $ReleaseDirectory -Force

$Latest = [ordered]@{
  version = $Version
  notes = "Textile $Version 更新。详细内容见 GitHub Release。"
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $Signature
      url = $DownloadUrl
    }
  }
}

$LatestJson = $Latest | ConvertTo-Json -Depth 5
$LatestJsonPath = Join-Path $ReleaseDirectory "latest.json"
[System.IO.File]::WriteAllText(
  $LatestJsonPath,
  $LatestJson,
  [System.Text.UTF8Encoding]::new($false)
)

Get-ChildItem $ReleaseDirectory
Get-Content $LatestJsonPath
```

脚本会在创建新目录前安全检查目标路径，然后只删除系统临时目录中同版本的旧目录：

```text
%TEMP%\Textile-release-<version>
```

这样重复生成时不会把上一次错误的 `latest.json` 或旧安装包混进本次上传。

正常情况下临时目录包含：

```text
Textile_<version>_x64-setup.exe
Textile_<version>_x64-setup.exe.sig
latest.json
```

可以打开目录：

```powershell
explorer $ReleaseDirectory
```

### 9.1 latest.json 的关键规则

示例：

```json
{
  "version": "0.2.1",
  "notes": "Textile 0.2.1 更新。详细内容见 GitHub Release。",
  "pub_date": "2026-06-20T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<.exe.sig 文件中的完整文本>",
      "url": "https://github.com/<owner>/<repo>/releases/download/v0.2.1/Textile_0.2.1_x64-setup.exe"
    }
  }
}
```

要求：

- `version` 必须是有效语义化版本。
- `pub_date` 使用 RFC 3339/UTC 时间。
- `platforms` 的 Windows 64 位键是 `windows-x86_64`。
- `signature` 是 `.sig` 文件内容，不是路径或下载 URL。
- `url` 指向实际安装包，不是 `.sig`。
- URL 中 tag 和 Git tag 完全一致。
- 文件名与 GitHub Release asset 完全一致。
- 每次构建的签名都可能变化，不能复制上一个版本的签名。

### 9.2 修改更新说明

脚本默认写：

```text
Textile <version> 更新。详细内容见 GitHub Release。
```

可以在生成前修改 `$Latest.notes`，但内容应与 `CHANGELOG.md` 一致。

如果说明很长，保持 `latest.json` 简洁，把完整说明放到 GitHub Release 页面。

### 9.3 临时目录什么时候删除

不要在上传 GitHub Release 前删除 `$ReleaseDirectory`。

完成以下事项后再清理：

1. 三个文件已经上传到 GitHub Release。
2. Release 已正式发布。
3. 第 12 节的远程 `latest.json` 和安装包下载验证已经通过。

删除前先确认目录内容：

```powershell
Get-ChildItem -LiteralPath $ReleaseDirectory
```

安全确认路径仍位于系统临时目录：

```powershell
$ResolvedTempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd("\") + "\"
$ResolvedReleaseDirectory = [System.IO.Path]::GetFullPath($ReleaseDirectory)

if (
  -not $ResolvedReleaseDirectory.StartsWith(
    $ResolvedTempRoot,
    [System.StringComparison]::OrdinalIgnoreCase
  ) -or
  [System.IO.Path]::GetFileName($ResolvedReleaseDirectory) -ne "Textile-release-$Version"
) {
  throw "拒绝删除预期临时目录以外的路径：$ResolvedReleaseDirectory"
}
```

确认无误后删除：

```powershell
Remove-Item -LiteralPath $ResolvedReleaseDirectory -Recurse -Force
```

如果 PowerShell 已关闭、变量丢失，重新构造路径后再删除：

```powershell
$Version = "0.2.0"
$ReleaseDirectory = Join-Path $env:TEMP "Textile-release-$Version"
$ResolvedTempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd("\") + "\"
$ResolvedReleaseDirectory = [System.IO.Path]::GetFullPath($ReleaseDirectory)

if (
  $ResolvedReleaseDirectory.StartsWith(
    $ResolvedTempRoot,
    [System.StringComparison]::OrdinalIgnoreCase
  ) -and
  [System.IO.Path]::GetFileName($ResolvedReleaseDirectory) -eq "Textile-release-$Version"
) {
  Remove-Item -LiteralPath $ResolvedReleaseDirectory -Recurse -Force
} else {
  throw "临时目录路径校验失败，未执行删除。"
}
```

不要删除：

```text
%USERPROFILE%\.tauri\textile.key
%USERPROFILE%\.tauri\textile.key.pub
```

它们是长期使用的 updater 私钥和公钥，不是临时文件。

---

## 10. 推送发布提交、创建 tag 并推送

安装包必须对应一个确定的 Git commit。

### 10.1 确认当前提交和工作树

```powershell
git log -1 --oneline
git status --short
```

工作树应为空。如果 `public/version.json` 又发生变化，先检查、提交并重新构建，不要让 Release 安装包与 Git tag 指向不同代码。

### 10.2 推送发布提交

```powershell
git push origin HEAD
```

### 10.3 确认 tag 不存在

```powershell
git tag --list "v$Version"
```

如果没有输出，可以创建。

如果 tag 已存在：

- 先确认是否已经公开发布。
- 不要随意移动已经公开的 tag。
- 已发布版本有问题时，优先发布新的修订版本，例如 `0.2.2`。

### 10.4 创建带说明的 tag

```powershell
git tag -a "v$Version" -m "Textile v$Version"
```

检查 tag：

```powershell
git show "v$Version" --no-patch
```

### 10.5 推送 tag

```powershell
git push origin "v$Version"
```

现在 GitHub 已经有代码和 tag，但还没有 Release 页面与安装包。

---

## 11. 在 GitHub 网页创建 Release

### 11.1 打开 Release 页面

1. 打开 GitHub 仓库。
2. 点击右侧 `Releases`，或进入仓库顶部相关 Release 入口。
3. 点击 `Draft a new release`。

### 11.2 选择 tag

在 `Choose a tag` 中选择：

```text
v0.2.1
```

必须选择刚才推送的现有 tag。

### 11.3 填写标题

建议：

```text
Textile v0.2.1
```

### 11.4 填写发布说明

从 `CHANGELOG.md` 对应版本复制并整理，例如：

```markdown
## Changed

- 改进……

## Fixed

- 修复……

## SHA-256

`Textile_0.2.1_x64-setup.exe`: `<Get-FileHash 输出>`
```

不要在 Release 说明中承诺尚未实现的功能。

### 11.5 上传 Release assets

从第 9 节的临时目录上传：

```text
Textile_<version>_x64-setup.exe
Textile_<version>_x64-setup.exe.sig
latest.json
```

上传完成后逐个检查文件名。

`.sig` 对自动更新不是独立下载必需项，因为签名文本已经写进 `latest.json`；但建议上传，便于审计和排错。

### 11.6 正式版不要勾选 prerelease

当前 updater endpoint 使用：

```text
/releases/latest/download/latest.json
```

正式稳定版：

- 不要勾选 `Set as a pre-release`。
- 不要保留为 draft。

如果要发布 beta，应该先设计独立 beta endpoint 或发布渠道，不能直接假设稳定版 `/releases/latest/` 会按预期选中 beta。

### 11.7 先复核再发布

发布前检查：

- tag 正确。
- 标题版本正确。
- Release 说明正确。
- `.exe` 版本正确。
- `.exe.sig` 与该 `.exe` 同次构建。
- `latest.json` 的 version 正确。
- `latest.json` 的 URL 文件名正确。
- `latest.json` 的 signature 来自对应 `.sig`。
- 没有上传私钥。
- 没有上传用户项目数据。

确认后点击：

```text
Publish release
```

---

## 12. 发布后立即验证 GitHub 资源

设置仓库信息：

```powershell
$Owner = "<owner>"
$Repo = "<repo>"
```

### 12.1 检查 latest.json 可以公开下载

```powershell
$LatestUrl = "https://github.com/$Owner/$Repo/releases/latest/download/latest.json"
$RemoteLatest = Invoke-RestMethod $LatestUrl
$RemoteLatest | ConvertTo-Json -Depth 5
```

检查：

```powershell
$RemoteLatest.version
$RemoteLatest.platforms."windows-x86_64".url
```

版本必须是刚发布的版本。

### 12.2 检查安装包 URL

```powershell
$InstallerUrl = $RemoteLatest.platforms."windows-x86_64".url
Invoke-WebRequest $InstallerUrl -Method Head
```

应返回成功状态。

如果 GitHub 对 HEAD 请求处理异常，可以实际下载到临时目录：

```powershell
$DownloadPath = Join-Path $env:TEMP "Textile-release-test.exe"
Invoke-WebRequest $InstallerUrl -OutFile $DownloadPath
Get-FileHash $DownloadPath -Algorithm SHA256
```

下载 hash 应与发布机本地安装包 hash 一致。

验证完成后删除测试下载文件：

```powershell
if (
  (Test-Path -LiteralPath $DownloadPath) -and
  [System.IO.Path]::GetFullPath($DownloadPath).StartsWith(
    [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd("\") + "\",
    [System.StringComparison]::OrdinalIgnoreCase
  )
) {
  Remove-Item -LiteralPath $DownloadPath -Force
}
```

### 12.3 检查 Release 页面

确认：

- Release 不是 draft。
- 正式版不是 prerelease。
- 页面 tag 正确。
- 三个资源都可见。
- 安装包可以匿名下载。

---

## 13. 测试首次安装

最好使用没有安装 Textile 的测试电脑、Windows Sandbox 或虚拟机。

1. 从 GitHub Release 页面下载 NSIS `.exe`。
2. 运行安装包。
3. 如果没有 Windows 代码签名证书，可能出现 SmartScreen 提示，这是 Windows 发布者签名问题，不是 Tauri Updater `.sig` 失败。
4. 启动 Textile。
5. 检查设置页显示的应用版本。
6. 创建或打开一个测试项目。
7. 测试基本打开、保存和关闭。

不要用唯一的真实翻译项目做首次安装验证。

---

## 14. 测试自动更新

自动更新必须从较低版本测试到较高版本。

例如测试：

```text
0.2.0 -> 0.2.1
```

### 14.1 前提

旧安装版本必须已经包含：

- 正确的 updater 公钥。
- 正确的 endpoint。

如果旧版本配置为空，它不能自动发现新版本，只能手动下载安装新版本。

### 14.2 测试步骤

1. 在测试机安装旧版本。
2. 确认旧版本号低于 GitHub Release 中的版本。
3. 启动旧版 Textile。
4. 等待启动时更新检查，或在设置页手动检查更新。
5. 确认界面显示新版本号。
6. 点击下载或安装更新。
7. 如果当前存在编辑、导入或导出操作，确认应用会提示等待安全状态，而不是强制覆盖。
8. 完成当前写入操作。
9. 安装更新并重启。
10. 重启后检查版本号已经更新。
11. 打开原有测试项目，确认项目数据仍存在。

Tauri Updater 只替换程序，不应删除用户项目目录。

### 14.3 至少测试两种状态

安全状态：

- 没有正在编辑。
- 没有导入导出。
- 可以直接安装并重启。

阻塞状态：

- 有未完成编辑或导入导出。
- 应显示等待原因。
- 操作结束后才允许安装。

---

## 15. 发布完成后的收尾

### 15.1 确认 GitHub 状态

```powershell
git status --short
git log -1 --oneline
git tag --list --sort=-version:refname | Select-Object -First 5
```

### 15.2 确认 Changelog 保留 Unreleased

文件顶部应类似：

```markdown
# Changelog

## [Unreleased]

## [0.2.1] - 2026-06-20
```

下一个开发周期继续把变化写入 `[Unreleased]`。

### 15.3 不提交构建产物

以下通常由 `.gitignore` 忽略，不提交：

```text
dist/
node_modules/
src-tauri/target/
```

GitHub Release 中的安装包来自本地构建目录，但不进入 Git 历史。

### 15.4 清理发布临时文件

发布和远程验证完成后：

1. 按第 9.3 节删除 `%TEMP%\Textile-release-<version>`。
2. 删除第 12 节下载的 `Textile-release-test.exe`。
3. 清除当前 PowerShell 会话中的签名环境变量。
4. 保留 updater 私钥及其加密备份。

清除签名环境变量：

```powershell
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
$SecurePassword = $null
```

以下目录是可重新生成的构建输出，并已被 Git 忽略：

```text
dist/
src-tauri/target/
```

处理建议：

- `dist/` 会在下一次 Web 构建时覆盖，可以保留。
- `src-tauri/target/` 是 Rust/Tauri 构建缓存，保留可以显著加快下次构建。
- 只有磁盘空间不足且当前 Release 已完成验证时，才考虑清理构建缓存。
- 不要为了“干净”每次都删除 `src-tauri/target/`，这会让下次完整重新编译。

需要释放磁盘空间时，在项目根目录运行：

```powershell
cargo clean --manifest-path src-tauri\Cargo.toml
```

该命令只清理 Tauri/Rust 构建输出，不会删除源码和 updater 私钥。

### 15.5 保存发布记录

建议保存：

- 版本号。
- Git tag。
- Git commit。
- 发布日期。
- 安装包 SHA-256。
- 使用的构建机。
- 自动更新测试结果。

不要在记录中保存私钥或私钥密码。

---

## 16. 每次发布可以直接照抄的命令清单

以下假设：

- updater 已完成首次配置。
- Git remote 已配置。
- 当前准备发布 `0.2.1`。
- 所有功能代码已经完成。

```powershell
cd D:\documents\Textile_Project\textile

git status --short
git pull --ff-only

$Version = "0.2.1"

npm.cmd version $Version --no-git-tag-version
npm.cmd run version:sync
npm.cmd run version:manifest

# 此处手工更新 CHANGELOG.md：
# 把 [Unreleased] 内容归入 [$Version] - YYYY-MM-DD

npm.cmd ci
npm.cmd run test:unit
npm.cmd run build
npm.cmd run tauri:release:check

git status --short
git diff --check
git diff

git add -p
git add package.json package-lock.json public/version.json
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git add CHANGELOG.md

git diff --cached
git commit -m "chore: prepare v$Version release"

$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\textile.key"
$SecurePassword = Read-Host "输入 Tauri updater 私钥密码" -AsSecureString
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Net.NetworkCredential]::new("", $SecurePassword).Password

npm.cmd run tauri:release:check
npm.cmd run tauri:build

Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
$SecurePassword = $null

git status --short
git push origin HEAD

git tag -a "v$Version" -m "Textile v$Version"
git push origin "v$Version"
```

然后执行第 9 节生成 `latest.json`，再按第 11 节创建 GitHub Release。

---

## 17. 常见问题和处理方法

### 17.1 `tauri:release:check` 提示公钥为空

原因：

```text
src-tauri/tauri.conf.json -> plugins.updater.pubkey
```

仍为空。

处理：

1. 按第 5 节生成密钥。
2. 把公钥内容写进配置。
3. 绝不能把私钥写进去。

### 17.2 `tauri:release:check` 提示 endpoint 为空

配置至少一个 HTTPS endpoint：

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

检查 owner/repo 是否正确。

### 17.3 `tauri:build` 提示找不到签名私钥

检查：

```powershell
Test-Path "$env:USERPROFILE\.tauri\textile.key"
$env:TAURI_SIGNING_PRIVATE_KEY
```

重新设置：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\textile.key"
```

### 17.4 私钥密码错误

重新打开 PowerShell，重新设置环境变量。

不要反复修改密钥文件，也不要重新生成一把密钥代替旧密钥。

### 17.5 构建成功但没有 `.sig`

检查：

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  }
}
```

并确认构建时设置了 `TAURI_SIGNING_PRIVATE_KEY`。

### 17.6 latest.json 返回 404

检查：

- Release 是否已经正式发布。
- `latest.json` 是否确实上传。
- Release 是否为 draft。
- endpoint 的 owner/repo 是否正确。
- 仓库是否私有。

### 17.7 latest.json 能下载，但应用说没有更新

检查：

- `latest.json.version` 是否高于已安装版本。
- 是否使用合法语义化版本。
- 已安装旧版是否包含正确 endpoint。
- `/releases/latest/` 是否指向刚发布的正式 Release。

### 17.8 验签失败

最常见原因：

- 用了不同的 updater 私钥。
- `.sig` 来自另一次构建。
- `latest.json` 指向 NSIS `.exe`，却填入 MSI 的签名。
- 上传后替换了安装包，但没有重新生成 `latest.json`。
- 签名文本复制不完整。

正确做法是重新用固定私钥构建，并让安装包、`.sig` 和 `latest.json` 来自同一次构建。

### 17.9 下载失败

检查 `latest.json` 中 URL：

```powershell
$RemoteLatest = Invoke-RestMethod "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
$RemoteLatest.platforms."windows-x86_64".url
```

将 URL 粘贴到无登录状态的浏览器测试。

### 17.10 安装包显示未知发布者

这是 Windows Authenticode 代码签名问题，不是 updater `.sig` 问题。

解决 SmartScreen/发布者身份需要额外配置 Windows 代码签名证书。即使没有 Authenticode 证书，Tauri Updater 仍要求自己的 updater 签名。

### 17.11 Git push 要求密码或失败

GitHub 不接受普通账号密码作为 Git HTTPS 密码。

使用：

- Git Credential Manager 的浏览器登录。
- GitHub CLI `gh auth login`。
- 正确配置的 SSH key。
- Personal Access Token。

新手优先使用 Git for Windows 自带的 Git Credential Manager。

### 17.12 tag 推错了

如果 tag 尚未发布且无人使用，可以谨慎删除后重建：

```powershell
git tag -d "v$Version"
git push origin --delete "v$Version"
```

如果 Release 已公开或用户可能已经下载，不要移动同名 tag。发布新的修订版本。

### 17.13 发布了有严重问题的版本

优先方案：

1. 修复问题。
2. 增加修订版本号。
3. 重新构建。
4. 发布新的正式 Release。

不要用同一个版本号覆盖不同代码，否则用户、签名、hash、tag 和排错记录会全部混乱。

### 17.14 updater 私钥丢失

无法再为旧安装版本发布可验证的更新。

必须：

1. 生成新密钥。
2. 发布包含新公钥的新安装包。
3. 要求用户手动安装该版本。
4. 后续版本再使用新密钥自动更新。

因此私钥备份是发布流程中最重要的长期资产之一。

---

## 18. 最终发布检查清单

### 代码

- [ ] 所有目标功能已完成。
- [ ] `CHANGELOG.md` 已更新。
- [ ] 没有未说明的用户项目或示例数据变化。
- [ ] 没有私钥、密码和凭据。
- [ ] `npm.cmd run test:unit` 通过。
- [ ] `npm.cmd run build` 通过。

### 版本

- [ ] `package.json` 版本正确。
- [ ] `package-lock.json` 根版本正确。
- [ ] `src-tauri/tauri.conf.json` 版本一致。
- [ ] `src-tauri/Cargo.toml` 版本一致。
- [ ] `src-tauri/Cargo.lock` 中 textile 版本一致。
- [ ] `public/version.json` 版本和日期正确。
- [ ] Changelog 发布版本和日期正确。

### Updater

- [ ] `pubkey` 已配置。
- [ ] endpoint 是正确的 HTTPS GitHub 地址。
- [ ] 使用长期保存的同一把私钥。
- [ ] `npm.cmd run tauri:release:check` 通过。
- [ ] NSIS `.exe` 已生成。
- [ ] 对应 `.exe.sig` 已生成。
- [ ] `latest.json` 使用该 `.sig` 的完整内容。
- [ ] `latest.json` URL 指向该 `.exe`。

### Git 和 GitHub

- [ ] 发布提交已 push。
- [ ] tag 与版本一致，例如 `v0.2.1`。
- [ ] tag 指向发布提交。
- [ ] GitHub Release 标题正确。
- [ ] 正式版不是 draft。
- [ ] 正式版没有误标为 prerelease。
- [ ] `.exe`、`.sig`、`latest.json` 均已上传。
- [ ] 下载 URL 可以匿名访问。
- [ ] 发布临时目录和测试下载文件已清理。
- [ ] 签名环境变量已从当前 PowerShell 会话移除。
- [ ] updater 私钥及加密备份仍安全保留。

### 安装测试

- [ ] 新安装正常。
- [ ] 旧版可以发现新版本。
- [ ] 更新包验签通过。
- [ ] 安装并重启成功。
- [ ] 更新后版本号正确。
- [ ] 用户项目数据未受影响。
- [ ] 编辑或导入导出期间的更新安全阻止正常。

---

## 19. 可选方案：使用 GitHub Actions 自动构建和发布

GitHub Actions 是 GitHub 提供的云端自动化服务。采用本节方案后，发布流程变为：

```text
本地完成代码、版本和 Changelog
  -> 推送发布提交
  -> 推送 v<version> tag
  -> GitHub Actions 在 Windows 云端运行测试
  -> 使用 GitHub Secrets 中的 updater 私钥构建和签名
  -> 自动创建草稿 Release
  -> 自动上传安装包、.sig 和 latest.json
  -> 维护者检查草稿并手动发布
```

本节是手动流程的补充选择，不会删除第 8、9、11 节。即使采用 Actions，也应保留手动构建知识用于排错和应急发布。

### 19.1 GitHub Actions 会替代哪些手工步骤

Actions 可以自动完成：

- 创建干净的 Windows 构建环境。
- 安装 Node.js、Rust 和项目依赖。
- 运行单元测试。
- 运行 Web/PWA 构建。
- 运行 Tauri 发布配置检查。
- 构建 NSIS 和 MSI。
- 使用 updater 私钥生成 `.sig`。
- 使用 `tauri-action` 创建 GitHub Release 草稿。
- 上传安装包和签名。
- 自动生成并上传 Tauri Updater 的 `latest.json`。

仍需人工完成：

- 修改代码。
- 选择版本号。
- 更新 `CHANGELOG.md`。
- 确认版本文件一致。
- 检查提交内容。
- 创建并推送正确的 Git tag。
- 查看 Actions 日志。
- 检查 Release 草稿中的说明和附件。
- 点击 `Publish release`。
- 验证下载和自动更新。

不要同时让本机流程和 Actions 针对同一个 tag 各自创建 Release。选择 Actions 后，本机不再手工上传同一版本的安装包和 `latest.json`。

### 19.2 使用 Actions 前必须满足的条件

必须先完成：

- GitHub 仓库已经存在并配置为 `origin`。
- `src-tauri/tauri.conf.json` 已填写 updater 公钥。
- updater endpoint 已指向当前 GitHub 仓库。
- 长期使用的 updater 私钥和密码仍然可用。
- `package.json` 是唯一版本源。
- `npm.cmd run tauri:release:check` 在本机可以通过。
- workflow 文件已经提交到即将打 tag 的 commit。

如果 tag 指向的 commit 中没有 workflow 文件，推送该 tag 不会执行这个 workflow。

### 19.3 Actions 使用的密钥

Actions 需要两个 repository secret：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

其中：

- `TAURI_SIGNING_PRIVATE_KEY` 保存 `textile.key` 的完整文件内容，不保存本机路径。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 保存生成私钥时设置的密码。
- 如果私钥没有密码，也可以创建一个空密码 secret，或根据实际 workflow 调整；正式密钥建议设置密码。

不需要手工创建 `GITHUB_TOKEN`。GitHub 会为每次 workflow 自动提供临时 `secrets.GITHUB_TOKEN`。本 workflow 通过：

```yaml
permissions:
  contents: write
```

允许该 token 创建 Release 和上传附件。

### 19.4 将 updater 私钥保存到 GitHub Secrets

1. 打开 GitHub 仓库。
2. 点击 `Settings`。
3. 在左侧进入 `Secrets and variables`。
4. 点击 `Actions`。
5. 点击 `New repository secret`。

添加第一个 secret：

```text
Name: TAURI_SIGNING_PRIVATE_KEY
Secret: textile.key 的完整内容
```

可以在本机把私钥内容临时复制到剪贴板：

```powershell
Get-Content "$env:USERPROFILE\.tauri\textile.key" -Raw | Set-Clipboard
```

粘贴并保存后立即清空剪贴板：

```powershell
Set-Clipboard -Value ""
```

添加第二个 secret：

```text
Name: TAURI_SIGNING_PRIVATE_KEY_PASSWORD
Secret: 私钥密码
```

安全规则：

- 不要把私钥写进 workflow YAML。
- 不要把私钥写进 GitHub Actions variable，必须使用 secret。
- 不要在 workflow 中使用 `Write-Output`、`echo` 或调试命令打印私钥。
- GitHub 保存 secret 后不会再次显示原值；忘记内容时不能从网页取回。
- 本机加密备份仍然必须保留，GitHub Secrets 不能替代长期私钥备份。

### 19.5 创建 workflow 文件

在仓库根目录创建：

```text
.github/workflows/release.yml
```

目录不存在时先创建：

```powershell
New-Item -ItemType Directory -Path ".github\workflows" -Force
```

将以下内容写入 `release.yml`：

```yaml
name: Release Textile

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  release-windows:
    name: Build and release Windows x64
    runs-on: windows-latest
    timeout-minutes: 60

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "lts/*"
          cache: npm

      - name: Set up Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Cache Rust build
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: "./src-tauri -> target"

      - name: Install dependencies
        run: npm ci

      - name: Verify tag matches package version
        shell: pwsh
        run: |
          $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
          $expectedTag = "v$version"
          $actualTag = "${{ github.ref_name }}"

          if ($actualTag -ne $expectedTag) {
            throw "Tag $actualTag does not match package.json version $version."
          }

      - name: Run unit tests
        run: npm run test:unit

      - name: Build Web application
        run: npm run build

      - name: Check generated files are committed
        shell: pwsh
        run: |
          git diff --exit-code

      - name: Check Tauri release configuration
        run: npm run tauri:release:check

      - name: Build signed installers and create draft release
        uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Textile v__VERSION__"
          releaseBody: "See CHANGELOG.md for the complete release notes."
          releaseDraft: true
          prerelease: false
          uploadUpdaterJson: true
          updaterJsonPreferNsis: true
```

该 workflow 有几个重要选择：

- 只响应 `v*` tag，不会在每次普通 push 时发布。
- 只构建 Windows x64，符合当前 Textile 发布目标。
- `npm ci` 严格使用 `package-lock.json`。
- tag 必须与 `package.json` 版本匹配。
- 测试和 Web 构建失败时不会执行发布。
- 构建若修改了未提交的版本清单，`git diff --exit-code` 会阻止发布。
- `releaseDraft: true` 只创建草稿，避免未检查的版本立即公开。
- `uploadUpdaterJson: true` 让 action 自动上传 `latest.json`。
- `updaterJsonPreferNsis: true` 在 NSIS 和 MSI 同时存在时，让 `latest.json` 优先使用 NSIS `.exe`。

`tauri-apps/tauri-action@v1` 是当前 action 主版本。以后升级主版本前应先阅读官方迁移说明，不要无检查改成不存在或行为不同的版本。

### 19.6 为什么让 Release 保持草稿

草稿 Release 不会立即成为公开的最新版本，因此维护者有机会检查：

- 安装包名称和版本。
- `.sig` 是否存在。
- `latest.json` 是否存在。
- `latest.json` 是否引用 NSIS `.exe`。
- Release 标题和 tag。
- 自动生成或手工补充的发布说明。

检查通过后再点击 `Publish release`。发布前，`/releases/latest/download/latest.json` 不会指向这个草稿，这是正常行为。

如果希望 Actions 直接公开，可以将：

```yaml
releaseDraft: true
```

改为：

```yaml
releaseDraft: false
```

不建议新手一开始这样做，因为任何错误附件都会直接进入自动更新渠道。

### 19.7 提交 workflow

先检查：

```powershell
git status --short
git diff -- .github/workflows/release.yml
```

暂存：

```powershell
git add .github/workflows/release.yml
```

检查：

```powershell
git diff --cached
```

提交并推送：

```powershell
git commit -m "ci: add Windows release workflow"
git push origin HEAD
```

第一次加入 workflow 后，先在 GitHub 仓库的 `Actions` 标签确认 `Release Textile` 已出现在左侧 workflow 列表。

### 19.8 Actions 发布时本机仍需做什么

先按第 7 节完成：

- 版本号。
- `version:sync`。
- `version:manifest`。
- Changelog 归档。
- 单元测试。
- Web 构建。
- Tauri 发布检查。
- 发布准备 commit。

推送发布 commit：

```powershell
git push origin HEAD
```

创建并推送 tag：

```powershell
$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version

git tag -a "v$Version" -m "Textile v$Version"
git push origin "v$Version"
```

推送 tag 后，不再在本机执行同版本的：

```text
npm.cmd run tauri:build
手工生成 latest.json
手工创建同名 Release
```

这些工作交给 Actions。

### 19.9 在 GitHub 查看运行状态

1. 打开 GitHub 仓库。
2. 点击 `Actions`。
3. 选择 `Release Textile`。
4. 打开与 tag 对应的运行记录。
5. 点击 `Build and release Windows x64`。
6. 展开失败的 step 查看日志。

正常顺序应包括：

```text
Check out repository
Set up Node.js
Set up Rust
Cache Rust build
Install dependencies
Verify tag matches package version
Run unit tests
Build Web application
Check generated files are committed
Check Tauri release configuration
Build signed installers and create draft release
```

所有步骤变绿后，进入仓库的 `Releases` 页面查看草稿。

### 19.10 检查 Actions 创建的 Release 草稿

草稿中至少应有：

- Windows NSIS `.exe`。
- 对应 `.exe.sig`。
- `latest.json`。
- 可能还有 MSI 和对应签名。

下载或直接查看 `latest.json`，确认：

```text
version 与 package.json 一致
windows-x86_64 存在
url 指向 NSIS .exe
signature 不为空
```

然后：

1. 从 `CHANGELOG.md` 复制当前版本说明。
2. 编辑 Release 标题和正文。
3. 确认不是 prerelease。
4. 点击 `Publish release`。
5. 按第 12、13、14 节验证下载、首次安装和自动更新。

### 19.11 GitHub 仓库的 Actions 权限

workflow 已声明：

```yaml
permissions:
  contents: write
```

如果仍出现：

```text
Resource not accessible by integration
```

在 GitHub 仓库中检查：

1. `Settings`。
2. `Actions`。
3. `General`。
4. 找到 `Workflow permissions`。
5. 根据仓库策略允许 workflow 获得所需写权限。

优先使用 workflow 中的最小权限声明，不要为了排错授予不相关的权限。

### 19.12 Actions 安全规则

- 不要在来自 fork 的 `pull_request` workflow 中使用发布私钥。
- 不要让不受信任的 PR 代码在拥有发布 Secrets 的 job 中运行。
- 发布 workflow 只由维护者推送的版本 tag 触发。
- 保护可以创建 `v*` tag 的账号和凭据。
- 为 GitHub 账号开启双因素认证。
- 只使用可信 action。
- 定期检查 action 主版本更新。
- 对安全要求更高时，将 `uses: owner/action@version` 固定为审查过的完整 commit SHA。
- workflow 日志中不应出现私钥或密码。
- 删除 workflow 文件不会删除 GitHub Secrets，应在不再使用时单独删除 Secrets。

### 19.13 Actions 常见问题

#### tag 与 package.json 不一致

日志显示：

```text
Tag v0.2.1 does not match package.json version 0.2.0.
```

说明 tag 创建错误。不要移动已经公开的 tag。

未公开时可以删除错误 tag，修改版本提交后重新创建：

```powershell
git tag -d "v0.2.1"
git push origin --delete "v0.2.1"
```

#### Secret 未配置

症状：

- Tauri 构建找不到签名私钥。
- 没有生成 `.sig`。
- action 在签名阶段失败。

检查 secret 名称必须完全一致：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

#### 发布配置检查失败

检查：

- `src-tauri/tauri.conf.json` 的 `pubkey`。
- updater `endpoints`。
- 三处版本是否一致。

先在本机运行：

```powershell
npm.cmd run tauri:release:check
```

#### `git diff --exit-code` 失败

说明构建脚本生成了仓库中未提交的变化，常见原因：

- 忘记运行 `version:sync`。
- 忘记运行 `version:manifest`。
- `public/version.json` 没有提交。
- Tauri 版本文件没有同步。

不要删除该检查。回到本机生成并提交这些文件，再发布一个正确 tag。

#### Release 创建失败

常见原因：

- `contents: write` 缺失。
- 仓库 Workflow permissions 限制写入。
- 同 tag 已存在状态不兼容的 Release。
- tag 已被另一个 workflow 或人工流程占用。

#### Actions 成功但自动更新仍看不到新版本

检查：

- Release 是否仍为草稿。
- 是否点击了 `Publish release`。
- 正式 Release 是否误标为 prerelease。
- endpoint 是否指向正确仓库。
- `latest.json` 是否在 Release assets 中。
- `/releases/latest/download/latest.json` 是否可以匿名访问。

### 19.14 手动发布与 Actions 发布如何选择

优先选择 Actions：

- 希望每次都使用干净环境。
- 希望自动生成 `latest.json`。
- 希望减少漏传附件和签名对应错误。
- 多名维护者需要统一发布步骤。

优先选择本机手动发布：

- 第一次配置 updater，需要逐步理解和排错。
- GitHub Actions 暂时不可用。
- 需要验证本机构建环境。
- 需要应急构建或对 action 输出做交叉验证。

无论选择哪种方式，都必须满足：

- 同一版本只对应一个确定 commit。
- 同一 tag 不重复发布不同代码。
- updater 私钥保持一致。
- Changelog 和版本文件一致。
- 发布后实际测试自动更新。

---

## 20. 官方参考资料

- [Tauri 2 Updater](https://v2.tauri.app/plugin/updater/)
- [Tauri Windows 构建前置条件](https://v2.tauri.app/start/prerequisites/)
- [Tauri Windows 代码签名](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri GitHub 发布流水线](https://v2.tauri.app/distribute/pipelines/github/)
- [GitHub 管理远程仓库](https://docs.github.com/en/get-started/git-basics/managing-remote-repositories)
- [GitHub 管理 Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [GitHub Releases 说明](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [GitHub Actions 使用 Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- [GitHub Actions 的 GITHUB_TOKEN](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)
- [tauri-apps/tauri-action](https://github.com/tauri-apps/tauri-action)

当前仓库默认仍以手动流程为准；第 19 节描述的是选择加入 `.github/workflows/release.yml` 后的补充方案。实际提交 workflow 时，应再次对照 Tauri 和 GitHub 的最新官方文档核对 action 主版本、runner 和权限配置。
