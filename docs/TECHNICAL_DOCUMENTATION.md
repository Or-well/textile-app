# Textile 技术文档

本文档面向维护 Textile 的开发者。它描述当前代码的真实结构、数据流、存储格式、权限、工作流、修改包、更新机制和已知限制。

本文档不是理想架构提案。若早期设计文档与当前代码冲突，以当前代码和本文档为准。

## 0. 文档定位与当前结构索引

相关文档：
- 本文档承接当前实现细节，包括目录结构、文件清单、模块职责、数据流、业务流程、导入导出、权限、统计、签名密钥、更新机制和维护注意事项。
- `docs/MANUAL.md` 是用户手册，面向实际使用者，描述“怎么用”和“遇到提示该怎么办”。
- `README.md` 是项目入口文档，只保留定位、快速开始、常用命令和文档导航。
- 根目录 `CHANGELOG.md` 只记录用户可见功能、行为、兼容性、数据语义和重要修复变化；纯内部整理或只影响学习材料的内容不写入。

当前扫描到的项目结构要点：

- 存在：`src/components/`、`src/composables/`、`src/model/`、`src/pages/`、`src/services/`、`src/utils/`、`src-tauri/`、`tests/unit/`。
- 不存在：`src/views/`、`src/types/`、`docs/vue-typescript-project-tutorial.md`。
- 当前业务类型主要在 `src/model/types.ts`，权限和状态类型在 `src/model/permissions.ts`、`src/model/status.ts`、`src/model/taskStatus.ts` 等文件中。
- 当前页面目录使用 `src/pages/`，没有 `src/views/`。
- 当前路由由 `src/App.vue` 手写解析 URL，没有引入 `vue-router`。
- 当前状态管理没有 Pinia/Vuex；共享项目状态主要由 `App.vue`、页面状态和 service 模块承担。
- 当前有一个 composable：`src/composables/useAppDraft.ts`。
- 当前没有扫描到 `provide(` / `inject(`。
- 当前没有业务后端 API；扫描到的 `fetch` 用于 Web 更新清单检查。

当前源码清单快照：

```text
src/
  App.vue
  main.ts
  env.d.ts
  style.css
  assets/
    hero.png
    vite.svg
    vue.svg
  composables/
    useAppDraft.ts
  model/
    entryExchange.ts
    memberOptions.ts
    permissions.ts
    status.ts
    taskPresentation.ts
    taskStatus.ts
    types.ts
  pages/
    CommentsPage.vue
    CreateProjectPage.vue
    EntriesPage.vue
    EntryPage.vue
    FilesPage.vue
    HomePage.vue
    ImportExportPage.vue
    LoginPage.vue
    ProjectListPage.vue
    ProjectPage.vue
    SettingsPage.vue
    StatsPage.vue
    TasksPage.vue
    TermsPage.vue
  components/
    ChangePreview.vue
    CommentEditor.vue
    CommentListItem.vue
    CommentPanel.vue
    ConflictResolver.vue
    ContextEditDialog.vue
    ContextPanel.vue
    EntryAssistPanel.vue
    EntryEditor.vue
    EntrySideList.vue
    FileImportDialog.vue
    FileListItem.vue
    FileToolbar.vue
    ImportFormatHelp.vue
    KeyManagementPanel.vue
    LauncherActionCard.vue
    ProgressBar.vue
    ProjectLayout.vue
    ProjectPageHeader.vue
    ProjectSidebar.vue
    RecentProjectCard.vue
    SigningKeySetupDialog.vue
    SyncStatusPanel.vue
    TaskEditDialog.vue
    TaskListItem.vue
    TaskPanel.vue
    TermEditDialog.vue
    TermHint.vue
    TermImportDialog.vue
    TermListItem.vue
    UpdateNotice.vue
    settings/
      ClearCacheDialog.vue
      DeleteProjectDialog.vue
      MemberDeletionDialog.vue
      MemberManagementPanel.vue
      MemberPermissionOverrides.vue
      PermissionGroup.vue
      RolePermissionEditor.vue
  services/
    appDraft.ts
    appOperation.ts
    appUpdate.ts
    appUpdatePresentation.ts
    appUpdateTypes.ts
    auth.ts
    cacheMaintenance.ts
    changePackageHash.ts
    changes.ts
    collaboration.ts
    comments.ts
    crypto.ts
    entries.ts
    entryAccess.ts
    entryBatch.ts
    entryExchange.ts
    exporter.ts
    exporters/
      csvExporter.ts
      jsonExporter.ts
      ksExporter.ts
      txtExporter.ts
    helpManual.ts
    history.ts
    keyManager.ts
    permissions.ts
    project.ts
    projectDeletion.ts
    projectFs.ts
    projectPackage.ts
    projectStorage.ts
    projectWritePlan.ts
    pwaUpdateAdapter.ts
    recentProjects.ts
    session.ts
    signingTrustTransition.ts
    stats.ts
    tasks.ts
    tauriUpdateAdapter.ts
    terms.ts
    updateSafety.ts
    webUpdateAdapter.ts
    workspacePosition.ts
  utils/
    appVersion.ts
    browserStorage.ts
    csv.ts
    id.ts
    jsonl.ts
    saveBlob.ts
    tauriRuntime.ts
    time.ts
    zip.ts
src-tauri/
  tauri.conf.json
  Cargo.toml
  build.rs
  capabilities/default.json
  src/main.rs
  src/lib.rs
```

当前配置快照：

- `package.json`：Vue 3.5、TypeScript 6、Vite 8、Vitest、JSZip、vite-plugin-pwa、Tauri API/CLI/Updater/Process。
- `vite.config.ts`：注册 Vue 插件、PWA 插件，并在构建时输出 `THIRD_PARTY_NOTICES.txt`。
- `tsconfig.json`：引用 `tsconfig.app.json` 和 `tsconfig.node.json`。
- `tsconfig.app.json`：检查 `src/**/*.ts`、`src/**/*.tsx`、`src/**/*.vue`，启用未使用变量、未使用参数等检查。
- `tsconfig.node.json`：检查 `vite.config.ts`。
- `vitest.config.ts`：Node 环境，单元测试入口为 `tests/unit/**/*.test.ts`。
- `src-tauri/tauri.conf.json`：桌面窗口、打包资源、Tauri Updater 公钥和 GitHub Releases 更新端点。
- `src-tauri/src/lib.rs`：注册打开内置手册、生成文件保存会话、分块写入、完成保存、取消保存等 Tauri 命令。
- `src-tauri/capabilities/default.json`：启用 core 默认权限、updater 默认权限和 process restart。

## 1. 项目定位与架构原则

Textile 是本地优先、无业务服务器依赖的汉化项目管理工具。核心设计原则：

1. 项目文件由用户掌握，主要保存在本地文件夹中；`.hproj` 用于备份、迁移和分发。
2. Web/PWA 和 Tauri 桌面壳共享 Vue 前端和业务 service。
3. Vue 页面负责交互编排，不直接读写项目文件。
4. service 负责业务规则、权限兜底、数据读取和写入。
5. `projectFs.ts` 抽象普通文件夹和内存项目包。
6. 项目协作使用修改包，不实现项目 Git 同步。
7. 普通成员提交个人修改，负责人集中合并，再发布签名项目更新。
8. 数据格式保持简单、可检查，主要使用 JSON 和 JSONL。
9. 权限是本地协作约束，不是服务器级安全边界。

## 2. 技术栈

前端：

- Vue 3.5
- TypeScript 6
- Vite 8
- Vue Single File Component 和 `<script setup>`

本地与打包：

- File System Access API
- IndexedDB
- LocalStorage
- Web Crypto API
- JSZip

离线和桌面：

- vite-plugin-pwa
- Workbox
- Tauri 2
- Tauri Updater
- Tauri Process 插件

项目没有：

- `vue-router`
- Pinia/Vuex
- 后端 API
- 数据库
- 项目 Git 同步 service

## 3. 运行与构建

安装：

```bash
npm install
```

开发：

```bash
npm run dev
```

Web/PWA 构建：

```bash
npm run build
```

`build` 的实际顺序：

1. `prebuild` 执行 `scripts/sync-app-version.mjs`，把 `package.json` 版本同步到 Tauri 配置。
2. `prebuild` 执行 `scripts/generate-version-manifest.mjs`。
3. 更新 `public/version.json`。
4. `vue-tsc -b` 做 TypeScript 检查。
5. Vite 构建。

预览：

```bash
npm run preview
```

Tauri：

```bash
npm run tauri:dev
npm run tauri:build
npm run tauri:release:check
```

`tauri:release:check` 检查：

- `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 版本一致。
- Tauri Updater 公钥非空。
- 至少配置一个 HTTPS 更新端点。

当前仓库已经配置 Tauri Updater 公钥和 GitHub Releases 更新端点；发布前仍必须运行该检查，防止版本或发布配置回退。

## 4. 目录结构

```text
textile/
  src/
    components/       通用和业务 UI 组件
    model/            类型、状态和权限模型
    pages/            顶层页面
    services/         业务、存储、权限、导入导出
    utils/            ID、时间、JSONL、ZIP 工具
    App.vue            手写路由和应用状态中心
    main.ts            Vue 挂载入口
  src-tauri/           Tauri 壳、能力和 Tauri Updater 配置
  public/              PWA 图标和 Web 版本清单
  scripts/             版本清单与发布检查脚本
  examples/
    simple-project/    最小项目样例
  docs/                设计资料、用户手册和技术文档
  package.json
  vite.config.ts
```



## 5. 应用入口

### `src/main.ts`

职责很小：

```ts
createApp(App).mount("#app");
```

项目没有额外插件注册、全局 store 或 router 实例。

### `src/App.vue`

`App.vue` 是当前应用的组合根：

- 解析 URL。
- 持有当前项目、当前成员、统计摘要、任务数和错误状态。
- 打开项目和恢复最近项目。
- 处理登录、退出和会话恢复。
- 将项目根目录设置到各 service。
- 用 props/emits 分发页面状态。
- 维护 PWA/Tauri 更新安全状态。

## 6. 手写路由机制

路由源：

```ts
const routePath = ref(`${window.location.pathname}${window.location.search}`);
const route = computed(() => parseRoute(routePath.value));
```

导航函数：

- `navigate(path)`：调用 `history.pushState`。
- `replace(path)`：调用 `history.replaceState`。
- `handlePopState()`：浏览器前进后退时重新读取地址。

当前路由：

| 路径 | 页面 |
| --- | --- |
| `/` | 启动时替换为 `/projects` |
| `/home` | 旧入口迁移提示 |
| `/projects` | 项目启动中心 |
| `/projects/create` | 创建项目 |
| `/projects/:projectId` | 项目登录或概览 |
| `/projects/:projectId/overview` | 概览 |
| `/projects/:projectId/files` | 文件 |
| `/projects/:projectId/entries` | 跨文件词条管理 |
| `/projects/:projectId/files/:fileId` | 词条编辑 |
| `/projects/:projectId/tasks` | 任务 |
| `/projects/:projectId/terms` | 术语 |
| `/projects/:projectId/comments` | 批注 |
| `/projects/:projectId/stats` | 统计 |
| `/projects/:projectId/import-export` | 导入导出 |
| `/projects/:projectId/settings` | 设置 |

词条路由 query：

- 词条管理页使用 `file` 预选文件筛选。
- `entry`：目标词条 ID。
- `index`：目标词条序号。
- `tab`：`terms`、`comments`、`context`、`history`。
- `comment`：需要定位的批注 ID。

导入导出路由 query：

- `panel=export`：从项目概览定位到修改包导出区域。
- `panel=import`：从项目概览定位到修改包导入区域，并在有权限时聚焦文件选择控件。
- 两个目标区域使用 `scroll-margin-top` 为工作台粘性顶栏预留空间，路由进入时使用即时滚动，避免标题被遮挡或定位动画被聚焦打断。

当前没有持久化的待合并修改包队列，因此概览不提供“查看待合并修改”入口。

未知顶层路径进入 not-found。未知项目 section 会显示通用占位页。

### 直接刷新恢复

当 URL 指向项目页而内存中没有项目时，`restoreProjectFromRoute()`：

1. 从最近项目列表查找匹配 `projectId` 的记录。
2. 使用记录的 `recordId` 从 IndexedDB 查找文件夹句柄。
3. 检查读写权限。
4. 重新打开项目。
5. 恢复会话。

限制：

- 只支持已保存句柄的普通文件夹项目。
- `.hproj` 预览不会写 IndexedDB；导入成功后保存的是新本地项目文件夹句柄。
- packed `.hproj` 临时打开句柄不会保存在 IndexedDB，直接刷新后不能自动恢复。
- 浏览器撤销授权后必须重新选择文件夹。

### 新增页面的注意点

新增项目内页面至少要同时修改：

- `App.vue` 的 `ProjectSection`。
- `parseRoute()`。
- `App.vue` 模板页面分发。
- `ProjectLayout.vue` 类型。
- `ProjectSidebar.vue` 导航。
- 如涉及更新安全，修改 `updateSafety.ts` 的 section 类型。

不要单独在页面里使用 `history.pushState`，也不要引入 `vue-router`。

## 7. 页面状态传递

项目没有集中式状态库。当前状态由三种方式传递。

### App 层 ref

主要状态：

- `currentProject: OpenedProject | null`
- `currentUser: Member | null`
- `currentStats: BasicProjectStats | null`
- `taskCount`
- `recentProjects`
- 打开、登录、恢复中的 busy 状态

### props 和 emits

例如：

- `FilesPage` 接收 project、root、currentUser，保存后发出 `projectUpdated`。
- `ImportExportPage` 发出 `projectUpdated` 和 `membersUpdated`。
- `SettingsPage` 发出项目、成员、缓存、会话和移除项目事件。
- `TasksPage` 发出 `tasksChanged` 和词条跳转事件。

`App.vue` 负责把子页面结果合并回当前项目。

### service 模块状态

多个 service 使用模块级当前项目根目录：

- `setEntriesProjectRoot`
- `setEntryBatchProjectRoot`
- `setTermsProjectRoot`
- `setTasksProjectRoot`
- `setCommentsProjectRoot`
- `setHistoryProjectRoot`
- `setChangesProjectRoot`
- `setExporterProjectRoot`

`configureProjectServices()` 在打开项目后统一设置这些根目录。

当前用户也由 `permissions.ts` 的模块状态和 LocalStorage 维护。页面通常通过 props 或 `getCurrentUser()` 读取。

风险：

- service 根目录是全局单例，当前架构只适合同时打开一个项目。
- 新增需要项目根目录的 service 时，必须接入 `configureProjectServices()`，否则会出现“请先打开项目”。
- 不要建立第二套互不一致的项目根目录状态。

## 8. 本地项目结构

新建项目创建：

```text
project.json
members.json
source/
entries/
terms/terms.jsonl
tasks/tasks.jsonl
comments/
logs/events.jsonl
exports/releases/
changes/
```

项目包导出识别：

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

项目打开校验当前要求：

- `project.json`
- `members.json`
- `entries/`
- `terms/`
- `tasks/`
- `project.json` 中每个文件的 `entries_path`

`source/`、`comments/`、`logs/`、`exports/`、`changes/` 当前不是打开项目的强制路径，但缺失会影响相关功能或备份完整性。

## 9. `.hproj` 项目包

`.hproj` 由 `projectPackage.ts` 使用 JSZip 生成，本质是 ZIP 类二进制包。

导出：

1. 读取 `project.json`。
2. 读取可选 `members.json`。
3. 递归收集已存在的项目目录。
4. 生成 Blob。
5. 页面通过 `saveGeneratedFile()` 进入可确认结果的保存流程。
6. Tauri 使用原生保存对话框和后端分块写入；Web/PWA 使用 `showSaveFilePicker()`。不支持可靠保存的环境直接返回失败，不触发浏览器原生下载。
7. 只有文件确认写入成功后，才调用 `completeProjectPackageExport()` 清除内存项目 dirty 状态。

预览：

1. 读取 ZIP 中所有二进制文件和目录项。
2. 规范化路径分隔符。
3. 拒绝包含 `..` 的路径。
4. 解析 `project.json` 和可选的 `members.json`。
5. 统计项目简介、修订、更新时间、文件数、成员数、词条数、语言方向、导入状态、缺失路径和推荐导入文件夹名。
6. 不写入任何项目文件。

导入为本地项目：

1. 读取并规范化 `.hproj` 内容。
2. 必须包含 `project.json`、`members.json`、`entries/`、`terms/` 和 `tasks/`。
3. 要求用户选择导入位置。
4. 使用项目名称和项目 ID 生成目标子目录名。
5. 目标子目录已存在时停止导入，不覆盖已有文件。
6. 创建目标目录前解析 `project.json`、`members.json` 和项目数据 JSONL，格式错误时不写入。
7. 创建目标项目文件夹后再次确认目录为空，避免覆盖并发产生的内容。
8. 使用 `ProjectWritePlan` 创建目录并写入包内文件，文件路径稳定排序，`project.json` 最后写入。
9. 每个文件写入后重新读取并逐字节校验，缺失、截断或内容变化都会触发回滚。
10. 包内文件引用的 `entries_path` 缺失时视为不可导入，避免落地后普通项目打开失败。
11. 导入失败时先执行写入计划回滚，再尝试删除目标目录；递归删除失败时按文件、深层目录、目标目录顺序继续清理。
12. 清理后递归扫描目标目录，错误信息报告具体残留路径，而不只报告顶层目录。
13. 调用普通项目打开流程，后续写入都落到本地项目文件夹。

兼容的临时打开：

1. 读取 ZIP 中所有二进制文件和目录项。
2. 必须包含 `project.json`。
3. 构造内存 `ProjectDirectoryHandle`。

重要行为：

- `.hproj` 不会挂载为可原地修改的真实文件。
- 默认工作流是导入为本地项目文件夹，后续写入持久化到该文件夹。
- 内存根目录仅用于兼容的临时打开；写入只更新内存映射，并触发 `hproj-project-dirty` 事件。
- 需要再次分发时，用户导出新的 `.hproj`。
- 如果包缺少 `members.json`，可以解析配置，但没有可登录成员，正常 UI 无法进入工作台。
- 导入回滚是运行期补偿机制，不能保证断电或浏览器进程崩溃后的恢复。

## 10. `project.json`

核心类型是 `ProjectConfig`。

示例：

```json
{
  "schema_version": 1,
  "project_id": "project_xxx",
  "revision": "rev_xxx",
  "revision_hash": "rev_xxx",
  "trust_epoch": 0,
  "name": "样例汉化项目",
  "description": "项目说明",
  "source_language": "ja",
  "target_language": "zh-Hans",
  "files": [
    {
      "id": "script_001",
      "name": "script_001.ks",
      "source_path": "source/script_001.ks",
      "entries_path": "entries/script_001",
      "type": "ks",
      "folder": "主线",
      "hidden": false,
      "locked": false,
      "updated_at": "2026-06-19T00:00:00.000Z"
    }
  ],
  "updated_at": "2026-06-19T00:00:00.000Z",
  "settings": {
    "chunk_size": 500,
    "auto_save": true,
    "allow_change_package": true,
    "workflow": {
      "enable_tasks": true,
      "enable_proofread": true,
      "enable_review": true,
      "proofread_required": 1,
      "review_required": true,
      "allow_self_proofread": false,
      "allow_self_review": false,
      "allow_same_user_multi_proofread": false
    },
    "progress_weights": {
      "translation": 40,
      "proofread": 30,
      "review": 30
    },
    "export": {
      "default_format": "json",
      "only_reviewed": false,
      "include_source": true,
      "include_key": true,
      "include_report": true,
      "include_manifest": true
    },
    "collaboration": {
      "require_signed_change_packages": true
    },
    "role_permissions": {},
    "permission_schema_version": 2
  }
}
```

字段说明：

- `schema_version`：项目格式版本，当前为 1。读取时缺失 schema 按 v1 兼容处理；高于当前支持版本的 schema 会阻止打开。
- `project_id`：跨副本和修改包匹配的稳定 ID。
- `revision`/`revision_hash`：项目更新包的线性基线。
- `trust_epoch`：项目信任代次，可选非负整数，旧项目默认为 0；只有所有可信发布私钥都不可用、必须线下重建信任时递增。
- `files`：项目文件索引。
- `chunk_size`：控制新增、更新源文件和导入译文时每个 entries chunk 的最大词条数；旧的单 chunk 项目仍兼容读取。
- `auto_save`：保留设置，当前编辑仍以显式保存为主。
- `allow_change_package`：项目级开关字段，当前主要能力仍由权限 action 决定。
- `collaboration.require_signed_change_packages`：要求普通、任务和维护修改包带有有效成员签名。新项目默认 `true`；旧项目缺失该字段时按 `false` 兼容读取。
- `enable_tasks`：保存于工作流；为 `false` 时 UI 隐藏任务入口，任务 service 拒绝写入类操作。
- `allow_self_proofread`、`allow_self_review`、`allow_same_user_multi_proofread`：创建项目页可选择并默认勾选允许；旧项目缺失字段时由 `normalizeWorkflowSettings()` 按不允许兼容读取。
- `role_permissions`：项目可覆盖默认角色权限。
- `permission_schema_version`：角色权限配置兼容版本。旧项目缺失时按 v1 读取并补充新增的词条管理默认权限；保存角色权限后写入 v2，之后严格按当前配置生效。

## 11. `members.json`

文件结构：

```json
{
  "schema_version": 1,
  "members": [
    {
      "id": "user_xxx",
      "name": "翻译A",
      "roles": ["translator"],
      "allow_permissions": [],
      "deny_permissions": [],
      "active": true,
      "public_key": "{\"kty\":\"EC\",\"crv\":\"P-256\"}",
      "key_id": "key_xxx",
      "key_created_at": "2026-06-19T00:00:00.000Z",
      "key_revoked_at": "",
      "password_hash": "base64...",
      "password_salt": "base64...",
      "password_updated_at": "2026-06-19T00:00:00.000Z",
      "created_at": "2026-06-19T00:00:00.000Z",
      "updated_at": "2026-06-19T00:00:00.000Z"
    }
  ]
}
```

密码：

- PBKDF2
- SHA-256
- 120,000 次迭代
- 16 字节随机 salt
- 256 位结果

公钥和登录密码字段放在同一成员记录中，但用途完全不同：

- 密码字段用于本地项目登录。
- 公钥字段用于修改包验签。
- 私钥从不写入 `members.json`。
- `active: false` 表示成员被禁用；重新启用只恢复 `active: true`，不重置密码、角色、个人权限或公钥撤销状态。
- 永久删除只允许用于已禁用的非 owner 成员。操作从 `members.json` 移除完整账户记录并清除当前应用内已加载的私钥，但不会改写词条、批注、任务或日志中的成员 ID，也无法删除外部私钥文件。

项目更新包只导出公开成员信息，接收时用本地密码字段合并，避免覆盖本机凭据。

## 12. entries JSONL

路径：

```text
entries/<file_id>/chunk_*.jsonl
```

新写入使用 `chunk_0001.jsonl`、`chunk_0002.jsonl` 等连续编号，并按项目 `settings.chunk_size` 分块。

每行一个 `Entry`：

```json
{"id":"script_001:000001","file_id":"script_001","index":1,"key":"line_000001","speaker":"美咲","source":"今日はいい天気ですね。","target":"今天天气真好。","context":"教室，早晨","status":"reviewed","disputed":false,"assignee":"user_a","translated_by":"user_a","proofread_count":1,"proofread_by":["proofreader_a"],"reviewed_by":"reviewer_a","word_count":10,"hidden":false,"locked":false,"updated_at":"2026-06-19T00:00:00.000Z","updated_by":"reviewer_a"}
```

字段要点：

- `id` 当前通常为 `<file_id>:<6位序号>`。
- `index` 从 1 开始。
- `key` 用于源文件更新和译文导入匹配。
- `word_count` 当前按 Unicode 字符数量计算，不是语言学单词数。
- `status` 只有四种正式值。
- `disputed` 与主状态独立。
- `proofread_by` 当前是数组，旧字符串会规范化为数组。
- `updated_by` 是“我的修改”导出判断的重要依据。

旧数据兼容：

- `status: "disputed"` 会转换为推断出的正式状态，并设置 `disputed: true`。
- 缺少或不一致的 status 可根据 reviewed/proofread/target 字段推断。

## 13. terms JSONL

路径：

```text
terms/terms.jsonl
```

示例：

```json
{"id":"term_001","source":"魔術回路","target":"魔术回路","part_of_speech":"名词","note":"专有名词","variants":["魔術迴路"],"case_sensitive":false,"created_by":"leader","created_at":"2026-06-18T00:00:00.000Z","updated_at":"2026-06-19T00:00:00.000Z"}
```

导入合并：

- 优先按 id。
- 没有 id 时按 source。
- 支持 JSON、JSONL、CSV、XLSX 第一工作表。
- CSV 使用 `utils/csv.ts` 统一解析，支持引号、逗号、转义引号和多行字段。
- 术语目标匹配和成品导出术语报告都遵守 `case_sensitive`。
- 不支持旧 `.xls`。

导出当前只生成 JSONL。

## 14. tasks JSONL

路径：

```text
tasks/tasks.jsonl
```

示例：

```json
{"id":"task_001","type":"translate","title":"翻译第一章","description":"","file_id":"script_001","file_ids":["script_001","script_002"],"range_start":1,"range_end":50,"entry_ids":[],"assignee":"user_a","status":"assigned","target":"","submit_method":"change_package","proofread_round":1,"created_by":"leader","created_at":"2026-06-18T00:00:00.000Z","updated_at":"2026-06-19T00:00:00.000Z","due_at":"2026-06-25T00:00:00.000Z","due_time_zone":"Asia/Tokyo"}
```

状态：

```text
assigned -> in_progress -> submitted -> completed
```

服务还支持取消提交、收回和重新打开动作。旧 `unassigned` 状态仅为兼容保留；普通成员不能自由领取任务，任务负责人由有权限的成员分配。

旧数据兼容：

- `reclaimed` 规范化为 `unassigned`。
- `blocked` 规范化为 `in_progress` 或 `unassigned`。
- 旧 `export` 任务类型规范化为 `custom`。
- `git_hidden` 提交方式规范化为 `change_package`。
- `git_manual` 规范化为 `owner_manual`。
- 旧 `due_at` 若没有 `Z` 或 UTC 偏移，读取时保持原值，不静默推断时区；用户编辑并确认 `due_time_zone` 后才转换为 UTC。

`target` 和 `submit_method` 继续作为兼容字段读写，旧任务原值不会在编辑时丢失；常规创建和编辑任务 UI 不再单独暴露目标和提交方式选择。`TaskPanel` 显示说明时优先使用 `description`，仅在说明为空时用旧 `target` 兜底。

任务范围优先使用 `entry_ids`，其次使用 `file_ids` 表示多个整文件，最后兼容 `file_id` 和起止 index；没有 `file_id` 但包含 `entry_ids` 或 `file_ids` 的任务可以正常计算进度。

`tasks/tasks.jsonl` 不存在时按空任务列表处理；文件存在但读取或 JSONL 解析失败时必须向上报错，不得缓存为空列表，以免后续任务写入覆盖可恢复的数据。

所有新写入的 `due_at` 必须是 UTC ISO 字符串，`due_time_zone` 必须是有效 IANA 时区。`TaskEditDialog` 使用 `utils/time.ts` 在本地墙上时间与 UTC 之间转换，并拒绝夏令时缺失时刻；重复时刻必须显式选择 earlier/later。

## 15. comments JSONL

路径：

```text
comments/<file_id>/<6位entry index>.jsonl
```

示例：

```json
{"id":"comment_001","entry_id":"script_001:000001","file_id":"script_001","user_id":"user_a","body":"这里语气需要调整。","reply_to":null,"status":"open","created_at":"2026-06-19T00:00:00.000Z","updated_at":"2026-06-19T00:00:00.000Z"}
```

支持：

- 根批注和回复。
- open/resolved。
- 删除自己的批注或有权限时删除任意批注。
- 删除父批注时级联删除回复，并在 service 中逐条校验整棵删除树的权限；普通成员不能借由删除自己的父批注删除其他成员的回复。
- 与争议标记联动。

## 16. `logs/events.jsonl`

示例：

```json
{"id":"event_xxx","type":"entry.updated","user_id":"proofreader_a","created_at":"2026-06-19T00:00:00.000Z","entry_id":"script_001:000001","file_id":"script_001","detail":{"operation":"proofread","before_target":"旧译文","after_target":"新译文","before_status":"translated","after_status":"proofread","before_translated_by":"translator_a","after_translated_by":"translator_a","before_proofread_by":[],"after_proofread_by":["proofreader_a"],"before_proofread_count":0,"after_proofread_count":1,"before_reviewed_by":"","after_reviewed_by":""}}
```

字段：

- `type`：自由字符串事件类型。
- `user_id`：操作者。
- 可选 entry/task/file 关联。
- `detail`：结构化附加信息。

词条版本事件：

- `entry.updated`：手工保存、批量译文导入或修改包合并导致译文、状态或工作流审计变化。
- `entry.restored`：恢复某个历史译文版本。
- `detail.operation` 区分 `translation_edit`、`proofread`、`review`、流程回退、`translation_import`、`package_merge` 和 `restore`。
- `detail` 保存译文、状态、译者、校对成员、校对次数和审核成员的完整前后快照。
- 修改包合并生成本地权威版本事件，并通过 `source_event_id`、`package_id` 关联来源；普通包的源词条版本事件不直接复制为本地版本。
- 恢复事件额外保存 `restored_from_event_id` 和 `restored_from_snapshot`，明确恢复的是该事件的修改前或修改后快照。
- 旧日志缺少译文或状态快照时继续作为普通审计事件读取，但不能恢复；仅缺少译者快照时仍可恢复，译者按未知处理。

文件历史事件：

- `file.added`：添加源文件。
- `file.source_updated`：更新源文件。
- `file.translation_imported`：通过文件页导入译文。
- `file.renamed`：重命名文件。
- `file.folder_updated`：修改文件分组。
- `file.hidden` / `file.unhidden`：隐藏或取消隐藏文件。
- `file.locked` / `file.unlocked`：锁定或解锁文件。
- `file.deleted`：删除文件。

`history.ts` 的 `getFileHistory(fileId)` 会按 `event.file_id`、旧日志中的 `entry_id` 文件前缀和 `detail.file_id` 聚合文件相关事件，并映射为只读 `FileHistoryRow`。文件页“更多 > 查看历史”只展示历史，不做恢复或回滚。源文件更新、文件元数据更新和文件删除会把文件事件与业务写入放入同一个 `ProjectWritePlan`；添加源文件也通过写入计划提交 source、entries、`project.json` 和文件事件。

当前日志追加实现会读取整个 JSONL、加入新事件后重写文件。日志很大时会有性能和并发风险。

## 17. `source/`

`source/` 保存导入的原始文本文件。

`ProjectFile.source_path` 指向实际路径。新增文件使用基于唯一 `file_id` 的 source 路径，不依赖显示文件名保持唯一。旧项目中共享同一 `source_path` 的记录仍兼容读取，删除文件时只有不存在其他引用才删除源文件。

添加源文件时会先解析内存内容，再通过 `ProjectWritePlan` 一次提交 source、entries、`project.json` 和 `file.added` 事件。

项目更新包会包含源文件，`.hproj` 也会递归打包 source。

当前 `examples/simple-project` 的 `project.json` 引用了 `source/script_001.ks`，但示例目录没有该文件。这说明示例可以用于部分数据查看，但不是完整备份样例。

## 18. `exports/`

新项目创建 `exports/releases/`，`.hproj` 会打包 `exports/`。

当前成品导出、术语导出、词条交换文件、导入示例文件、身份密钥文件、修改包和项目备份都通过 `utils/saveBlob.ts` 的 `saveGeneratedFile()` 统一保存。Tauri 使用原生保存对话框和 Rust 后端写入；Web/PWA 使用 `showSaveFilePicker()`。无法确认保存结果时返回 `unavailable`，不使用浏览器 `<a download>` 兜底。导出结果不会自动写到项目的 `exports/` 目录，因此该目录目前更接近保留的项目内发布空间，而不是所有导出的自动历史。

## 19. `changes/`

新项目创建 `changes/`，`.hproj` 会打包该目录。

当前普通修改包和项目更新包通过统一可靠保存流程导出、通过文件选择器导入，不会自动归档到 `changes/`。本地“已导出个人修改哈希”保存在浏览器存储，用于接收项目更新前判断未导出修改。

生成修改包 Blob 不会立即写入“已导出个人修改哈希”或推进项目 revision。页面只有收到 `saveGeneratedFile()` 的明确成功结果后才调用 `completeChangePackageExport()`：普通修改包提交导出哈希，项目更新包提交新 revision。提交前会重新确认当前项目 ID 和 base revision，防止延迟确认覆盖已经变化的项目状态。

不要假设 `changes/` 中一定有协作历史。

## 20. `projectFs.ts`

职责：

- 提供统一 `ProjectDirectoryHandle`。
- 适配真实 File System Access API 句柄。
- 适配 `.hproj` 的内存目录。
- 提供 JSON、JSONL、文本、二进制、目录和删除操作。
- 防止 `..` 路径越界。
- 将写操作登记到 `appOperation.ts`，供更新安全机制判断。

主要输入：

- 项目根目录句柄。
- 相对项目路径。
- 文本、对象、JSONL 行或二进制内容。

主要输出：

- 文本、对象、JSONL 数组、文件列表、存在性结果。

主要函数：

- `readTextFile` / `writeTextFile`
- `readBinaryFile` / `writeBinaryFile`
- `readJson` / `writeJson`
- `readJsonl` / `writeJsonl`
- `listFiles`
- `ensureDirectory`
- `fileExists`
- `deleteEntry`
- `createMemoryProjectDirectory`

风险点：

- 不是事务存储。
- 多文件操作需要上层安排安全顺序。
- 内存项目写入不会自动持久化到原 `.hproj`，默认 `.hproj` 导入流程应落地为普通项目文件夹。
- 大 JSONL 文件每次写入都会整体重写。

### `projectStorage.ts`

提供业务 service 使用的 `ProjectStorage` 门面，并通过 `createProjectStorage(root)` 从底层 `ProjectDirectoryHandle` 创建存储实例。

职责：

- 统一普通文件夹和 `.hproj` 内存项目的读写入口。
- 暴露文本、二进制、JSON、JSONL、目录、存在性和删除操作。
- 保留 `root` 作为底层 adapter 兼容出口，供项目包打包、最近项目句柄等低层能力使用。

实现边界：

- 新增业务 service 应优先接收或读取 `ProjectStorage`。
- 不要在页面中直接调用 storage 写项目文件，页面仍应调用 service。
- `projectFs.ts` 只作为底层文件系统 adapter；业务规则、权限和写入顺序仍放在 service。

## 21. `project.ts`

职责：

- 创建和打开项目。
- 读取和保存 project/members。
- 保存角色权限和个人权限覆盖。
- 添加、更新、导入译文、重命名、锁定、隐藏和删除项目文件。
- 校验项目结构。

主要输入：

- `ProjectDirectoryHandle`
- `ProjectConfig`
- 当前成员
- 浏览器 `File`
- 文件或设置 patch

主要输出：

- `OpenedProject`
- 更新后的 `ProjectConfig`
- 成员数组
- 导入统计

读写文件：

- `project.json`
- `members.json`
- `source/*`
- `entries/*`
- `terms/terms.jsonl`
- `tasks/tasks.jsonl`
- `logs/events.jsonl`

调用页面：

- `App.vue`
- `CreateProjectPage`
- `FilesPage`
- `ImportExportPage`
- `SettingsPage`
- 设置子组件

数据一致性：

- 添加源文件先解析，再用同一个写入计划写 source、entries、`project.json` 和文件历史事件。
- 添加失败时尝试删除中间 source/entries，并报告残留。
- 项目初始化、添加源文件、源文件更新、文件删除和普通修改包导入使用 `projectWritePlan.ts` 的补偿式写入计划。
- 写入计划在修改前保存目标文件原始字节，失败时按反序恢复；本次创建的文件和空目录会清理。
- 源文件更新把 entries chunks、source、`project.json` 和 `file.source_updated` 事件放在同一计划，缓存只在提交成功后更新。
- 删除文件逐个记录并删除 entries 文件，最后同时更新 `project.json` 和 `file.deleted` 事件。

已知风险：

- 写入计划是进程内补偿机制，不是断电或浏览器崩溃后的持久化事务。
- 回滚本身若失败会报告恢复失败路径，需要人工检查对应文件。

## 22. `entries.ts`

职责：

- 解析源文件。
- 生成和加载词条。
- 合并源文件更新。
- 导入译文。
- 保存词条和上下文。
- 维护审计字段。
- 记录并恢复手工编辑产生的译文版本。

主要输入：

- file ID、文件名、源文本。
- `Entry`。
- 当前成员和工作流设置。

主要输出：

- `Entry[]`
- 保存后的 `Entry`
- 导入 matched/skipped 统计

读写文件：

- `entries/<file_id>/chunk_*.jsonl`
- 通过 `saveSourceText` 可写源文件

调用位置：

- `FilesPage`
- `EntryPage`
- `CommentsPage`
- `TasksPage` 间接使用
- `stats.ts`
- `changes.ts`

保存规则：

- `entryAccess.ts` 统一合并词条自身和所属文件的 `locked`/`hidden` 状态；文件状态优先，所有关键写入口都从磁盘 `project.json` 重新检查。
- `saveEntry(entry, { actor, workflow })` 需要当前成员。
- 从磁盘找到原词条，再只合并普通保存允许控制的 `target`、`status`、`proofread_by`、`proofread_count`、`reviewed_by` 字段。
- 根据原值和新值判断翻译、校对、审核、回退或普通编辑。
- service 内再次检查权限。
- 普通保存不能顺带修改 `locked`、`hidden`、`assignee` 等管理字段；上下文必须走 `updateEntryContext()`。
- 保存者写入 `updated_by` 和 `updated_at`。
- `applyEntryWorkflowOperation()` 按操作类型计算投影：普通翻译编辑修改译文时重置后续流程；校对修改译文时保留既有校对并追加本轮；审核修改译文时保留校对并完成审核。
- 已审核词条不能直接普通编辑译文，必须先退回到校对阶段。
- 校对增加 proofread user/count。
- 审核写 `reviewed_by`。
- 译文、状态或工作流审计真正变化时创建 `entry.updated` 版本事件；无变化保存不写事件。
- entries chunk 与追加后的 `logs/events.jsonl` 通过同一个 `ProjectWritePlan` 提交，任一写入失败都会恢复两者。
- 保存前若当前 `updated_at` 对应完整版本事件，译者、校对和审核审计以该事件投影为准；旧项目或旧事件缺少完整快照时回退到 Entry 字段。
- 批量译文导入同样通过一个写入计划提交全部 entries chunk 和版本事件。
- `updateEntryAccess()` 使用 `entry.lock` / `entry.hide` 权限修改词条管理状态，并将 entries chunk 与 `entry.access_updated` 事件通过同一写入计划提交。

源 JSON/JSONL 兼容两种语义：

- 旧内容格式没有 `translated_by`、`proofread_count`、`proofread_by`、`reviewed_by` 时，继续按现有宽松规则读取；非空译文默认为 translated，空译文默认为 untranslated，旧文件无需迁移。
- 出现任一上述工作流字段时视为 Textile 词条交换行，要求提供有效 `status`，并严格校验译文、校对次数和成员数组的一致性。`proofread_count` 只接受 0 到 3 的整数，`proofread_by` 可为空表示成员未知，但成员数量不能大于次数。
- 交换行拒绝 `id`、`file_id`、锁定、隐藏、分配、争议和更新时间等管理字段，避免源导入成为管理字段覆盖入口。
- 交换行提供 `index` 时必须为正整数，且同一文件不能重复；旧内容格式仍沿用数组/行顺序，不改变原兼容行为。
- reviewed 允许校对次数为 0，以兼容未启用校对但启用审核的项目；人员字段为空表示未知，不补写当前导入成员。

CSV、TXT、KS 不承载工作流审计。`importEntryTranslations()` 对所有格式都只读取 key/index/target，交换字段不会在译文导入入口生效。

### `entryExchange.ts`

职责：

- 按文件导出 Textile 词条交换 JSON 或 JSONL。
- 只包含 key、index、speaker、source、target、context 和翻译/校对/审核工作流字段。
- 不包含锁定、隐藏、分配、争议、批注、成员权限或私密数据。
- 使用 `file.view` 权限兜底。
- 隐藏文件或包含隐藏词条的文件拒绝导出，避免静默生成不完整交换文件。

交换导出与成品导出相互独立。成品适配器不增加内部审计字段；修改包和 `.hproj` 继续承担协作提交与完整备份职责。

历史恢复：

- `restoreEntryVersion(entryId, eventId, { actor, snapshot })` 只接受带完整快照的 `entry.updated`/`entry.restored` 事件；`snapshot` 为 `before` 或 `after`。
- 历史面板将各事件的修改后快照与最早事件的修改前快照组合为可恢复版本，确保首次记录前的译文不会缺失。
- 恢复权限使用 `entry.edit` 或 `entry.translate`，不复用表示流程退回的 `entry.rollback`。
- 锁定或隐藏词条不能恢复。
- 恢复非空译文后状态为 translated，恢复空译文后状态为 untranslated。
- 清空 `proofread_by`、`proofread_count`、`reviewed_by`；从快照恢复 `translated_by`，当前成员只写入 `updated_by` 和 `updated_at`。
- 旧版本事件缺少译者快照时将 `translated_by` 设为空字符串，表示未知，不能把恢复者误记为译者。
- 保留 `disputed` 及争议说明，不静默解决争议。
- 恢复操作追加 `entry.restored` 事件，不删除或修改后续历史。

上下文：

- `updateEntryContext()` 按新增、修改、删除选择对应权限 action。
- 上下文写回词条 JSONL，不是独立上下文文件。
- 上下文、历史恢复、争议标记和争议解决同样调用有效词条访问检查，不能绕过所属文件状态。

风险点：

- service 内有模块级词条缓存，写入后必须同步更新。
- 某些错误信息仍是英文 `Login required.`、`Permission denied.`。

### `entryBatch.ts`

`entryBatch.ts` 属于词条工作流的批量编排边界，不定义新的主状态，也不复制 `status.ts` 的状态转换。

译文是否可进入工作流统一由 `model/status.ts` 的有效译文判断处理：普通原文要求译文包含可见内容；空白原文允许空白译文进入已翻译、已校对和已审核流程。页面、权限、导入、修改包和统计不应各自手写 `target.trim()`。

公开入口：

- `previewEntryBatch()`：先校验磁盘 `project.json` 的项目 ID，再重新读取词条、历史事件和任务，逐条检查文件锁定/隐藏、任务范围、权限和工作流前置条件，返回可处理词条及跳过原因。
- `executeEntryBatch()`：不信任旧预览，重新完成同一套预检后生成写入计划。

公开批量操作按目标状态表达，包括设为已审核、已校对、已翻译、有争议和无争议。service 内再按词条当前状态解析为审核、校对、回到已翻译、回到已校对、标记争议或解决争议；未翻译但已有译文的词条可通过现有 `translation_edit` 状态函数规范化为已翻译，空译文不能被设为已翻译。校对与审核继续使用首位翻译者、最近一轮首位校对者、多轮校对和争议阻断规则，回到较早状态继续使用既有审计清理语义。

任务启用时，普通成员只允许处理分配给自己且状态为 `assigned` 或 `in_progress` 的任务范围；拥有 `task.manage` 的成员可以跨任务处理。任务关闭时只按词条操作权限判断。

提交时：

1. 按受影响文件生成完整 entries chunk 写入。
2. 为工作流变化生成带同一 `batch_id` 的独立词条版本事件。
3. 争议说明按词条写入批注文件，并生成批注和争议事件。
4. 全部 entries、comments 和 `logs/events.jsonl` 通过同一个 `ProjectWritePlan` 提交。
5. 计划成功后才更新 entries 缓存。

该写入计划提供进程内补偿回滚，但不宣称具备断电事务能力。

## 23. `terms.ts`

职责：

- 术语 CRUD。
- 搜索和原文匹配。
- 检查译文是否使用推荐术语。
- 导入 JSON/JSONL/CSV/XLSX。
- 导出 JSONL。
- 生成示例 XLSX。

主要输入：

- `TermInput`
- 当前 user ID
- 导入 `File`
- 搜索词和词条原文/译文

主要输出：

- `Term`
- `Term[]`
- 导入统计
- 导出 Blob
- 术语命中结果

读写：

- `terms/terms.jsonl`

调用：

- `TermsPage`
- `EntryAssistPanel`
- `exporter.ts` 的术语报告
- `changes.ts`

风险点：

- 导入合并会覆盖同 ID 或同 source 的记录，应在大批量导入前备份。
- 删除是整体 JSONL 重写。
- 权限兜底依赖当前用户和 service permission helper。

## 24. `tasks.ts`

职责：

- 任务 CRUD。
- 分配、提交、取消提交、完成、收回和重新打开。
- `model/taskStatus.ts` 是任务状态转换的唯一规则源，service 校验和页面按钮显示共同调用。
- 旧状态和旧提交方式兼容。
- 计算任务覆盖词条和任务进度。

主要输入：

- `TaskDraft` / `TaskPatch`
- task ID
- user ID
- 项目工作流和权重

主要输出：

- `Task`
- `Task[]`
- `TaskProgress`
- 单文件边界、多文件词条汇总和可打开目标

读写：

- `tasks/tasks.jsonl`

调用：

- `TasksPage`
- `TaskEditDialog`
- `ImportExportPage`
- `App.vue` 读取任务数
- `changes.ts`

进度：

- 根据任务 `entry_ids`、`file_ids` 或 legacy `file_id`/range 获取词条。
- 基础状态统计继续调用 `calculateEntryProgress()`，任务完成比例统一由 `stats.ts` 的 `calculateTaskTypeProgress()` 计算。
- 翻译任务按有效译文计算；校对任务按 `proofread_round` 指定轮次计算；审核任务按 `reviewed` 状态计算。
- 术语和自定义任务返回 `progressAvailable: false`，页面不显示进度条。
- `TaskPanel` 的统计 chips 使用任务完成口径：翻译显示未译/已译，校对显示未校对/已校对，审核显示未审核/已审核，并始终保留争议数量。

范围：

- 多文件选择由 `getTaskFilesEntrySummary()` 返回文件数和总词条数，页面不直接读取项目文件。
- 所选文件按传入顺序、文件内按 index 和 ID 排序组成连续范围。
- 完整范围保存为 `file_ids`；部分范围由 `resolveTaskRangeEntryIds()` 解析为 `entry_ids`，同时保留 `file_ids` 供编辑和筛选使用。
- `entry_ids` 继续拥有最高优先级，旧 `file_ids` 整文件任务和 legacy `file_id`/range 任务保持兼容。
- `getTaskOpenTargets()` 按项目文件顺序返回任务实际覆盖的文件、首条任务词条和词条数；多文件选择弹窗只负责展示和导航。

风险点：

- 整个任务文件每次写入整体重写。
- `enable_tasks === false` 时任务页入口隐藏，任务 service 会拒绝新增、更新、删除、分配、提交、取消提交、完成、收回和重开。
- 已提交任务才能完成；已分配、进行中或已提交任务才能收回；已提交或已完成任务才能重新打开。
- 普通成员自由领取任务的遗留入口不再暴露；任务负责人继续由有分配权限的成员设置。
- 普通修改包将 `due_at` 和 `due_time_zone` 视为任务受保护字段。维护修改包实际修改截止时间时必须同时提供绝对时间和有效 IANA 时区；签名项目更新包可继续承载旧任务，由接收方后续明确迁移。

## 25. `comments.ts`

职责：

- 加载单词条或全项目批注。
- 新增、回复、解决、重新打开、删除。
- 标记和解决词条争议。

主要输入：

- 当前 `Entry`
- 批注内容或 comment ID
- 当前成员

主要输出：

- 批注数组。
- 保存后的批注。
- 更新后的争议词条。

读写：

- `comments/<file_id>/<index>.jsonl`
- 争议操作还会通过 entries service 更新词条。
- 通过 history service 写事件。

调用：

- `CommentPanel`
- `CommentsPage`
- `EntryPage`
- `changes.ts`

展示约束：

- `comments.ts` 返回的批注数组不承担页面显示顺序语义；`CommentPanel` 和 `CommentsPage` 可按由新到旧或由旧到新在展示层排序，不改写 JSONL 顺序。
- 词条争议标记入口由词条编辑流程处理；批注面板只负责新增批注、回复和批注状态操作。

风险点：

- 批注和词条争议是跨文件写入，不是事务。
- 标记争议时如果批注写入和词条写入中途失败，可能需要人工检查。

## 26. `permissions.ts`

权限定义在两层：

- `model/permissions.ts`：action、标签、分组、默认角色权限。
- `services/permissions.ts`：有效权限、当前用户、`can()`、`assertCan()` 和业务封装。

有效权限：

```text
所有角色权限的并集
+ allow_permissions
- deny_permissions
```

`deny_permissions` 优先。

项目可以通过 `settings.role_permissions` 覆盖默认角色权限。旧项目如果完全没有新的修改包 action，兼容逻辑会补足新协议所需权限。缺少 `permission_schema_version` 的旧权限配置还会补充词条锁定和隐藏默认权限；保存后升级为 v2 并严格服从用户配置。

owner 锁定权限：

- project.manage
- member.manage
- role.manage
- project.backup

典型封装：

- `canTranslateEntry`
- `canProofreadEntry`
- `getProofreadBlockReason` / `getProofreadBlockMessage`：统一提供校对按钮判断和用户可见的阻止原因。
- `canReviewEntry`
- `getReviewBlockReason` / `getReviewBlockMessage`：统一提供审核判断和用户可见的阻止原因。
- `canCreateTask`
- `canImportMemberChangePackage`
- `canExportProjectUpdatePackage`
- `canProjectBackup`

注意：

- 页面权限只负责交互体验。
- 关键写 service 应再次 `assertCan()`。
- 不要在组件中用 `roles.includes()` 替代 action。
- 本地权限无法阻止有磁盘访问权的人直接编辑文件。

## 27. 角色系统

角色：

| 角色 | 主要职责 |
| --- | --- |
| owner | 唯一项目负责人，完整管理和发布 |
| admin | 项目、成员、权限和合并管理 |
| tech_lead | 技术维护、文件、合并和发布 |
| translator | 翻译、上下文、批注、普通修改包 |
| proofreader | 校对、回退、批注、普通修改包 |
| reviewer | 审核、争议解决、批注 |
| publisher | 成品发布和相关只读能力 |
| term_manager | 术语管理 |
| readonly | 查看和接收签名项目更新 |

成员可以同时拥有多个角色。

成员个人权限：

- `allow_permissions` 额外增加。
- `deny_permissions` 明确禁止。

管理保护：

- 一个项目只允许一个 owner。
- owner 转让需要明确流程。
- 不能保存让当前操作者失去项目、成员和权限管理能力的配置。
- 不能让项目没有任何可用管理者。

## 28. 词条状态流

正式状态：

```text
untranslated -> translated -> proofread -> reviewed
```

具体流程受工作流设置影响：

- `proofread_required = 0`：不需要校对。
- `proofread_required = 1..3`：累计校对人数/次数。
- `review_required = false`：不要求审核。

争议：

```text
disputed: boolean
```

争议不改变主状态。

状态操作集中在：

- `model/status.ts`
- `services/entries.ts`
- `services/permissions.ts`

不要在页面复制状态推断。

## 29. 校对与审核审计

翻译：

- 当前保存者写 `updated_by`。
- 普通翻译保存、批量导入或普通修改包翻译变更首次产生译文或改变当前译文内容时写 `translated_by`，该字段表示当前有效译文流程的首位翻译者。

校对：

- 当前成员加入 `proofread_by`。
- `proofread_by` 按当前有效译文这一轮校对的发生顺序保存，第一项表示最近一轮校对的首位校对者；旧字符串按单元素数组读取。
- `proofread_count` 增加。
- 未达到要求次数时仍保持 translated 主状态，但 UI 显示校对中。
- 达到次数后进入 proofread。
- 校对时修改译文不会覆盖 `translated_by`。

审核：

- 当前成员写 `reviewed_by`。
- 状态进入 reviewed。
- 审核时修改译文不会覆盖 `translated_by`。

回退：

- reviewed 可退回 proofread。
- proofread 可退回 translated。
- 后续审计字段按状态函数清理或保留。
- 该操作只处理工作流阶段，不恢复旧译文内容；译文内容恢复走历史面板和 `restoreEntryVersion()`。

未显式放开时的限制：

- 不允许当前有效译文流程的首位翻译者校对该译文。
- 不允许最近一轮校对的首位校对者审核自己的校对结果；译者或后续校对者不会仅因此被阻止。
- 不允许同一成员重复完成多轮校对。

这些规则可在创建项目和项目工作流设置中调整；创建项目页默认勾选放开这些限制，旧项目缺失对应字段时仍按上述限制读取。

## 30. `stats.ts`

职责：

- 规范化权重。
- 按工作流统计各阶段进度。
- 提供统一 `BasicProjectStats`。

默认权重：

```text
translation 0.4
proofread 0.3
review 0.3
```

兼容输入：

- 百分数形式 `translation/proofread/review`。
- 小数形式 `translationWeight/proofreadWeight/reviewWeight`。

最终统一除以总和，得到 0 到 1 的归一化权重。

统计公式：

```text
translationRatio = 有非空译文的词条 / 总词条
proofreadRatio = proofread_required > 0 时达到所需校对次数的词条 / 总词条，否则 0
reviewRatio = review_required 时 reviewed / 总词条，否则 0
overall = 三个比例乘归一化权重后相加
```

审核关闭时：

- review weight 强制为 0。
- translation/proofread 重新归一化。
- `completedEntries` 在校对开启时使用校对完成数；校对和审核都关闭时使用有译文词条数。
- UI 应显示“未启用审核”。

校对次数为 0 时：

- proofread weight 强制为 0。
- translation/review 按审核是否开启重新归一化。
- 校对进度为 0，不把禁用阶段计为已完成。

调用：

- `ProjectPage`
- `FilesPage`
- `StatsPage`
- `TasksPage` 间接通过 task service
- `exporter.ts`
- `App.vue`

任何新增统计入口都必须传入 project workflow 和 weights。

## 31. `changes.ts`

这是协作协议的核心 service。

职责：

- 收集修改包内容。
- 构建 manifest。
- 计算稳定内容哈希。
- 可选签名。
- 读取和验证修改包。
- 生成预览和风险提示。
- 检测词条冲突。
- 导入普通、维护和项目更新包。
- 记录导入事件。

修改包模式：

| mode | manifest 类型 | 用途 |
| --- | --- | --- |
| `member_changes` | member_changes | “我的可提交修改”，即当前成员在允许范围内的修改 |
| `task_changes` | member_changes | “所选任务范围修改”，即一个或多个所选任务范围，manifest scopes 带 `task:<id>`；legacy `task_id` 保留首个任务 ID |
| `maintenance_changes` | maintenance_changes | 项目维护数据 |
| `project_update` | project_update | 负责人权威项目更新 |

兼容读取：

- `user_changes`
- `task_changes`
- `legacy`

### 普通成员修改收集

包括：

- 普通成员已分配任务范围内 `updated_by === 当前成员` 的词条、上下文和争议字段。
- 普通成员已分配任务范围内由当前成员创建或更新状态的批注，以及当前成员产生的批注删除事件。
- 当前成员创建的术语。
- 当前成员创建或负责的任务。
- 当前成员事件。

负责人、管理员或有任务管理权限的成员导出 `member_changes` 时可以导出自己全部修改，不受已分配任务范围限制。

上下文写在 Entry 中，因此普通上下文修改通常随 entries 导出。

### 任务修改收集

包括：

- 所选任务范围内由允许成员修改的词条、上下文和争议字段。
- 所选任务范围内的相关批注、批注状态更新和批注删除事件。
- 所选任务行。
- 相关事件。

普通成员只能选择分配给自己的任务。负责人、管理员或有任务管理权限的成员可以选择其他成员的任务，导出时会包含任务负责人在这些任务范围内的相关修改。

### 维护修改

包括：

- 全部术语。
- 独立 contexts 目录内容。
- 全部任务。
- project 配置。
- members。
- 日志。

它可能带来项目设置、成员、权限和凭据变化，必须高风险确认。

### 项目更新

包括：

- 全部 entries。
- 全部 comments。
- 全部 terms。
- contexts。
- source。
- tasks。
- 带新 revision 的 project。
- 公开 members。
- events。

不包括：

- 密码哈希。
- 密码盐。
- 私钥。

项目更新导出成功后，主项目自身的 `project.json` revision 会推进。

## 32. 修改包文件结构

典型结构：

```text
manifest.json
signature.json
entries/
comments/
terms/
contexts/
source/
tasks/
project/
members/
logs/events.jsonl
```

manifest 示例：

```json
{
  "schema_version": 1,
  "project_id": "project_xxx",
  "package_id": "package_xxx",
  "package_type": "member_changes",
  "user_id": "user_a",
  "user_name": "翻译A",
  "created_at": "2026-06-19T00:00:00.000Z",
  "content_hash": "sha256...",
  "app_version": "<package.json version>",
  "source_project_version": "1",
  "base_revision": "rev_xxx",
  "exported_by": "user_a",
  "scopes": ["member_changes"],
  "summary": {
    "changed_entries": 10,
    "changed_comments": 2,
    "changed_terms": 1,
    "changed_contexts": 0,
    "changed_tasks": 0,
    "changed_members": 0,
    "changed_project_settings": 0,
    "changed_credentials": 0,
    "log_events": 5
  }
}
```

项目更新还必须有：

- `base_revision`
- `target_revision`
- 有效 `signature.json`

## 33. 修改包导出流程

1. 读取当前 project。
2. 检查 actor 与 userId 一致。
3. 检查对应导出权限。
4. 根据 mode 收集 payload。
5. 若内容为空，拒绝导出。
6. 对规范化 payload 计算 SHA-256。
7. 构建 manifest。
8. 如果要求签名或导出选项显式要求签名，从内存 key manager 获取私钥。
9. 生成 ZIP Blob。
10. 页面调用 `saveGeneratedFile()` 保存 ZIP。
11. 只有保存明确成功后，member_changes 才记录本次导出内容哈希，project_update 才推进主项目 revision。

普通修改包：

- 当 `settings.collaboration.require_signed_change_packages` 为 `true` 时，member_changes、task_changes 和 maintenance_changes 必须由当前成员签名；缺少签名权限、公钥已撤销、未生成公钥或私钥未加载都会在 `exportChangePackage()` 中拒绝。
- 当该设置为 `false` 或旧项目缺失该设置时，UI 允许成员选择是否签名；选择签名时 `exportChangePackage({ sign: true })` 仍会要求签名权限、有效公钥和已加载私钥，不能静默降级为未签名包。
- 导出页在签名前调用 `getMemberSigningReadiness()`。缺少可用密钥时，`SigningKeySetupDialog` 根据权限提供导入已有私钥或生成新密钥；已有有效公钥但本机未加载私钥时，导入必须匹配当前公钥。
- `project_update` 已有有效公钥但缺少私钥时只允许导入当前旧私钥，不允许在发布流程中直接生成替代密钥。密钥更换必须走由旧密钥签名的轮换过渡包。
- 负责人身份密钥轮换复用 `project_update` 格式：包内公开成员信息可携带新公钥，但 `signature.json` 仍由接收端已信任的旧公钥对应私钥签出。导入端不得使用包内新公钥验证该包自身。

项目更新包：

- 必须签名。
- 当前签名人必须有发布项目更新权限。
- 包内 `project.json.trust_epoch` 必须与接收端当前代次相同；普通项目更新包不能跨信任代次。

## 34. 修改包导入预检查

`validateChangePackage()` 和 `precheckChangePackageImport()` 负责：

- manifest 存在和结构。
- schema_version 支持。
- project_id 匹配。
- content_hash 重新计算。
- signature 状态计算。
- 当前项目要求签名时，非 project_update 修改包必须是 valid 签名；危险导入不能绕过签名要求。
- package 类型和风险。
- 凭据、owner 提升和项目设置变化检测。
- 目标路径是否可读取或创建。
- 冲突列表是否已经生成。
- 普通修改包中的词条受保护字段不能变化；允许参与冲突处理的词条字段限于 `target`、`status`、`translated_by`、`proofread_by`、`proofread_count`、`reviewed_by`、`disputed`、`dispute_reason`、`dispute_resolved_at`、`dispute_resolved_by` 和 `context`。
- 普通成员普通修改包只能携带其已分配任务范围内的词条和批注；负责人、管理员或有任务管理权限的导出者只有在包签名有效时才不受该任务范围限制，未签名包不能仅凭 `manifest.user_id` 获得管理者豁免。
- 普通修改包中的任务只能更新既有任务的执行状态，且普通包只接受 `assigned`、`in_progress`、`submitted` 这类执行中状态；标题、范围、创建者、分配关系、截止时间和截止时区等字段变化会阻止导入。

预检查失败时不开始项目文件写入。

风险级别：

- normal
- maintenance
- danger

内容哈希失败默认拒绝；只有具备危险导入权限且用户确认才允许普通危险导入。项目更新包不允许绕过完整性或签名。

## 35. 普通修改包导入流程

1. 验证包。
2. 检查普通或维护导入权限。
3. 检查维护和 owner 凭据确认。
4. 检查危险导入权限。
5. 检测冲突；普通包会比较译文、状态、译者、校对成员、校对次数、审核成员、上下文、争议字段和批注状态字段。
6. 要求每个冲突有 resolution。
7. 在内存中计算 entries、comments、terms、tasks 和 contexts 的最终内容；普通包根据匹配的词条版本事件决定翻译、校对或审核语义，缺少操作记录的旧包才按普通翻译编辑重置流程。
8. 对负责人最终采用的词条结果生成本地版本事件，记录来源事件和 package ID；普通包的源词条版本事件不直接写成本地权威版本。
9. 普通包词条只合并允许的译文、工作流、上下文和争议字段，`updated_by` 使用包 manifest 用户；普通包批注只合并允许的状态字段或按 `comment.deleted` 事件删除；普通包任务只合并允许的执行状态。
10. 维护包在内存中准备 project/members 最终内容。
11. 去重合并其余包内 events，并生成导入日志事件。
12. 将所有目标文件加入同一个补偿式写入计划。
13. 提交成功后更新 entries 缓存。

当前回滚边界：

- 预检查保证明显错误不会开始写入。
- 运行期写入或删除失败时，已操作文件会恢复到计划执行前的字节内容。
- 新创建文件和隐式创建的空目录会在失败时清理。
- 断电、进程崩溃或回滚阶段再次发生存储错误仍可能需要人工恢复。
- 大型导入前应先导出 `.hproj`。

## 36. 项目更新包导入流程

额外条件：

- actor 有接收项目更新权限。
- 内容完整性必须 passed。
- 签名必须 valid。
- 签名人当前拥有发布权限。
- manifest base revision 等于本地 revision。
- manifest target revision 存在。
- 包内 project ID 和 target revision 一致。
- 当前 actor 没有未导出的个人修改。

写入顺序：

1. entries
2. comments
3. terms
4. contexts
5. source
6. tasks
7. 公开成员与本地密码字段合并
8. 删除项目更新后不再被引用的旧 source、entries chunk 和批注文件
9. events 与导入日志
10. 最后写 `project.json`

上述写入、删除和导入日志通过同一个 `ProjectWritePlan` 提交。把 `project.json` 放在最后，可以让失败时基线 revision 不提前推进，便于重试；断电、浏览器崩溃或回滚再次失败时仍可能留下需要人工检查的残留路径。

## 37. 冲突处理

普通包冲突当前只针对已存在的同 ID 词条，比较：

- target。
- status。

可选 resolution：

- `keep_main`
- `use_package`
- `manual_merge`
- `skip`

手动合并可以指定 target 和 status，`updated_by` 使用包 manifest user。

局限：

- 术语、任务和维护数据没有同等细粒度冲突 UI；批注冲突仅支持保留当前项目或使用修改包版本，不提供正文手工合并。
- 项目更新包没有逐条冲突，使用 revision 和未导出修改保护。

## 38. 签名与验签

算法：

```text
ECDSA P-256 + SHA-256
```

`crypto.ts` 提供：

- 稳定 JSON 序列化。
- SHA-256。
- 生成 key pair。
- 计算 key ID。
- 签名和验签。

`signature.json` 包含：

- schema_version
- package_id
- user_id
- content_hash
- algorithm
- signed_at
- signature
- key_id

签名时不仅按 member ID 查找内存私钥，还要求签名人 ID 等于 manifest user ID，并要求缓存中的公钥和 key ID 与当前成员记录完全一致且未撤销。验签使用接收端 `members.json` 中对应成员当前信任的公钥。

项目更新包还检查签名成员当前是否拥有发布权限，避免仅有历史公钥的人继续发布。

## 39. `keyManager.ts`

职责：

- 生成、轮换和撤销当前成员密钥。
- 撤销其他成员公钥。
- 导出和导入私钥文件。
- 导出和导入公钥登记文件。
- 写成员公钥和事件日志。
- 提供 `getMemberSigningReadiness()` 给修改包导出和 UI 复用，统一区分未生成公钥、密钥已撤销、私钥未加载和可签名状态。

私钥存储：

```ts
interface LoadedSigningPrivateKey {
  privateKey: string;
  publicKey: string;
  keyId: string;
}

const privateKeys = new Map<string, LoadedSigningPrivateKey>();
```

只在当前运行内存中。`getUsableSigningPrivateKey(member)` 和 `hasLoadedPrivateKey(member)` 必须同时验证 member ID、公钥内容、key ID 和未撤销状态，防止成员公钥已经变化但旧缓存仍被用于签名。

`member-key.json`：

```json
{
  "schema_version": 1,
  "kind": "textile.member_key",
  "member_id": "user_xxx",
  "member_name": "翻译A",
  "key_id": "key_xxx",
  "public_key": "{...}",
  "private_key": "{...}",
  "created_at": "2026-06-19T00:00:00.000Z"
}
```

导入时会：

1. 检查 kind/schema/member ID。
2. 重新计算 key ID。
3. 用私钥签名测试 payload。
4. 用公钥验签。
5. 如果项目已有有效公钥，默认拒绝用不同私钥静默替换；导出页要求加载当前密钥时必须精确匹配当前公钥。
6. 如果同一 key ID 已记录撤销时间，拒绝重新激活。
7. 项目成员记录成功写入后才把私钥放入内存。

`member-public-key.json`：

```json
{
  "schema_version": 1,
  "kind": "textile.member_public_key",
  "project_id": "project_xxx",
  "member_id": "user_xxx",
  "member_name": "翻译A",
  "key_id": "key_xxx",
  "public_key": "{...}",
  "created_at": "2026-06-19T00:00:00.000Z",
  "algorithm": "ECDSA-P256-SHA256",
  "proof_signature": "..."
}
```

公钥登记文件不包含私钥。导入时会检查 project ID、成员 ID、key ID 和持有证明；成员已有不同公钥时必须由 UI 二次确认后以轮换方式导入。已撤销的同一 key ID 不能重新登记，必须使用新密钥。

强制签名项目中新增成员可选择“为该成员生成身份密钥”。`prepareMemberWithGeneratedKey()` 只在内存中准备成员、公钥和一次性私钥文件；UI 先保存私钥文件，成功后才调用 `commitPreparedMemberWithGeneratedKey()` 写入成员和公钥。取消或失败时成员不会被新增。私钥不得进入项目文件、`.hproj`、修改包或项目更新包。

密钥撤销分为两类权限：普通成员可撤销自己的身份密钥，用于停止继续使用旧公钥；撤销其他成员身份密钥仍需要密钥管理权限。撤销只标记 `key_revoked_at` 并卸载本机私钥，不删除历史成员信息。

自己的初次密钥生成和普通轮换也使用 prepare/save/commit：先生成内存候选和 `member-key.json`，确认私钥文件保存成功后才写 `members.json` 并加载私钥。这样不会出现项目已经登记公钥但唯一私钥文件未保存的状态。

负责人轮换自己的项目更新签名密钥时先在内存中生成新密钥和公开成员快照，不写项目；UI 先保存新私钥，再导出并保存由旧密钥签名、成员快照包含新公钥的 `project_update`，最后由统一信任过渡 service 提交归档、成员、事件和 revision。旧私钥丢失时不能伪造连续轮换。

有项目更新发布权限的负责人撤销自己的有效密钥时使用 `prepareOwnSigningKeyRevocation()` 构造包含撤销状态的公开成员快照，由当前旧密钥签出 `project_update`，保存成功后通过统一信任过渡 service 提交。普通成员或无发布权限成员仍可直接撤销自己的密钥；最后一把可信发布密钥不能撤销。

负责人转让先由 `prepareOwnerTransfer()` 生成转让后的公开成员快照；成员管理 UI 验证新负责人的交接证明，再用当前旧负责人签名人快照导出 `project_update`；确认过渡包已保存后通过统一信任过渡 service 提交。导入端仍使用当前项目里旧负责人的公钥验证该过渡包。

成员管理 UI 通过统一的 `ownerTransferBlockReason` 计算不可转让原因，覆盖权限、项目根目录、目标成员、目标公钥和当前负责人可用私钥。按钮禁用时必须同步展示该原因，不能只留下无响应按钮。

### 签名信任过渡

`signingTrustTransition.ts` 是发布密钥轮换、公钥恢复、发布密钥撤销和负责人转让的统一提交边界。

- `commitSignedTrustTransition()` 要求输入已由当前可信发布者签名的 `project_update`。
- 同一个 `ProjectWritePlan` 写入 `changes/transitions/<package_id>.zip`、`members.json`、`logs/events.jsonl` 和 `project.json`，其中 `project.json` 最后写入。
- 过渡提交前重新检查项目 ID 和 base revision，写入开启逐字节校验；失败时按写入计划恢复。
- 页面先保存新私钥文件，再保存外部过渡包，最后调用提交；提交成功后才切换内存私钥。
- `loadLatestTrustTransitionArchive()` 用于重新保存最近归档的过渡包。

可信发布者恢复不新增修改包类型。丢失私钥的成员用 `exportPreparedPublicKeyRegistrationFile()` 生成不写入项目的公钥登记文件；另一名可信发布者导入后，用自己的旧可信私钥签发包含目标新公钥的 `project_update`。

所有可信发布私钥都不可用时，`prepareOfflineTrustRebuild()` 生成新 revision 并将 `trust_epoch` 加一。UI 先保存新私钥和带有新公钥、新 revision 的 `.hproj`，再由 `commitOfflineTrustRebuild()` 原子写入成员、事件和项目配置。旧副本必须废弃，项目更新导入会拒绝跨 `trust_epoch`。

最后一把可信发布密钥的撤销在 `keyManager.ts` service 层阻止，不只依赖 UI。

负责人交接证明使用 `textile.owner_transfer_key_proof` JSON 文件，签名内容绑定 project ID、当前 revision、成员 ID、公钥和 key ID；验证时还要求生成时间不超过 24 小时。

风险：

- 导出的私钥文件未加密。
- 页面刷新、退出登录、切换项目、移除项目或主动卸载后，内存私钥会清除。
- 私钥不得进入项目包或仓库。

## 40. `exporter.ts`

职责：

- 按项目设置收集可发布词条。
- 调用格式适配器。
- 生成发布 ZIP、manifest 和报告。
- 生成导出前摘要。

格式适配器：

- `exporters/jsonExporter.ts`
- `exporters/txtExporter.ts`
- `exporters/csvExporter.ts`
- `exporters/ksExporter.ts`

输入：

- 当前项目根。
- `ExportProjectOptions`。
- 当前发布成员 ID。

输出：

- 文件名。
- ZIP Blob。
- manifest。
- summary。

过滤：

- 隐藏项目文件不导出。
- 隐藏词条不导出。
- `only_reviewed` 是兼容保留的配置键；开启时按当前项目工作流保留“流程完成”词条：
  - 审核开启：保留 `status === "reviewed"`。
  - 审核关闭且校对开启：保留达到 `proofread_required` 的词条。
  - 审核和校对都关闭：保留有译文的词条。

报告：

- 未翻译。
- 争议。
- 术语检查。

风险和限制：

- 结果只下载，不自动写项目 `exports/`。

## 41. `projectPackage.ts`

职责：

- 导出 `.hproj`。
- 预览 `.hproj` 摘要和缺失路径。
- 将 `.hproj` 导入为本地项目文件夹。
- 保留从 `.hproj` 创建内存项目根的兼容能力。

输入：

- 项目根或 `File`。

输出：

- `{ fileName, blob }`
- 预览摘要。
- 导入后的本地项目根。
- 内存 `ProjectDirectoryHandle`

包含目录：

- source
- entries
- terms
- tasks
- comments
- logs
- exports
- changes

修改时必须保留：

- 路径清理。
- source 打包。
- 不存在目录跳过。
- packed dirty 状态清除。

## 42. `auth.ts`

职责：

- 密码生成和验证。
- 成员登录。
- 修改自己的密码。
- 管理员重置密码。
- 新增成员。
- 修改角色。
- 停用成员。
- 转让 owner。

输入：

- 项目 root。
- members 数组。
- actor。
- 密码或角色 patch。

输出：

- 登录成员或更新后的 members。

读写：

- `members.json`
- `logs/events.jsonl`

保护：

- 只有 active 成员可登录。
- 成员名按当前代码精确匹配。
- owner 唯一。
- 转让 owner 后原 owner 变为 admin。
- 禁用和重新启用成员都会保留成员记录，并分别写入 `member.disabled` 和 `member.enabled` 事件。
- 永久删除成员写入 `member.deleted` 事件，事件详情只保留成员 ID，避免在账户记录移除后重新复制名称、角色或密钥信息。
- service 内使用权限和角色规则兜底。

## 43. `session.ts`

LocalStorage key：

```text
textile.projectSessions.v1
```

会话：

```json
{
  "projectId": "project_xxx",
  "userId": "user_xxx",
  "loginAt": "2026-06-19T00:00:00.000Z",
  "expiresAt": "2026-07-19T00:00:00.000Z"
}
```

默认记忆 30 天。

恢复时检查：

- 项目 ID。
- 是否过期。
- 成员是否仍存在且 active。

密码不保存在 session。

## 44. `recentProjects.ts`

LocalStorage：

`utils/browserStorage.ts` 是 LocalStorage 的集中容错封装。业务模块不应直接假设 LocalStorage 可读写；隐私模式、配额限制或浏览器策略导致失败时，应降级为不持久化本地提示或缓存。

```text
textile.recentProjects.v1
```

IndexedDB：

```text
database: textile-recent-projects
store: projectHandles
```

记录包括：

- recordId
- projectId
- name
- sourceType
- displayPath
- lastOpenedAt
- lastUserId

最多 12 条。

`recordId` 用于区分同一 `projectId` 的不同本地打开位置，旧记录没有该字段时按 `projectId` 兼容。只有普通文件夹句柄会写 IndexedDB；packed `.hproj` 不写。

权限恢复分两种入口：

- 用户点击最近项目时，`recentProjects.ts` 会在 `queryPermission` 为 `prompt` 时调用 `requestPermission({ mode: "readwrite" })`，授权成功后直接打开项目。
- 启动时按 URL 自动恢复项目只检查权限状态，不主动弹授权；如果不是 `granted`，回到启动页并提示用户从最近项目点击继续。

## 45. 页面与 service 调用关系

| 页面/组件 | 主要 service |
| --- | --- |
| `App.vue` | project、auth、permissions、session、recentProjects、workspacePosition、stats、tasks、appUpdate、projectDeletion |
| `CreateProjectPage` | project |
| `ProjectListPage` | recentProjects 间接由 App 处理 |
| `LoginPage` | auth 间接由 App 处理 |
| `ProjectPage` | permissions、stats 数据由 App 提供 |
| `FilesPage` | project、entries、permissions、stats |
| `EntriesPage` | entries、entryBatch、tasks、permissions |
| `EntryPage` | entries、comments、permissions |
| `EntryAssistPanel` | terms、history、comments/context 子组件 |
| `TasksPage` | tasks、permissions |
| `TermsPage` | terms、permissions |
| `CommentsPage` | comments、entries、permissions |
| `StatsPage` | stats |
| `ImportExportPage` | changes、projectPackage、exporter、project、tasks、permissions |
| `SettingsPage` | project、auth 子组件、permissions、keyManager、projectPackage、cacheMaintenance、projectDeletion、appUpdate、stats |

页面不得绕过这些 service 直接操作 `projectFs`。

`workspacePosition.ts` 使用 LocalStorage key `textile.workspacePositions.v1`，按 `projectId + userId` 保存最近文件 ID、各文件最近词条 ID 和更新时间，最多保留 50 组项目成员位置。该记录是本机 UI 状态，不写入项目数据、修改包或 `.hproj`。所有 LocalStorage 访问继续通过 `utils/browserStorage.ts` 容错；不可写时功能降级为仅当前运行期间记忆。

`App.vue` 打开项目并恢复或完成成员登录后读取该位置，过滤项目中已不存在的文件，再进入最近文件；明确 URL、任务或批注目标优先于本机位置。最近文件 ID 传给 `FilesPage` 用于“最近查看”标注和第三行定位；每文件最近词条 ID 传给 `EntryPage`，词条不存在时由页面回退到第一条。点击文件或实际选中词条时同步更新内存与本机记录。移除项目最后一条最近记录、删除项目记录或清理“最近项目记录”时同时清除对应位置。

工作台侧边栏的“使用手册”入口经由 `App.vue` 调用 `helpManual.ts`。Web/PWA 直接在新标签页打开 `public/manual.pdf`；Tauri 桌面版调用 `open_manual_pdf` 命令，解析打包资源后通过官方 `tauri-plugin-opener` 交给系统默认 PDF 阅读器，不再手写 `cmd`、`open` 或 `xdg-open` 平台命令。`src-tauri/tauri.conf.json` 必须把 `../public/manual.pdf` 映射到资源根目录的 `manual.pdf`，与 `BaseDirectory::Resource` 查找路径保持一致。`docs/MANUAL.md` 是手册维护源，`public/manual.pdf` 是发布成品，避免在前端组件中复制手册文本。

所有前端生成文件经由 `utils/saveBlob.ts` 的 `saveGeneratedFile()`：

- Tauri：`begin_generated_file_save` 打开原生保存对话框并创建目标文件，前端按 1 MiB 分块调用 `append_generated_file_chunk`，最后调用 `finish_generated_file_save` 执行 flush/sync 并返回实际路径；中途失败调用 `abort_generated_file_save` 关闭并删除未完成文件。
- Web/PWA：使用 `showSaveFilePicker()` 和 writable stream，只有 `close()` 成功才返回 saved。
- 不支持可靠保存能力时返回带原因的 `unavailable`，不得退回 `<a download>`，也不得推进 revision、导出哈希、备份完成、成员新增、公钥切换、密钥撤销或负责人转让。

设置页“关于 Textile / 更新”显示当前程序版本、更新状态和许可证信息。许可证全文通过 `LICENSE?raw` 导入到 `SettingsPage.vue` 的本地弹窗中展示，根目录 `LICENSE` 仍是 Textile 自身许可证的唯一维护源。

第三方依赖许可证不在程序界面中展示。根目录 `THIRD_PARTY_NOTICES.txt` 是第三方许可证通知的唯一维护源，由 `npm run licenses:generate` 根据 `package-lock.json`、`Cargo.lock` 和已安装依赖中的许可证文件生成。生成脚本收集实际安装的 npm 包以及 Windows x64 发布目标实际解析的 Rust/Tauri 包，并按许可证文本去重。

Vite 构建会把该文件输出为 `dist/THIRD_PARTY_NOTICES.txt`；`src-tauri/tauri.conf.json` 的 `bundle.resources` 会把同一文件打入桌面安装包。依赖或锁文件变化后必须重新生成并提交通知文件，发布工作流会通过生成后的 `git diff` 检查阻止过期通知进入发布产物。

## 46. 词条编辑页滚动布局

`EntryPage` 桌面端使用固定视口剩余高度：标题区占自然高度，三栏工作区使用确定的剩余视口高度，内部组件各自滚动。

滚动边界：

- `EntrySideList` 只有词条列表滚动，搜索、筛选和分页区不进入滚动区；分页区固定在组件底部。
- `EntryEditor` 在桌面三栏中独立滚动，避免内容被工作区裁掉。
- `EntryAssistPanel` 只有当前 tab 内容滚动，tab 按钮保持可见。
- `1180px` 以下改为单列和页面整体滚动，不保留桌面端内部滚动约束。

实现边界：

- 新增词条页提示、工具栏或面板时，需要保持 `height -> min-height: 0 -> overflow` 的高度链。
- 左侧文件词条列表由 `EntryPage` 管理标准页码和每页数量，按固定的 `(page - 1) * pageSize` 起点切片；`EntrySideList` 只接收当前页词条并负责组件内滚动。桌面端默认每页 50 条，可切换 20、100、200、500 或 800 条。列表行采用密集行样式，分页控件固定在列表组件底部。
- 打开文件、恢复上次查看位置或从其他页面定位词条时，`EntryPage` 先切换到目标所在的标准页，再向 `EntrySideList` 发出一次性滚动请求，让目标尽量停在第二行。普通点击只切换选中项，不触发自动滚动；“上一条”和“下一条”只在需要时执行最近可见滚动。
- 中间 `EntryEditor` 采用紧凑布局，原文和译文区域限制默认高度，尽量让常规词条一屏显示；长文本仍允许编辑器内部滚动兜底。
- 右侧术语、批注、上下文和历史面板与左侧列表共享同一桌面高度约束。

词条管理页使用独立的全宽紧凑表格：筛选和批量工具栏保持在表格外，表头在表格滚动区内固定，分页区保持可见。桌面端默认每页 50 条，可切换 20、100、200、500 或 800 条；窄屏保留横向表格滚动，不把批量操作塞进原有三栏编辑侧栏。

## 47. PWA 与更新机制

### `appUpdate.ts`

职责：

- 统一 Web、PWA 和 Tauri 三种运行环境的更新状态。
- 读取和保存 stable/beta 通道。
- 检查版本、下载更新、安装或刷新。
- 订阅 PWA service worker、应用写操作和未保存草稿状态。
- 只在没有真实阻止项时允许用户应用已经准备好的更新。
- 通过 BroadcastChannel 在 Web/PWA 标签页之间同步更新状态。

`appUpdatePresentation.ts` 提供更新状态的纯函数展示语义：

- 待安装、待刷新和正在安装/刷新状态优先于普通检查结果。
- 同一 `latest_version` 下已有 PWA 新资源时显示“新构建”，与版本号升级区分。
- 桌面更新下载完成后，根据安全状态区分“可以安装并重启”和“等待当前操作完成”。
- `SettingsPage.vue` 与 `UpdateNotice.vue` 共用同一组状态文案和动作标签，不在页面中复制判断。

主要输入：

- 当前 `package.json` 版本。
- 更新通道。
- Web `version.json`。
- PWA service worker 事件。
- Tauri Updater 返回的 manifest 和下载进度。
- `updateSafety.ts` 聚合的活动操作和未保存草稿状态。

主要输出：

- `AppUpdateState`。
- `UpdateCheckResult`。
- 更新状态订阅通知。
- Web 下载页打开、PWA 刷新或 Tauri 安装重启动作。

内置用户手册不进入更新状态机。手册入口位于工作台侧边栏“使用手册”，桌面版通过 Tauri `open_manual_pdf` 命令和官方 opener 插件打开打包资源，Web/PWA 通过浏览器打开 `/manual.pdf`。

状态机包含：

```text
idle
checking
up-to-date
update-available
downloading
downloaded
waiting-for-safe-state
installing
restarting
ready-to-refresh
refreshing
failed
```

调用位置：

- `App.vue` 在挂载时 setup 并自动检查。
- `UpdateNotice.vue` 显示全局更新提示。
- `SettingsPage.vue` 显示版本、通道、发布说明和手动动作。

状态优先级：

```text
installing / refreshing / restarting
> ready-to-refresh / downloaded / waiting-for-safe-state
> update-available
> up-to-date
> failed / idle
```

`checkForUpdates()` 和检查失败处理都会在提交结果后重新应用该优先级。因此：

- PWA 已有待刷新资源时，后续 `up-to-date` 或 `failed` 不会清除 `ready-to-refresh`。
- 同版本的新 `build_id`/`assets_hash` 可以作为新构建资源处理，不等同于版本号升级。
- `applyBlockedReason` 只在确实存在待刷新或待安装更新且当前有真实阻止项时保留。

风险点：

- Web/PWA 清单与 Tauri `latest.json` 不是同一种格式，不能混用。
- 安装和刷新前必须继续尊重活动写操作与未保存草稿状态。
- Web 下载 URL 为空时不能打开占位地址。
- Tauri Updater 未配置公钥或更新端点时检查会失败，不应绕过发布检查。

### PWA

`vite.config.ts`：

- `registerType: "prompt"`。
- 缓存 JS、CSS、HTML、SVG、PNG、ICO、WOFF2。
- manifest 名称“Textile 汉化协作工具”。
- standalone display。

`pwaUpdateAdapter.ts`：

- 接收 service worker 更新准备事件。
- 提供应用新版资源入口。
- service worker 已准备的新资源独立于版本号检查结果；同版本新构建仍可能需要刷新。

### Web 版本检查

`webUpdateAdapter.ts` 读取：

```text
/version.json
```

字段：

- current/latest version
- build ID
- assets hash
- release date
- channel
- critical
- download URL
- notes

`latest_version` 表示程序版本号，`build_id` 和 `assets_hash` 表示同一版本下的构建资源。设置页会分别显示版本和构建编号。

`scripts/generate-version-manifest.mjs` 计算 `assets_hash` 时会把文本文件的 CRLF/CR 换行统一为 LF，再参与 hash；PDF、PNG 等二进制文件仍按原始字节计算。这样本机 Windows 和 GitHub Actions 的 checkout 换行差异不会让同一份代码生成不同的 `public/version.json`。

当前 `download_url` 为空，Web 下载按钮禁用。

### Tauri Updater

`tauriUpdateAdapter.ts` 动态调用：

- check
- download
- install
- relaunch

Tauri Updater 在没有可用更新时 `check()` 返回空结果，不会向 UI 暴露远端 `latest.json` 的完整 manifest。设置页在 `desktop + up-to-date + latest 为空` 时使用当前版本作为“最新版本”展示，并把构建编号显示为桌面通道不提供；有可用更新时仍展示 Tauri 返回的版本、日期和 notes。

`src-tauri/capabilities/default.json` 允许：

- updater default
- process restart

当前生产配置未完成：

- pubkey 为空。
- endpoints 为空。

### Tauri 桌面发布流程

桌面发布分为三类产物：

- 程序源码：放在 GitHub 仓库中，供维护者协作和审查。
- 安装包和更新包：放在 GitHub Releases 或等价的 HTTPS 文件服务中，供用户下载。
- 项目数据：本地项目文件夹、`.hproj`、修改包和项目更新包，独立于程序发布，不应打进安装包。

Tauri Updater 只负责更新 Textile 程序本身，不负责更新某个翻译项目。项目数据仍走 Textile 内部的 `.hproj`、普通修改包和签名项目更新包流程。

首次配置：

1. 生成 updater 签名密钥：

```powershell
npm.cmd run tauri signer generate -- -w "$env:USERPROFILE\.tauri\textile.key"
```

2. 将生成出来的公钥写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
3. 将更新清单地址写入 `plugins.updater.endpoints`，例如：

```json
[
  "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
]
```

4. 私钥文件只保存在发布机或 CI 密钥库，不能提交到 GitHub，不能放进项目文件夹、`.hproj`、修改包或应用存储。

第一个公开版本必须已经配置好 `pubkey` 和 `endpoints`。如果先发布一个未配置 Tauri Updater 的安装包，已安装用户无法依靠自动更新补上 Tauri Updater 配置。

每次发布：

1. 修改 `package.json` 的版本号。
2. 运行 `npm.cmd run version:sync`，同步 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock`。
3. 提交代码并推送到 GitHub。
4. 设置签名私钥环境变量：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY="$env:USERPROFILE\.tauri\textile.key"
```

如果私钥设置了密码，还要设置：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>"
```

5. 运行发布检查：

```powershell
npm.cmd run tauri:release:check
```

6. 构建安装包和更新产物：

```powershell
npm.cmd run tauri:build
```

Windows 产物通常在：

```text
src-tauri/target/release/bundle/nsis/
src-tauri/target/release/bundle/msi/
```

普通用户优先下载 NSIS `.exe` 安装包。自动更新还需要对应的 `.sig` 文件内容。

GitHub Release 应上传：

- 安装包，例如 `Textile_0.1.1_x64-setup.exe`。
- 对应 `.sig` 文件，方便人工核对和留档。
- Tauri Updater 使用的 `latest.json`。

`latest.json` 使用 Tauri Updater 格式，不是 Web/PWA 的 `public/version.json`。最小示例：

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

注意事项：

- `signature` 是 `.sig` 文件的文本内容，不是 `.sig` 文件路径。
- `url` 必须是用户机器可以直接下载到安装包的 HTTPS 地址。
- 每个新版本必须用同一把 updater 私钥签名，否则旧版本无法验证更新。
- GitHub Release 若使用私有仓库，普通用户可能无法下载更新文件；公开分发时应确保 release 资源公开可访问。
- `public/version.json` 只服务 Web/PWA 更新检查；桌面自动更新只看 Tauri Updater 更新端点返回的 `latest.json`。

### 更新安全

`appOperation.ts` 跟踪不能被更新中断的写入、导入和导出操作。调用方使用 `withAppOperation()` 包住完整异步流程，`finally` 会保证成功或失败后都清除活动状态。

`appDraft.ts` 保存当前未提交的编辑草稿；Vue 页面和组件通过 `useAppDraft.ts` 按实际值差异登记，并在卸载时清理。磁盘项目已经成功写入后的 `.hproj` dirty 状态不属于“未保存表单”，两者不能混用。

`updateSafety.ts` 不再根据页面或路由推断风险，只聚合：

- `appOperation.ts` 中的活动操作。
- `appDraft.ts` 中的未保存草稿。
- 项目打开、恢复等顶层 busy 状态。

没有以上阻止项时，无论用户位于概览、文件、设置还是导入导出页面，都允许应用更新。PWA 新资源准备完成后不会自动刷新，由用户点击“刷新并应用”；桌面版由用户点击“安装并重启”。展示文案统一由 `appUpdatePresentation.ts` 按平台生成。

## 47. 数据一致性注意事项

当前代码做了最小数据完整性保护，但没有完整事务系统。

已实现：

- 添加源文件通过补偿式写入计划提交 source、entries、project 索引和文件历史事件。
- 添加失败尝试清理中间文件。
- 项目创建失败会清理本次创建的初始化文件和空目录。
- 源文件更新和删除通过补偿式写入计划恢复 source、entries、project 索引和文件历史事件。
- 普通修改包先计算最终内容，再通过同一个写入计划提交。
- 修改包预检查失败不写入。
- 项目更新包最后推进 project revision。
- 项目更新保留本地密码字段。
- 接收更新前检查未导出个人修改。

仍有风险：

- 补偿式写入计划不提供断电或浏览器崩溃后的持久化恢复。
- 回滚阶段再次发生文件系统错误时，错误信息会列出需要人工检查的路径。
- 项目更新包仍以 `project.json` 最后写入降低风险，不具备完整回滚。
- 批注和争议跨文件写入不是事务。
- 日志、任务、术语、chunk 都是全文件重写。
- 多标签页同时编辑同一项目没有锁和合并。
- 直接磁盘修改无法被权限系统阻止。

写入风险控制：

1. 先读取、解析和验证。
2. 先写正文，最后写索引或 revision。
3. 失败时保留旧索引。
4. 尽量清理中间文件并报告残留。
5. 高风险操作前提示 `.hproj` 备份。

## 48. 如何新增页面

1. 在 `src/pages/` 新建 Vue 页面。
2. 明确需要哪些 service，不要直接调用 projectFs。
3. 在 `App.vue` 扩展 route 类型和 `parseRoute()`。
4. 在模板中接入 props/emits。
5. 项目内页面同步更新 sidebar/layout 类型。
6. 如页面有编辑状态，检查 updater safe state。
7. 测试直接访问、前进、后退、刷新和未登录状态。

## 49. 如何新增 service

1. 先确认现有 service 是否已经覆盖该业务。
2. 明确输入、输出、读写文件和权限 action。
3. 文件读写优先通过 `ProjectStorage`；只有底层 adapter、项目包打包或浏览器句柄能力才直接使用 `projectFs.ts`。
4. 关键写函数接受 actor/project 或从受控当前用户读取。
5. 在 service 内 `assertCan()`。
6. 失败信息使用用户可理解的中文。
7. 如果使用模块级项目状态，增加 `set*ProjectStorage()` 并接入 App；`set*ProjectRoot()` 仅作为兼容包装。
8. 避免让 service import Vue 页面或组件。

## 50. 如何新增权限 action

1. 在 `model/permissions.ts` 的 `PERMISSION_ACTIONS` 增加字符串。
2. 在 `PERMISSION_GROUPS` 增加中文标签。
3. 加入需要该权限的 `ROLE_DEFAULT_PERMISSIONS`。
4. 如旧项目需要默认获得，扩展兼容逻辑。
5. 在 `services/permissions.ts` 添加业务 wrapper。
6. UI 使用 wrapper 控制入口。
7. service 写函数使用同一 action 兜底。
8. 检查 owner 锁定和防止管理者被锁死规则。

## 51. 如何新增项目设置项

1. 在 `ProjectConfig.settings` 增加可选字段。
2. 提供 normalize/default，保证旧项目可打开。
3. 在 SettingsPage 使用 draft，不直接原地修改 props。
4. 通过 project service 保存。
5. 如影响统计、任务、导出、修改包或 `.hproj`，同步检查所有入口。
6. 如属于项目权威状态，确认 project_update 是否包含。
7. 不随意提升 schema_version；需要提升时必须提供迁移。

## 52. 如何新增导出格式

1. 扩展 `ReleaseExportFormat`。
2. 在 `services/exporters/` 新增适配器。
3. 在 `exporter.ts` 的 format 分发接入。
4. 更新设置页和导入导出页选项。
5. 明确 source、key、speaker、换行和转义规则。
6. 检查隐藏词条、only reviewed、报告和 manifest。
7. 对样例项目手动导出并解压检查。

## 53. 如何调试

浏览器开发：

- 使用 Vite dev server。
- 在 DevTools 查看控制台错误。
- Application 面板检查 LocalStorage、IndexedDB 和 service worker。
- Network 检查 `/version.json`。
- 直接查看项目 JSON/JSONL，确认写入结果。

修改包：

- 将 ZIP 复制后改扩展名或用解压工具检查。
- 比较 `manifest.json`、`signature.json` 和 payload。
- 验证 project_id、revision、content_hash 和 summary。

Tauri：

- 使用 `npm run tauri:dev`。
- debug 构建启用 Tauri log 插件。
- Tauri Updater 配置问题先运行 `npm run tauri:release:check`。

常见错误定位：

- “请先打开项目”：对应 service root 未设置。
- 项目恢复失败：IndexedDB 句柄或权限丢失。
- 项目更新基线不匹配：revision 分叉或漏包。
- 无法签名：当前运行没有加载私钥。
- 统计不一致：调用方没有传 workflow/weights。

## 54. 如何测试

纯函数单元测试使用 Vitest，覆盖 status、stats、permissions 和 change-package content hash：

```bash
npm run test:unit
```

测试位于 `tests/unit/`。除核心业务规则外，还覆盖补偿式写入计划、`.hproj` 导入、程序更新状态展示、可靠生成文件保存，以及私钥与当前成员公钥/key ID 的匹配规则。修改包哈希的排序和序列化逻辑集中在 `src/services/changePackageHash.ts`，固定协议样本用于阻止无意的哈希格式变化。

最低完整检查：

```bash
npm run test:unit
npm run build
```

注意 `npm run build` 会通过 prebuild 更新 `public/version.json`。

建议手动回归：

1. 创建项目、关闭并重新打开。
2. 登录、会话恢复、退出。
3. 添加、更新、导入译文、删除源文件。
4. 翻译、校对多轮、审核、回退、争议。
5. 上下文、术语、批注、任务。
6. 统计页和概览进度一致。
7. 普通成员导出我的可提交修改/所选任务范围修改包。
8. 负责人导入并处理冲突。
9. 负责人发布签名项目更新。
10. 普通成员先导出本地修改，再接收更新。
11. 导出成品并检查 ZIP。
12. 导出 `.hproj`，预览并确认 source、entries 和成员摘要。
13. 导入 `.hproj` 到新的本地项目文件夹，登录并确认词条可读写。
14. 无权限成员尝试关键写操作。
15. Web/PWA 更新提示和安全刷新。
16. 配置完成后测试 Tauri Updater。

## 55. 已知限制

- 不使用服务器，多设备同步依赖人工传递修改包。
- 权限不能阻止用户直接修改磁盘文件。
- `.hproj` 不能原地保存，默认导入为本地项目文件夹；再次分发需要重新导出。
- service storage 是单项目全局状态，不支持同时打开多个项目。
- 没有断电或进程崩溃后的持久化事务日志。
- 没有多标签页并发锁。
- 尚无集成测试和端到端自动化测试。
- Web 下载地址未配置。
- 私钥文件未加密，内存私钥刷新后丢失。
- 独立 `contexts/` 协议目录与当前 Entry 内联上下文并存。
- `exports/` 和 `changes/` 多数情况下不会自动写入。
- 示例项目缺少其 `project.json` 引用的 source 文件。
- 早期 docs 中有已废弃的 Git 和旧状态设计。

## 56. 后续维护建议

建议按风险顺序推进：

1. 发布前复核 Tauri Updater 公钥、HTTPS 更新端点和更新清单。
2. 增加端到端手动测试清单或 Playwright 流程。
