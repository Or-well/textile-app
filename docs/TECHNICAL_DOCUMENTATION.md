# Textile 技术文档

本文档面向维护 Textile 的开发者。它描述当前代码的真实结构、数据流、存储格式、权限、工作流、修改包、更新机制和已知限制。

本文档不是理想架构提案。若早期设计文档与当前代码冲突，以当前代码、本文档和根目录 `AGENTS.md` 为准。

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
- 自动化测试框架
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
- 至少配置一个 HTTPS updater endpoint。

当前 Tauri 公钥和 endpoints 都为空，正式桌面更新发布检查会失败，这是预期保护。

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
  src-tauri/           Tauri 壳、能力和 updater 配置
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
| `/projects/:projectId/files/:fileId` | 词条编辑 |
| `/projects/:projectId/tasks` | 任务 |
| `/projects/:projectId/terms` | 术语 |
| `/projects/:projectId/comments` | 评论 |
| `/projects/:projectId/stats` | 统计 |
| `/projects/:projectId/import-export` | 导入导出 |
| `/projects/:projectId/settings` | 设置 |

词条路由 query：

- `entry`：目标词条 ID。
- `index`：目标词条序号。
- `tab`：`terms`、`comments`、`context`、`history`。
- `comment`：需要定位的评论 ID。

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
5. 对内存项目调用 `markProjectPackageExported()` 清除 dirty 状态。

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
6. 创建目标项目文件夹，写入包内文件并补齐项目常见目录。
7. 包内文件引用的 `entries_path` 缺失时视为不可导入，避免落地后普通项目打开失败。
8. 导入失败时尝试清理刚创建的目标子目录；清理失败时报告残留目录。
9. 调用普通项目打开流程，后续写入都落到本地项目文件夹。

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

## 10. `project.json`

核心类型是 `ProjectConfig`。

示例：

```json
{
  "schema_version": 1,
  "project_id": "project_xxx",
  "revision": "rev_xxx",
  "revision_hash": "rev_xxx",
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
    "role_permissions": {}
  }
}
```

字段说明：

- `schema_version`：项目格式版本，当前为 1。
- `project_id`：跨副本和修改包匹配的稳定 ID。
- `revision`/`revision_hash`：项目更新包的线性基线。
- `files`：项目文件索引。
- `chunk_size`：控制新增、更新源文件和导入译文时每个 entries chunk 的最大词条数；旧的单 chunk 项目仍兼容读取。
- `auto_save`：保留设置，当前编辑仍以显式保存为主。
- `allow_change_package`：项目级开关字段，当前主要能力仍由权限 action 决定。
- `enable_tasks`：保存于工作流，但当前任务页不会因此隐藏。
- `role_permissions`：项目可覆盖默认角色权限。

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
- 不支持旧 `.xls`。

导出当前只生成 JSONL。

## 14. tasks JSONL

路径：

```text
tasks/tasks.jsonl
```

示例：

```json
{"id":"task_001","type":"translate","title":"翻译第一章","description":"","file_id":"script_001","range_start":1,"range_end":50,"entry_ids":[],"assignee":"user_a","status":"assigned","target":"","submit_method":"change_package","proofread_round":1,"created_by":"leader","created_at":"2026-06-18T00:00:00.000Z","updated_at":"2026-06-19T00:00:00.000Z","due_at":"2026-06-25T00:00:00.000Z"}
```

状态：

```text
unassigned -> assigned -> in_progress -> submitted -> completed
```

服务还支持收回和重新打开动作。

旧数据兼容：

- `reclaimed` 规范化为 `unassigned`。
- `blocked` 规范化为 `in_progress` 或 `unassigned`。
- `git_hidden` 提交方式规范化为 `change_package`。
- `git_manual` 规范化为 `owner_manual`。

任务范围优先使用 `entry_ids`，否则使用 `file_id` 和起止 index。

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

- 根评论和回复。
- open/resolved。
- 删除自己的评论或有权限时删除任意评论。
- 删除父评论时级联删除回复。
- 与争议标记联动。

## 16. `logs/events.jsonl`

示例：

```json
{"id":"event_xxx","type":"entry.updated","user_id":"user_a","created_at":"2026-06-19T00:00:00.000Z","entry_id":"script_001:000001","file_id":"script_001","detail":{"status":"translated"}}
```

字段：

- `type`：自由字符串事件类型。
- `user_id`：操作者。
- 可选 entry/task/file 关联。
- `detail`：结构化附加信息。

当前日志追加实现会读取整个 JSONL、加入新事件后重写文件。日志很大时会有性能和并发风险。

## 17. `source/`

`source/` 保存导入的原始文本文件。

`ProjectFile.source_path` 指向实际路径。添加源文件时会先解析内存内容，再写 source 和 entries，最后更新 `project.json`。

项目更新包会包含源文件，`.hproj` 也会递归打包 source。

当前 `examples/simple-project` 的 `project.json` 引用了 `source/script_001.ks`，但示例目录没有该文件。这说明示例可以用于部分数据查看，但不是完整备份样例。

## 18. `exports/`

新项目创建 `exports/releases/`，`.hproj` 会打包 `exports/`。

当前成品导出通过 Blob 触发浏览器下载，不会自动把 ZIP 写到项目的 `exports/` 目录。因此该目录目前更接近保留的项目内发布空间，而不是所有导出的自动历史。

## 19. `changes/`

新项目创建 `changes/`，`.hproj` 会打包该目录。

当前普通修改包和项目更新包同样通过浏览器下载、文件选择导入，不会自动归档到 `changes/`。本地“已导出个人修改哈希”保存在浏览器存储，用于接收项目更新前判断未导出修改。

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

维护原则：

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

- 添加源文件先解析，写 source，再写 entries，最后写 project。
- 添加失败时尝试删除中间 source/entries，并报告残留。
- 删除文件先删除 entries/source，最后更新 project。

已知风险：

- 删除 entries 成功、删除 source 失败时，`project.json` 会保留，但 entries 已不存在，仍可能形成部分删除状态。
- 更新源文件先重写 entries，再重写 source，任一步失败都可能让二者短暂不一致。
- 创建项目用 `Promise.all` 写多个初始文件，不是完整事务。

## 22. `entries.ts`

职责：

- 解析源文件。
- 生成和加载词条。
- 合并源文件更新。
- 导入译文。
- 保存词条和上下文。
- 维护审计字段。

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

- `saveEntry(entry, { actor, workflow })` 需要当前成员。
- 从磁盘找到原词条，再合并传入值。
- 根据原值和新值判断翻译、校对、审核、回退或普通编辑。
- service 内再次检查权限。
- 保存者写入 `updated_by` 和 `updated_at`。
- 首次填入译文时写 `translated_by`。
- 校对增加 proofread user/count。
- 审核写 `reviewed_by`。

上下文：

- `updateEntryContext()` 按新增、修改、删除选择对应权限 action。
- 上下文写回词条 JSONL，不是独立上下文文件。

风险点：

- service 内有模块级词条缓存，写入后必须同步更新。
- 某些错误信息仍是英文 `Login required.`、`Permission denied.`。

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
- 分配、领取、提交、完成、收回和重新打开。
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
- 文件词条边界

读写：

- `tasks/tasks.jsonl`

调用：

- `TasksPage`
- `TaskEditDialog`
- `ImportExportPage`
- `App.vue` 读取任务数
- `changes.ts`

进度：

- 根据任务 entry_ids 或 file/range 获取词条。
- 调用 `calculateEntryProgress()`。
- 校对任务可通过 `proofread_round` 覆盖需要的校对轮次。

风险点：

- 整个任务文件每次写入整体重写。
- `enable_tasks` 当前没有阻止任务页或任务 service 使用。

## 25. `comments.ts`

职责：

- 加载单词条或全项目评论。
- 新增、回复、解决、重新打开、删除。
- 标记和解决词条争议。

主要输入：

- 当前 `Entry`
- 评论内容或 comment ID
- 当前成员

主要输出：

- 评论数组。
- 保存后的评论。
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

风险点：

- 评论和词条争议是跨文件写入，不是事务。
- 标记争议时如果评论写入和词条写入中途失败，可能需要人工检查。

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

项目可以通过 `settings.role_permissions` 覆盖默认角色权限。旧项目如果完全没有新的修改包 action，兼容逻辑会补足新协议所需权限。

owner 锁定权限：

- project.manage
- member.manage
- role.manage
- project.backup

典型封装：

- `canTranslateEntry`
- `canProofreadEntry`
- `canReviewEntry`
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
| translator | 翻译、上下文、评论、普通修改包 |
| proofreader | 校对、回退、评论、普通修改包 |
| reviewer | 审核、争议解决、评论 |
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
- 首次产生译文或执行翻译动作写 `translated_by`。

校对：

- 当前成员加入 `proofread_by`。
- `proofread_count` 增加。
- 未达到要求次数时仍保持 translated 主状态，但 UI 显示校对中。
- 达到次数后进入 proofread。

审核：

- 当前成员写 `reviewed_by`。
- 状态进入 reviewed。

回退：

- reviewed 可退回 proofread。
- proofread 可退回 translated。
- 后续审计字段按状态函数清理或保留。

默认限制：

- 不允许译者自校。
- 不允许译者自审。
- 不允许同一成员重复完成多轮校对。

这些规则可在项目工作流设置中调整。

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
translationRatio = 已进入 translated/proofread/reviewed 的词条 / 总词条
proofreadRatio = 达到所需校对次数的词条 / 总词条
reviewRatio = review_required 时 reviewed / 总词条，否则 0
overall = 三个比例乘归一化权重后相加
```

审核关闭时：

- review weight 强制为 0。
- translation/proofread 重新归一化。
- `completedEntries` 使用校对完成数。
- UI 应显示“未启用审核”。

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
| `member_changes` | member_changes | 当前成员全部修改 |
| `task_changes` | member_changes | 所选任务范围，manifest 带 task_id |
| `maintenance_changes` | maintenance_changes | 项目维护数据 |
| `project_update` | project_update | 负责人权威项目更新 |

兼容读取：

- `user_changes`
- `task_changes`
- `legacy`

### 普通成员修改收集

包括：

- `updated_by === 当前成员` 的词条。
- 当前成员评论。
- 当前成员创建的术语。
- 当前成员创建或负责的任务。
- 当前成员事件。

上下文写在 Entry 中，因此普通上下文修改通常随 entries 导出。

### 任务修改收集

包括：

- 任务范围内由当前成员修改的词条。
- 相关评论。
- 任务行。
- 相关事件。

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
8. 如果要求签名，从内存 key manager 获取私钥。
9. 生成 ZIP Blob。
10. member_changes 记录本次导出内容哈希。
11. project_update 推进主项目 revision。

普通修改包：

- 有私钥且有签名权限时可签名。
- 没有私钥仍可导出未签名包。

项目更新包：

- 必须签名。
- 当前签名人必须有发布项目更新权限。

## 34. 修改包导入预检查

`validateChangePackage()` 和 `precheckChangePackageImport()` 负责：

- manifest 存在和结构。
- schema_version 支持。
- project_id 匹配。
- content_hash 重新计算。
- signature 状态计算。
- package 类型和风险。
- 凭据、owner 提升和项目设置变化检测。
- 目标路径是否可读取或创建。
- 冲突列表是否已经生成。

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
5. 检测冲突。
6. 要求每个冲突有 resolution。
7. 合并 entries。
8. 去重追加 comments。
9. 按 ID 合并 terms/tasks。
10. 写 contexts。
11. 维护包可写 project/members。
12. 去重追加 events。
13. 追加导入日志。

当前不是事务：

- 预检查保证明显错误不会开始写入。
- 开始写入后，如果后续文件失败，前面文件可能已经变化。
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
8. events
9. 追加导入日志
10. 最后写 `project.json`

把 `project.json` 放在最后，可以让失败时基线 revision 不提前推进，便于重试，但仍不是完整回滚。

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

- 评论、术语、任务和维护数据没有同等细粒度冲突 UI。
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

验签使用 `members.json` 中对应成员的公钥。

项目更新包还检查签名成员当前是否拥有发布权限，避免仅有历史公钥的人继续发布。

## 39. `keyManager.ts`

职责：

- 生成、轮换和撤销当前成员密钥。
- 撤销其他成员公钥。
- 导出和导入私钥文件。
- 写成员公钥和事件日志。

私钥存储：

```ts
const privateKeys = new Map<string, string>();
```

只在当前运行内存中。

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
5. 验证通过后放入内存。

风险：

- 导出的私钥文件未加密。
- 页面刷新后私钥丢失。
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
- `only_reviewed` 时只保留 `status === "reviewed"`。

报告：

- 未翻译。
- 争议。
- 术语检查。

风险和限制：

- 审核关闭时 `only_reviewed` 仍按 reviewed 严格过滤，可能导出空内容。
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

`recordId` 用于区分同一 `projectId` 的不同本地打开位置，旧记录没有该字段时按 `projectId` 兼容。只有普通文件夹句柄会写 IndexedDB；packed `.hproj` 不写。读取最近项目时还会检查 readwrite permission。

## 45. 页面与 service 调用关系

| 页面/组件 | 主要 service |
| --- | --- |
| `App.vue` | project、auth、permissions、session、recentProjects、stats、tasks、appUpdate、projectDeletion |
| `CreateProjectPage` | project |
| `ProjectListPage` | recentProjects 间接由 App 处理 |
| `LoginPage` | auth 间接由 App 处理 |
| `ProjectPage` | permissions、stats 数据由 App 提供 |
| `FilesPage` | project、entries、permissions、stats |
| `EntryPage` | entries、comments、permissions |
| `EntryAssistPanel` | terms、history、comments/context 子组件 |
| `TasksPage` | tasks、permissions |
| `TermsPage` | terms、permissions |
| `CommentsPage` | comments、entries、permissions |
| `StatsPage` | stats |
| `ImportExportPage` | changes、projectPackage、exporter、project、tasks、permissions |
| `SettingsPage` | project、auth 子组件、permissions、keyManager、projectPackage、cacheMaintenance、projectDeletion、appUpdate、stats |

页面不得绕过这些 service 直接操作 `projectFs`。

## 46. PWA 与更新机制

### `appUpdate.ts`

职责：

- 统一 Web、PWA 和 Tauri 三种运行环境的更新状态。
- 读取和保存 stable/beta 通道。
- 检查版本、下载更新、安装或刷新。
- 订阅 PWA service worker 和应用写操作状态。
- 在安全时机应用已经准备好的更新。
- 通过 BroadcastChannel 在 Web/PWA 标签页之间同步更新状态。

主要输入：

- 当前 `package.json` 版本。
- 更新通道。
- Web `version.json`。
- PWA service worker 事件。
- Tauri Updater 返回的 manifest 和下载进度。
- `updateSafety.ts` 提供的页面和写操作安全状态。

主要输出：

- `AppUpdateState`。
- `UpdateCheckResult`。
- 更新状态订阅通知。
- Web 下载页打开、PWA 刷新或 Tauri 安装重启动作。

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

风险点：

- Web/PWA 清单与 Tauri `latest.json` 不是同一种格式，不能混用。
- 安装和刷新前必须继续尊重活动写操作与页面安全状态。
- Web 下载 URL 为空时不能打开占位地址。
- Tauri updater 未配置公钥或 endpoint 时检查会失败，不应绕过发布检查。

### PWA

`vite.config.ts`：

- `registerType: "prompt"`。
- 缓存 JS、CSS、HTML、SVG、PNG、ICO、WOFF2。
- manifest 名称“Textile 汉化协作工具”。
- standalone display。

`pwaUpdateAdapter.ts`：

- 接收 service worker 更新准备事件。
- 提供应用新版资源入口。

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

当前 `download_url` 为空，Web 下载按钮禁用。

### Tauri Updater

`tauriUpdateAdapter.ts` 动态调用：

- check
- download
- install
- relaunch

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

第一个公开版本必须已经配置好 `pubkey` 和 `endpoints`。如果先发布一个未配置 updater 的安装包，已安装用户无法依靠自动更新补上 updater 配置。

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
- Tauri updater 使用的 `latest.json`。

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
- `public/version.json` 只服务 Web/PWA 更新检查；桌面自动更新只看 Tauri endpoint 返回的 `latest.json`。

### 更新安全

`appOperation.ts` 跟踪写操作。

`updateSafety.ts` 只把以下项目页面视为自动刷新安全：

- overview
- stats

其他项目编辑页面、busy 状态或活动写操作会阻止自动安装/刷新。

## 47. 数据一致性注意事项

当前代码做了最小数据完整性保护，但没有完整事务系统。

已实现：

- 添加源文件最后更新 project 索引。
- 添加失败尝试清理中间文件。
- 删除文件最后更新 project 索引。
- 修改包预检查失败不写入。
- 项目更新包最后推进 project revision。
- 项目更新保留本地密码字段。
- 接收更新前检查未导出个人修改。

仍有风险：

- 删除文件中途失败可能已经删除部分正文。
- 更新源文件可能先改 entries、后改 source。
- 普通修改包开始写入后失败会部分应用。
- 评论和争议跨文件写入不是事务。
- 日志、任务、术语、chunk 都是全文件重写。
- 多标签页同时编辑同一项目没有锁和合并。
- 直接磁盘修改无法被权限系统阻止。

维护原则：

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
- updater 配置问题先运行 `npm run tauri:release:check`。

常见错误定位：

- “请先打开项目”：对应 service root 未设置。
- 项目恢复失败：IndexedDB 句柄或权限丢失。
- 项目更新基线不匹配：revision 分叉或漏包。
- 无法签名：当前运行没有加载私钥。
- 统计不一致：调用方没有传 workflow/weights。

## 54. 如何测试

当前仓库没有自动化测试套件，也没有 `test` script。最低检查：

```bash
npm run build
```

注意 `npm run build` 会通过 prebuild 更新 `public/version.json`。纯文档任务若要求不改运行文件，不应运行 build，除非允许该生成文件变化。

建议手动回归：

1. 创建项目、关闭并重新打开。
2. 登录、会话恢复、退出。
3. 添加、更新、导入译文、删除源文件。
4. 翻译、校对多轮、审核、回退、争议。
5. 上下文、术语、评论、任务。
6. 统计页和概览进度一致。
7. 普通成员导出普通/任务修改包。
8. 负责人导入并处理冲突。
9. 负责人发布签名项目更新。
10. 普通成员先导出本地修改，再接收更新。
11. 导出成品并检查 ZIP。
12. 导出 `.hproj`，预览并确认 source、entries 和成员摘要。
13. 导入 `.hproj` 到新的本地项目文件夹，登录并确认词条可读写。
14. 无权限成员尝试关键写操作。
15. Web/PWA 更新提示和安全刷新。
16. 配置完成后测试 Tauri updater。

## 55. 已知限制

- 不使用服务器，多设备同步依赖人工传递修改包。
- 权限不能阻止用户直接修改磁盘文件。
- `.hproj` 不能原地保存，默认导入为本地项目文件夹；再次分发需要重新导出。
- service storage 是单项目全局状态，不支持同时打开多个项目。
- 没有完整事务和回滚。
- 没有多标签页并发锁。
- 没有自动化测试套件。
- `enable_tasks` 未控制任务页显示。
- `only_reviewed` 在审核关闭时可能导出空内容。
- Web 下载地址未配置。
- Tauri updater 公钥和 endpoint 未配置。
- 私钥文件未加密，内存私钥刷新后丢失。
- 独立 `contexts/` 协议目录与当前 Entry 内联上下文并存。
- `exports/` 和 `changes/` 多数情况下不会自动写入。
- 示例项目缺少其 `project.json` 引用的 source 文件。
- 早期 docs 中有已废弃的 Git 和旧状态设计。

## 56. 后续维护建议

建议按风险顺序推进：

1. 为 status、stats、permissions 和 change-package hash 增加纯函数单元测试。
2. 为项目创建、源文件更新、删除和普通修改包导入增加可回滚写入计划。
3. 为 `.hproj` 导入失败增加更完整的写入计划和残留目录检查。
4. 明确审核关闭时成品过滤语义。
5. 配置正式 Tauri updater 公钥和 HTTPS endpoint。
6. 增加端到端手动测试清单或 Playwright 流程。

任何维护都应遵守根目录 `AGENTS.md`：保持本地优先、service 分层、统一权限、统一统计、修改包协作和最小范围修改。
