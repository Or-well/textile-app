# 03 开发路线与共同规范

## 1. 文档目的

本文说明本项目如何逐步开发，以及开发过程中必须遵守的共同规范。

其他文档描述产品和技术设计；本文面向实际开发，尤其是 vibe coding 场景。

核心原则：

```text
一次只做一小步
每一步都可运行
每个模块职责清楚
不提前复杂化
要有简约详尽注释
方便人类维护
方便 AI 小步修改
```

---

## 2. 总体开发路线

推荐阶段：

```text
阶段 0：项目骨架与样例数据
阶段 1：本地项目读取与词条浏览
阶段 2：词条编辑、保存与术语提示
阶段 3：任务管理与基础软权限
阶段 4：评论、争议与历史日志
阶段 5：修改包导出与导入
阶段 6：统计与管理视图
阶段 7：成品导出与报告
阶段 8：PWA 离线体验与发布打磨
阶段 9：前端封装 Git 协作与桌面增强
```

核心闭环：

```text
打开本地项目
读取词条
编辑译文
保存译文
提交修改
负责人合并
导出成品
```

---

## 3. MVP 定义

MVP 的目标是证明：

```text
工具可以在本地离线打开项目，并以词条为单位完成翻译和保存。
```

MVP 必须支持：

- 打开本地项目文件夹；
- 读取 `project.json`；
- 读取词条 JSONL；
- 显示词条列表；
- 查看词条原文；
- 编辑译文；
- 保存译文；
- 修改词条状态；
- 读取术语表；
- 当前词条术语提示；
- 基础进度统计；
- 样例项目；
- 基础错误提示。

MVP 可以暂不支持：

- 修改包；
- Git 同步；
- 评论；
- 任务；
- 审核流；
- 成品导出；
- 成员贡献统计；
- PWA 安装。

MVP 验收标准：

```text
可以打开 examples/simple-project/
可以显示项目名称
可以显示词条列表
可以编辑某条译文
可以保存译文
刷新后译文仍然存在
可以显示术语提示
可以显示总词条数、已翻译数、未翻译数
没有明显 TypeScript 错误
```

---

## 4. 阶段说明

### 4.1 阶段 0：项目骨架与样例数据

目标：

```text
建立可运行项目和样例数据。
```

完成内容：

```text
Vue 3 + Vite + TypeScript 项目
src/model/
src/services/
src/components/
src/pages/
src/utils/
examples/simple-project/
```

应创建：

```text
types.ts
status.ts
jsonl.ts
projectFs.ts
project.json
members.json
entries/script_001/chunk_0001.jsonl
terms/terms.jsonl
```

验收：

```text
项目能启动
样例项目存在
JSONL 工具能解析样例词条
基础类型已定义
```

---

### 4.2 阶段 1：本地项目读取与词条浏览

目标：

```text
能打开本地项目并显示词条。
```

实现模块：

```text
projectFs.ts
project.ts
entries.ts
ProjectPage.vue
EntryList.vue
```

验收：

```text
能选择本地项目文件夹
能读取项目名称
能显示文件列表
能显示词条列表
能显示原文、译文、状态
```

---

### 4.3 阶段 2：词条编辑、保存与术语提示

目标：

```text
能完成实际翻译。
```

实现模块：

```text
entries.ts
terms.ts
stats.ts
EntryEditor.vue
TermHint.vue
```

验收：

```text
能编辑译文
能保存译文
刷新后数据仍存在
能修改状态
能显示术语命中
能显示基础进度
```

---

### 4.4 阶段 3：任务管理与基础软权限

目标：

```text
能分配和查看任务，能按角色控制界面。
```

实现模块：

```text
tasks.ts
permissions.ts
TasksPage.vue
TaskPanel.vue
```

验收：

```text
能创建任务
能分配任务
能查看我的任务
能计算任务进度
成员支持多角色
权限通过 can(user, action) 判断
```

---

### 4.5 阶段 4：评论、争议与历史日志

目标：

```text
能围绕词条讨论并追踪关键操作。
```

实现模块：

```text
comments.ts
history.ts
CommentPanel.vue
CommentsPage.vue
```

验收：

```text
能添加评论
能查看评论
能标记争议
能解决争议
能写入 logs/events.jsonl
```

---

### 4.6 阶段 5：修改包导出与导入

目标：

```text
实现离线协作核心能力。
```

实现模块：

```text
changes.ts
zip.ts
ChangePreview.vue
ConflictResolver.vue
ImportExportPage.vue
```

验收：

```text
能导出修改包
能读取修改包
能预览修改
能检测冲突
能手动处理冲突
能应用修改
```

---

### 4.7 阶段 6：统计与管理视图

目标：

```text
让负责人掌握项目进度。
```

实现模块：

```text
stats.ts
StatsPage.vue
ProgressBar.vue
```

验收：

```text
能显示项目进度
能显示文件进度
能显示成员贡献
能显示任务进度
能显示争议统计
```

---

### 4.8 阶段 7：成品导出与报告

目标：

```text
从源文件和译文生成发布包。
```

实现模块：

```text
exporter.ts
ImportExportPage.vue
```

验收：

```text
能导出至少一种源文件格式
能生成成品 zip
能生成 manifest
能生成未翻译报告
能生成争议报告
能生成术语检查报告
```

---

### 4.9 阶段 8：PWA 离线体验与发布打磨

目标：

```text
让工具像普通应用一样可用。
```

实现内容：

```text
PWA 安装
离线缓存
最近项目
当前用户记忆
快捷键
自动保存
统一错误提示
浏览器能力检查
```

验收：

```text
无网络时能打开工具
已缓存资源可离线加载
常见错误提示清楚
危险操作有二次确认
```

---

### 4.10 阶段 9：前端封装 Git 协作与桌面增强

目标：

```text
让愿意使用同步提交的成员可以通过前端完成 Git 协作，但不直接接触 Git。
```

实现内容：

```text
sync.ts
gitAdapter.ts
SyncStatusPanel.vue
SubmitTaskPanel.vue
桌面封装可选 Git 调用
```

普通成员看到：

```text
同步项目
提交任务
上传修改
内容冲突
导出修改包
```

不看到：

```text
pull
push
commit
branch
merge
rebase
```

验收：

```text
Git 不直接暴露给普通成员
修改包模式仍然可用
同步失败时可导出修改包兜底
技术详情默认折叠
```

---

## 5. 功能优先级

| 优先级 | 功能 |
|---|---|
| P0 | 打开项目 |
| P0 | 读取词条 |
| P0 | 编辑译文 |
| P0 | 保存译文 |
| P0 | 术语提示 |
| P1 | 任务管理 |
| P1 | 修改包导出 |
| P1 | 修改包导入 |
| P1 | 冲突处理 |
| P1 | 统计 |
| P2 | 评论争议 |
| P2 | 成品导出 |
| P2 | PWA 离线安装 |
| P3 | 前端封装 Git 同步 |
| P3 | 桌面封装 |

---

## 6. 共同开发规范

### 6.1 技术栈

推荐：

```text
Vue 3
Vite
TypeScript
PWA
JSON / JSONL
JSZip
```

谨慎使用：

```text
Electron
Tauri
SQLite
isomorphic-git
复杂状态管理库
大型富文本编辑器
```

不使用：

```text
自建服务器
必须在线的数据库
普通成员必须直接使用 Git 工具的流程
```

---

## 7. 命名规范

TypeScript 文件：

```text
projectFs.ts
entries.ts
terms.ts
tasks.ts
```

Vue 组件：

```text
EntryEditor.vue
TermHint.vue
TaskPanel.vue
```

类型：

```text
ProjectConfig
Entry
Term
Task
Comment
User
ProjectEvent
```

函数：

```text
loadEntries()
saveEntry()
updateEntryStatus()
matchTerms()
createTask()
exportChangePackage()
```

状态值：

```text
untranslated
translated
proofread
reviewed
disputed
in_progress
completed
```

---

## 8. TypeScript 规范

所有核心类型集中在：

```text
model/types.ts
```

禁止：

- 多个文件重复定义相似类型；
- 滥用 `any`；
- 页面中写复杂业务类型；
- 随意改变数据字段名。

可以使用 `unknown`，但解析处必须校验。

---

## 9. 数据读写规范

所有 JSONL 操作必须通过：

```text
utils/jsonl.ts
```

推荐函数：

```ts
parseJsonl<T>(text: string): T[]
stringifyJsonl<T>(rows: T[]): string
```

所有本地文件操作必须通过：

```text
services/projectFs.ts
```

页面和组件不得直接读写项目数据文件。

---

## 10. 权限规范

所有权限判断必须通过：

```ts
can(user, action)
```

禁止在页面中到处写：

```ts
user.roles.includes("owner")
```

多角色权限计算：

```text
最终权限 = 多个角色权限并集 + allow_permissions - deny_permissions
```

权限是软权限，不能暗示可以抵御恶意篡改。

---

## 11. Git 封装规范

Git 可以作为底层同步机制，但普通成员界面不直接暴露 Git。

普通成员看到：

```text
同步项目
上传修改
提交任务
内容冲突
```

不看到：

```text
pull
push
commit
branch
merge
rebase
```

代码分层：

```text
UI → sync.ts → gitAdapter.ts → 底层 Git
```

禁止：

```text
Vue 页面直接执行 Git 操作
entries.ts 直接执行 Git 操作
tasks.ts 直接执行 Git 操作
```

---

## 12. Vibe Coding 规范

每次让 AI 写代码，应限制范围。

推荐提示词：

```text
请只修改 src/services/entries.ts。
目标：实现 saveEntry(entry)。
约束：
1. 不修改 UI。
2. 不修改数据结构。
3. 不新增依赖。
4. JSONL 读写必须调用 utils/jsonl.ts。
5. 文件读写必须调用 projectFs.ts。
```

避免：

```text
帮我把整个软件做出来。
帮我重构整个项目。
帮我一次性实现完整协作系统。
```

AI 修改代码时应要求：

- 只改指定文件；
- 不重构无关模块；
- 不新增不必要依赖；
- 不改变数据格式；
- 不把业务逻辑写进页面；
- 不绕过已有 service；
- 修改后说明变更点。

---

## 13. 简约设计检查表

新增功能前，先问：

```text
是否服务核心流程？
是否能用现有模块实现？
是否会增加普通成员理解成本？
是否会增加维护者排查成本？
是否会破坏本地优先？
是否会破坏离线可用？
是否会让 AI 更难安全修改？
是否有更简单的替代方案？
```

如果答案不明确，暂缓实现。

---

## 14. Definition of Done

一个功能完成前，必须满足：

```text
能运行
没有明显 TypeScript 错误
不破坏已有功能
符合模块边界
不改变既有数据格式
错误情况有提示
危险操作有确认
```

服务模块还应满足：

```text
函数命名清楚
输入输出明确
不依赖 UI
可复用
有基本错误处理
```

UI 模块还应满足：

```text
按钮文案清楚
普通用户能理解
加载状态明确
错误提示明确
不暴露底层技术术语
```

---

## 15. 测试规范

必须维护样例项目：

```text
examples/simple-project/
```

每次修改后至少手动测试：

```text
打开项目
加载词条
编辑译文
保存译文
刷新后译文仍存在
术语提示正常
任务进度正常
修改包导出正常
修改包导入预览正常
统计数字正确
```

建议给以下模块写单元测试：

```text
jsonl.ts
entries.ts
terms.ts
tasks.ts
changes.ts
stats.ts
permissions.ts
```

---

## 16. 不应实现的方向

除非重新评估项目定位，否则不要实现：

```text
实时多人在线编辑
服务器数据库
在线账号系统
强权限企业系统
完整 Git 客户端
复杂分支图
插件市场
内置 AI 翻译平台
复杂富文本评论
跨项目组织管理
积分商城式贡献系统
```

