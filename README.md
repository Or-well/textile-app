# Textile

## 简介

Textile 是一个面向汉化组和翻译协作团队的本地优先项目管理工具。项目正文、成员、任务、术语、批注和协作记录保存在用户选择的本地项目文件夹中，也可以打包为 `.hproj` 项目文件。

Textile 不依赖业务服务器，适合离线工作、小团队协作、负责人集中合并修改以及需要保留本地数据控制权的场景。

## 适用场景

- 视觉小说、游戏脚本、字幕或一般文本的汉化协作。
- 翻译、校对、审核、术语和发布职责分开的团队。
- 不希望部署后端服务，希望项目数据直接保存在本地的团队。
- 通过修改包传递个人修改，由负责人审核和合并的协作方式。

## 核心功能

- 创建、打开和管理本地 Textile 项目。
- 导入 TXT、KS、JSON、JSONL、CSV 源文件并生成词条。
- 编辑译文，执行翻译、校对、审核、退回和争议处理。
- 管理上下文、术语、批注、任务、成员、角色和个人权限。
- 查看翻译、校对、审核和综合进度。
- 导出我的可提交修改、所选任务范围修改、维护修改包和签名项目更新包。
- 预览、验签、检查完整性、处理冲突并导入修改包。
- 导出 JSON、TXT、CSV、KS 成品和检查报告。
- 预览、导入或导出包含项目数据的 `.hproj` 项目包。
- 支持 Web/PWA 更新提示和 Tauri Updater 桌面自动更新。

## 技术栈

- Vue 3 + TypeScript
- Vite 8
- JSZip
- vite-plugin-pwa
- Tauri 2
- 浏览器 File System Access API、IndexedDB、LocalStorage、Web Crypto API

当前项目不使用 `vue-router`。页面由 `src/App.vue` 解析 `window.location.pathname`，并通过 `history.pushState` 和 `popstate` 导航。

## 快速开始

环境要求：

- Node.js 20 或更高版本
- npm
- 开发 Web 版时建议使用支持 File System Access API 的 Chromium 浏览器，例如 Chrome 或 Edge
- 构建 Tauri 桌面版时还需要 Rust 和对应平台的 Tauri 系统依赖

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

构建 Web/PWA：

```bash
npm run build
```

预览构建结果：

```bash
npm run preview
```

启动或构建 Tauri 桌面版：

```bash
npm run tauri:dev
npm run tauri:build
```

## 基本使用流程

1. 在项目启动中心创建项目、打开已有 Textile 项目文件夹，或把 `.hproj` 导入为本地项目文件夹。
2. 使用项目成员名和密码登录。
3. 在“文件”页添加源文件，或更新源文件、导入已有译文。
4. 进入词条编辑页完成翻译、校对、审核、上下文和批注工作。
5. 在“任务”“术语”“统计”页管理协作过程。
6. 普通成员导出我的可提交修改或所选任务范围修改，并交给负责人。
7. 负责人预览、验签、处理冲突并导入成员修改包。
8. 负责人发布签名项目更新包，其他成员接收更新。
9. 发布前导出成品，并定期导出 `.hproj` 项目备份。

## 项目数据与 `.hproj`

普通项目以文件夹形式保存，主要内容包括：

```text
project.json
members.json
source/
entries/
terms/
tasks/
comments/
logs/
exports/
changes/
```

`.hproj` 是包含上述项目数据的 ZIP 类项目包，可用于备份、迁移或分发给其他成员。项目启动中心可以预览 `.hproj` 的项目名称、简介、修订、更新时间、内容规模、成员数、语言方向和导入状态；正式导入时需要选择一个目标位置，Textile 会在该位置创建新的本地项目文件夹，后续编辑都写入这个文件夹。

`.hproj` 不会挂载为可原地修改的真实文件。完成本地编辑后，如需再次分发或备份，请在“导入导出”或“设置 > 协作与备份”中导出新的 Textile 项目备份。

## 协作方式

项目协作以修改包为主，不使用项目 Git 同步：

- 我的可提交修改：普通成员导出自己已分配任务范围内的词条、上下文、争议、批注新增/状态更新/删除事件和任务状态修改；有任务管理权限的成员可导出自己的全部修改。
- 所选任务范围修改：普通成员选择分配给自己的一个或多个任务导出；负责人、管理员或有任务管理权限的成员可以选择其他成员任务。
- 项目更新包：负责人发布带签名的权威项目快照，成员验证后接收。
- 冲突处理：负责人导入普通修改包时选择保留主项目、使用修改包、手动合并或跳过。

程序版本可以通过 Web/PWA 发布页或 GitHub Releases、Tauri Updater 分发，但这与项目数据协作无关。

## 目录结构

```text
src/
  components/       Vue 组件
  model/            数据类型、状态和权限定义
  pages/            页面组件
  services/         项目业务与存储服务
  utils/            时间、ID、JSONL、ZIP 工具
src-tauri/          Tauri 桌面壳与 Updater 配置
examples/           最小示例项目
docs/               用户和技术文档
public/             PWA 静态资源与 Web 版本清单
scripts/            版本清单和发布检查脚本
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | TypeScript 检查并构建 Web/PWA |
| `npm run preview` | 预览 Web 构建结果 |
| `npm run version:manifest` | 重新生成 `public/version.json` |
| `npm run licenses:generate` | 根据锁文件重新生成第三方软件许可证通知 |
| `npm run tauri:dev` | 启动 Tauri 开发版 |
| `npm run tauri:build` | 构建桌面安装包和更新产物 |
| `npm run tauri:release:check` | 检查 Tauri 发布版本、公钥和更新地址 |

## 更多文档

- [用户手册](docs/MANUAL.md)
- [技术文档](docs/TECHNICAL_DOCUMENTATION.md)
- [代码代理开发规范](AGENTS.md)
- [Tauri Updater 发布说明](docs/TAURI_UPDATER_RELEASE.md)

## License

Copyright 2026 Or_well.

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

Third-party software license texts and notices are provided in
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
