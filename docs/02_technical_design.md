# 02 技术设计说明

## 1. 技术路线

推荐技术栈：

```text
Vue 3
Vite
TypeScript
PWA
File System Access API
JSON / JSONL
JSZip
可选桌面封装：Tauri / Electron
```

核心架构：

```text
UI 页面层
  ↓
业务服务层
  ↓
本地文件系统层
  ↓
本地项目文件夹
  ↓
可选 Git 版本管理 / 同步协作
```

设计目标：

- 无自建服务器；
- 本地优先；
- 离线可用；
- 数据格式可读；
- 模块边界稳定；
- 方便人工维护；
- 方便 vibe coding。

---

## 2. 推荐目录结构

```text
src/
  model/
    types.ts
    status.ts
    permissions.ts

  services/
    projectFs.ts
    project.ts
    entries.ts
    terms.ts
    tasks.ts
    permissions.ts
    comments.ts
    changes.ts
    exporter.ts
    stats.ts
    history.ts
    sync.ts
    gitAdapter.ts

  components/
    EntryList.vue
    EntryEditor.vue
    TermHint.vue
    TaskPanel.vue
    CommentPanel.vue
    StatusBadge.vue
    ProgressBar.vue
    ConflictResolver.vue
    ChangePreview.vue
    SyncStatusPanel.vue

  pages/
    HomePage.vue
    ProjectPage.vue
    EntryPage.vue
    TasksPage.vue
    TermsPage.vue
    CommentsPage.vue
    StatsPage.vue
    ImportExportPage.vue
    SettingsPage.vue

  utils/
    jsonl.ts
    time.ts
    text.ts
    zip.ts
    id.ts
    validation.ts
```

---

## 3. 分层规则

必须遵守：

```text
页面层 → 服务层 → 文件系统层
```

正确：

```text
EntryEditor.vue
  调用 entries.saveEntry()
    调用 projectFs.writeTextFile()
      写入 entries/script_001/chunk_0001.jsonl
```

错误：

```text
EntryEditor.vue 直接读取 JSONL
EntryEditor.vue 直接写项目文件
TaskPage.vue 直接执行 Git 命令
```

### 3.1 页面层职责

页面和组件只负责：

- 显示数据；
- 响应用户操作；
- 调用 service；
- 显示加载状态；
- 显示错误提示。

### 3.2 服务层职责

service 负责：

- 词条业务；
- 术语业务；
- 任务业务；
- 权限判断；
- 评论争议；
- 修改包；
- 成品导出；
- 统计；
- 同步封装。

### 3.3 文件系统层职责

`projectFs.ts` 只负责：

- 打开目录；
- 读取文件；
- 写入文件；
- 列目录；
- 创建目录；
- 删除文件；
- 检查文件是否存在。

---

## 4. 模块说明

### 4.1 `projectFs.ts`

本地文件读写模块。

应实现：

```ts
openProjectDirectory()
readTextFile(path)
writeTextFile(path, content)
readJson<T>(path)
writeJson(path, data)
readJsonl<T>(path)
writeJsonl(path, rows)
listFiles(path)
ensureDirectory(path)
fileExists(path)
```

不得包含词条、任务、术语等业务逻辑。

### 4.2 `project.ts`

项目配置模块。

应实现：

```ts
loadProject()
saveProject(config)
loadMembers()
saveMembers(members)
getProjectFiles()
validateProjectStructure()
```

负责读取：

```text
project.json
members.json
```

### 4.3 `entries.ts`

词条模块。

应实现：

```ts
loadEntries(fileId)
loadAllEntries()
getEntryById(entryId)
saveEntry(entry)
saveEntries(entries)
updateEntryTarget(entryId, target)
updateEntryStatus(entryId, status)
searchEntries(query)
filterEntries(filter)
```

负责：

- 词条加载；
- 词条保存；
- 搜索；
- 筛选；
- 状态更新；
- chunk 定位；
- 日志追加。

### 4.4 `terms.ts`

术语模块。

应实现：

```ts
loadTerms()
saveTerms(terms)
addTerm(term)
updateTerm(termId, patch)
deleteTerm(termId)
matchTerms(sourceText)
checkTermUsage(sourceText, targetText)
```

术语匹配优先采用简单策略：

```text
精确匹配
变体匹配
最长优先
不做复杂分词
```

### 4.5 `tasks.ts`

任务模块。

应实现：

```ts
loadTasks()
saveTasks(tasks)
createTask(task)
assignTask(taskId, userId)
claimTask(taskId, userId)
submitTask(taskId)
completeTask(taskId)
reclaimTask(taskId)
getTasksByUser(userId)
getTaskProgress(taskId)
isEntryInTask(entry, task)
```

### 4.6 `permissions.ts`

权限模块。

应实现：

```ts
getCurrentUser()
setCurrentUser(userId)
hasRole(user, role)
can(user, action)
canEditEntry(user, entry)
canManageTask(user, task)
canImportChangePackage(user, pkg)
```

多角色权限计算：

```text
最终权限 = 所有角色权限的并集 + allow_permissions - deny_permissions
```

### 4.7 `comments.ts`

评论和争议模块。

应实现：

```ts
loadComments(entryId)
addComment(entryId, comment)
deleteComment(entryId, commentId)
markDisputed(entryId, reason)
resolveDispute(entryId, resolution)
loadRecentComments()
loadDisputedEntries()
```

第一实现可只支持纯文本评论。

### 4.8 `changes.ts`

修改包模块。

应实现：

```ts
trackChangedEntry(entryId)
exportChangePackage(userId, options)
readChangePackage(file)
validateChangePackage(pkg)
previewChangePackage(pkg)
detectConflicts(pkg)
applyChangePackage(pkg, resolution)
```

导入修改包必须先预览，不得静默覆盖主项目。

### 4.9 `exporter.ts`

成品导出模块。

应实现：

```ts
exportProject(options)
exportFile(fileId)
generateReleaseZip(result)
generateUntranslatedReport()
generateDisputeReport()
generateTermCheckReport()
```

导出时应同时生成：

```text
成品包
manifest.json
未翻译报告
争议报告
术语检查报告
```

### 4.10 `stats.ts`

统计模块。

应实现：

```ts
getProjectStats()
getFileStats(fileId)
getUserStats(userId)
getTaskStats(taskId)
getStatusDistribution()
getDisputeStats()
getTermIssueStats()
```

统计模块原则上只读数据，不写数据。

### 4.11 `history.ts`

历史日志模块。

应实现：

```ts
appendEvent(event)
loadEvents(filter)
getEntryHistory(entryId)
getUserHistory(userId)
getTaskHistory(taskId)
```

### 4.12 `sync.ts`

面向业务的同步协作模块。

用于封装 Git 同步，不向 UI 暴露 Git 细节。

应实现：

```ts
getSyncStatus()
syncLatestProject()
submitTaskWithSync(taskId)
uploadMyChanges()
generateChangeSummary()
```

UI 应调用 `sync.ts`，不直接调用 `gitAdapter.ts`。

### 4.13 `gitAdapter.ts`

底层 Git 适配层。

仅供 `sync.ts` 调用。

应实现：

```ts
isGitProject()
getWorkingTreeStatus()
pullLatest()
createCommit(message)
pushChanges()
getHistory()
```

注意：

- PWA 版本不优先实现完整 Git；
- 桌面封装版本可实现更多 Git 能力；
- 普通成员不直接看到 Git 操作。

---

## 5. 项目数据结构

标准项目文件夹：

```text
MyTranslationProject/
  project.json
  members.json

  source/
    script_001.ks
    script_002.ks

  entries/
    script_001/
      chunk_0001.jsonl
      chunk_0002.jsonl

  terms/
    terms.jsonl

  comments/
    script_001/
      000001.jsonl

  tasks/
    tasks.jsonl

  logs/
    events.jsonl

  exports/
    releases/

  changes/
```

若使用 Git：

```text
MyTranslationProject/
  .git/
  project.json
  entries/
  terms/
  tasks/
  logs/
```

普通成员不需要理解 `.git`。

---

## 6. 核心数据格式

### 6.1 `project.json`

```json
{
  "schema_version": 1,
  "project_id": "mygame_cn",
  "name": "某某游戏汉化项目",
  "source_language": "ja",
  "target_language": "zh-Hans",
  "files": [
    {
      "id": "script_001",
      "name": "script_001.ks",
      "source_path": "source/script_001.ks",
      "entries_path": "entries/script_001",
      "type": "ks",
      "hidden": false,
      "locked": false
    }
  ],
  "settings": {
    "chunk_size": 500,
    "auto_save": true,
    "allow_change_package": true
  }
}
```

### 6.2 `members.json`

```json
{
  "schema_version": 1,
  "members": [
    {
      "id": "user_a",
      "name": "小A",
      "roles": ["translator", "proofreader"],
      "allow_permissions": [],
      "deny_permissions": [],
      "active": true
    }
  ]
}
```

### 6.3 词条 JSONL

路径：

```text
entries/{file_id}/chunk_0001.jsonl
```

示例：

```json
{"id":"script_001:000001","file_id":"script_001","index":1,"key":"line_000001","speaker":"美咲","source":"今日はいい天気ですね。","target":"今天天气真好啊。","context":"教室，早晨","status":"translated","assignee":"user_a","translated_by":"user_a","proofread_by":"","reviewed_by":"","word_count":10,"hidden":false,"locked":false,"updated_at":"2026-06-18T20:00:00+09:00","updated_by":"user_a"}
```

### 6.4 术语 JSONL

路径：

```text
terms/terms.jsonl
```

示例：

```json
{"id":"term_001","source":"魔術回路","target":"魔术回路","part_of_speech":"名词","note":"专有名词，不译作魔法回路","variants":["魔術迴路"],"created_by":"user_b","updated_at":"2026-06-18T20:00:00+09:00"}
```

### 6.5 任务 JSONL

路径：

```text
tasks/tasks.jsonl
```

示例：

```json
{"id":"task_001","type":"translate","title":"翻译 script_001 第 1-100 条","file_id":"script_001","range_start":1,"range_end":100,"entry_ids":[],"assignee":"user_a","status":"in_progress","submit_method":"git_hidden","created_by":"leader","created_at":"2026-06-18T20:00:00+09:00","due_at":"2026-06-25T20:00:00+09:00"}
```

### 6.6 评论 JSONL

路径：

```text
comments/{file_id}/{entry_index}.jsonl
```

示例：

```json
{"id":"comment_001","entry_id":"script_001:000001","user_id":"user_a","created_at":"2026-06-18T20:00:00+09:00","body":"这里语气是不是太书面？","reply_to":null}
```

### 6.7 日志 JSONL

路径：

```text
logs/events.jsonl
```

示例：

```json
{"id":"event_001","type":"entry.updated","user_id":"user_a","entry_id":"script_001:000001","created_at":"2026-06-18T20:00:00+09:00","detail":{"status":"translated"}}
```

---

## 7. 修改包格式

文件名：

```text
changes-{user_id}-{task_id}-{date}.zip
```

结构：

```text
manifest.json
entries/
comments/
logs/
```

`manifest.json`：

```json
{
  "schema_version": 1,
  "project_id": "mygame_cn",
  "user_id": "user_a",
  "user_name": "小A",
  "task_id": "task_001",
  "created_at": "2026-06-18T21:00:00+09:00",
  "changed_entries": 35,
  "new_comments": 5
}
```

导入前必须校验：

- 项目 ID；
- schema version；
- 用户；
- 任务；
- 修改范围；
- 冲突。

冲突处理选项：

```text
保留主项目
使用修改包
手动合并
跳过
```

---

## 8. 简约架构约束

不应过度拆分模块。

推荐控制：

```text
service 文件：300-600 行
Vue 组件：200-400 行
工具函数文件：200-300 行
```

超过后再按职责拆分，不要为了形式提前拆分。

不要引入：

```text
服务器数据库
复杂状态管理
实时协作服务
完整 Git 客户端
复杂工作流引擎
插件系统
```

---

## 9. 数据设计约束

保持数据可读、可修复。

原则：

- 优先 JSON / JSONL；
- 避免深层嵌套；
- 一个字段只表达一个意思；
- 新增字段优先于修改旧字段；
- 保留 `schema_version`；
- 重大格式变化需要迁移说明。

错误设计：

```json
{
  "entry": {
    "meta": {
      "workflow": {
        "review": {
          "status": "reviewed"
        }
      }
    }
  }
}
```

推荐设计：

```json
{
  "id": "script_001:000001",
  "status": "reviewed",
  "reviewed_by": "user_a"
}
```
