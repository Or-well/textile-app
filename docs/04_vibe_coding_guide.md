# AGENTS.md

## 1. Purpose

This file defines the rules that AI coding assistants must follow when working on this project.

This project is a local-first translation collaboration tool for fan translation / localization teams.

The assistant must prioritize:

```text
simplicity
maintainability
local-first design
offline usability
clear module boundaries
small-step development
well commented
well documented
human-readable data
vibe-coding friendly changes
```

Do not treat this project as a large online platform, enterprise workflow system, or general-purpose text editor.

---

## 2. Project Goal

The final product should allow users to:

```text
open a local translation project folder
read translation entries
edit translations
save changes locally
view term hints
manage tasks
comment and mark disputes
export change packages
import change packages
resolve conflicts
view progress statistics
export final release files
optionally sync through Git hidden behind simple UI actions
```

Normal users should understand the product in terms of:

```text
project
task
entry
source text
translation
term
comment
save
submit
sync
conflict
export
```

Normal users should not need to understand:

```text
Git
JSONL
schema
commit
push
pull
branch
merge
rebase
repository
remote
SHA
```

---

## 3. Core Technical Direction

Use:

```text
Vue 3
Vite
TypeScript
local project folder
JSON / JSONL
PWA-compatible design
JSZip for change packages
optional desktop wrapper later
```

Avoid unless explicitly requested:

```text
backend server
database server
required online account system
complex state management
complex workflow engine
full Git client in the browser
large UI framework migration
```

---

## 4. Expected Project Structure

Use this structure unless there is a strong reason to change it:

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

Do not create new top-level architectural categories without explaining why.

---

## 5. Layering Rules

The project must follow this dependency direction:

```text
UI pages / components
  ↓
services
  ↓
projectFs
  ↓
local project folder
```

Correct:

```text
EntryEditor.vue calls entries.saveEntry()
entries.ts calls projectFs.writeTextFile()
projectFs.ts writes the local JSONL file
```

Wrong:

```text
EntryEditor.vue directly reads or writes JSONL files
TaskPage.vue directly modifies tasks/tasks.jsonl
EntryEditor.vue directly executes Git commands
```

### UI Layer

Pages and components may:

```text
display data
handle user input
call services
show loading states
show error messages
emit events
```

Pages and components must not:

```text
parse JSONL directly
write local project files directly
perform complex permission logic
perform complex statistics
perform change-package merging
execute Git operations
```

### Service Layer

Services contain business logic.

Examples:

```text
entries.ts manages entries
terms.ts manages terms
tasks.ts manages tasks
changes.ts manages change packages
exporter.ts manages release export
stats.ts calculates statistics
sync.ts wraps sync actions
```

### File System Layer

`projectFs.ts` is the only module that should directly handle local file operations.

It may:

```text
open project directory
read text files
write text files
read JSON
write JSON
read JSONL
write JSONL
list files
ensure directories
check file existence
```

It must not contain translation, task, term, permission, comment, export, or sync business logic.

---

## 6. Module Responsibilities

### `model/types.ts`

Contains shared TypeScript types only.

Do not put business logic here.

Core types should include:

```text
ProjectConfig
ProjectFile
Member
Role
Entry
EntryStatus
Term
Task
TaskStatus
Comment
ProjectEvent
ChangePackageManifest
ProjectStats
```

### `utils/jsonl.ts`

All JSONL parsing and serialization must go here.

Expected functions:

```text
parseJsonl<T>(text: string): T[]
stringifyJsonl<T>(rows: T[]): string
```

Other modules must not reimplement JSONL parsing.

### `services/projectFs.ts`

Only local file access.

No entry, task, term, or permission logic.

### `services/project.ts`

Project configuration and member loading.

Reads:

```text
project.json
members.json
```

### `services/entries.ts`

Entry business logic.

Responsible for:

```text
load entries
save entries
update target text
update status
find entries
filter entries
locate entry chunks
```

### `services/terms.ts`

Term management and term matching.

Keep matching simple unless explicitly asked:

```text
exact source match
variant match
longest match first
no complex tokenization by default
```

### `services/tasks.ts`

Task management.

Task status and entry status must remain separate.

### `services/permissions.ts`

Soft permission checks.

All permission checks must go through:

```text
can(user, action)
```

Do not scatter direct role checks across UI.

### `services/comments.ts`

Comments and disputes.

Prefer plain text comments first.

Do not introduce rich text unless explicitly requested.

### `services/changes.ts`

Change-package import/export and conflict detection.

Never silently overwrite conflicts.

### `services/exporter.ts`

Final release export and reports.

### `services/stats.ts`

Read-only statistics.

Stats should not mutate project data.

### `services/history.ts`

Event logs.

### `services/sync.ts`

Business-facing sync wrapper.

UI should call `sync.ts`, not `gitAdapter.ts`.

### `services/gitAdapter.ts`

Optional low-level Git adapter.

Do not expose Git details to normal users.

---

## 7. Data Format Rules

Project data should remain local and human-readable.

Preferred formats:

```text
JSON for configuration
JSONL for entries, terms, tasks, comments, logs
ZIP for change packages and release packages
Markdown / text for reports
```

Avoid:

```text
SQLite as the primary source
binary custom formats
deeply nested JSON
server-only formats
```

### Standard Project Folder

```text
project/
  project.json
  members.json
  source/
  entries/
  terms/
  comments/
  tasks/
  logs/
  exports/
  changes/
```

### Entry Data

Entries should remain flat and readable.

Good:

```json
{
  "id": "script_001:000001",
  "file_id": "script_001",
  "index": 1,
  "source": "今日はいい天気ですね。",
  "target": "今天天气真好啊。",
  "status": "translated",
  "updated_by": "user_a"
}
```

Avoid deep nesting unless necessary.

### Schema Changes

Do not rename or remove existing data fields casually.

If a data format change is necessary:

```text
explain the reason
preserve compatibility when possible
update examples
update types
update documentation
```

---

## 8. Role and Permission Rules

Members can have multiple roles.

Correct:

```json
{
  "id": "user_b",
  "name": "小B",
  "roles": ["translator", "proofreader", "term_manager"],
  "allow_permissions": [],
  "deny_permissions": [],
  "active": true
}
```

Permission calculation:

```text
final permissions = union of role permissions + allow_permissions - deny_permissions
```

Do not assume one user has only one identity.

Do not force the user to globally switch between translator/proofreader/reviewer modes.

UI should show available actions based on:

```text
current user
current task
current page
can(user, action)
```

Permissions are soft permissions only.

They are for:

```text
preventing mistakes
controlling UI actions
guiding workflow
showing warnings
```

They are not for:

```text
defending against malicious local file edits
cryptographic access control
server-side security
```

---

## 9. Task Rules

Entry status and task status are different.

Entry status examples:

```text
untranslated
translated
proofread
reviewed
disputed
```

Task status examples:

```text
unassigned
assigned
in_progress
submitted
completed
reclaimed
blocked
```

Do not mix them.

Task progress should be calculated from entry status, not manually stored as a percentage.

Task submit methods:

```text
change_package
git_hidden
git_manual
```

UI labels should be:

```text
导出修改包
同步提交
由负责人处理
```

Do not show internal values to normal users.

---

## 10. Git and Sync Rules

Git may be used as an underlying collaboration and versioning mechanism.

But Git must not be directly exposed to normal users.

Normal users should see:

```text
同步项目
上传修改
提交任务
内容冲突
版本历史
```

Normal users should not see:

```text
pull
push
commit
branch
merge
rebase
origin
remote
HEAD
SHA
checkout
stash
```

### Sync Architecture

Use:

```text
UI → sync.ts → gitAdapter.ts → underlying Git implementation
```

Do not call Git directly from Vue components.

Do not call Git directly from entries/tasks/comments services.

### Fallback

If sync fails, provide a change-package fallback:

```text
同步失败。你可以先导出修改包，交给负责人合并。
```

### Browser Version

In PWA/browser mode, do not prioritize a full Git client.

Desktop wrapper may later provide stronger Git integration.

---

## 11. UI Copy Rules

Use simple user-facing language.

Prefer:

```text
打开项目
同步项目
保存
保存并下一条
提交任务
上传修改
导出修改包
导入修改包
内容冲突
查看统计
导出成品
```

Avoid user-facing technical terms:

```text
repository
commit
push
pull
branch
merge conflict
JSONL
schema
remote
SHA
```

Technical details may be hidden behind:

```text
查看技术详情
```

---

## 12. Simplicity Rules

Keep the project simple.

Do not over-engineer.

Before adding a new feature, check:

```text
Does it serve the core translation workflow?
Can existing modules handle it?
Will it increase user confusion?
Will it make maintenance harder?
Will it make AI edits less safe?
Does it break local-first or offline use?
```

If unsure, do not add it yet.

### Avoid by Default

```text
real-time multiplayer editing
server database
online account system
enterprise permission system
full Git client
complex branch visualizer
plugin marketplace
built-in AI translation platform
rich-text comment system
large-scale organization management
```

---

## 13. Dependency Rules

Do not add dependencies casually.

Before adding a dependency, explain:

```text
what it does
why it is needed
what alternatives exist
whether it can be removed later
```

Acceptable dependencies may include:

```text
JSZip for ZIP files
PWA plugin for offline support
small utility libraries when clearly useful
```

Be cautious with:

```text
large UI frameworks
rich text editors
state management libraries
browser Git implementations
large chart libraries
```

---

## 14. AI Coding Rules

When modifying code, follow these rules:

```text
change only the files requested
do not rewrite unrelated modules
do not introduce new dependencies unless asked
do not change data formats unless asked
do not move business logic into Vue components
do not bypass service modules
do not perform broad refactors
do not delete examples or docs
```

If a requested task requires changing more files than requested, say so first and list the files.

Do not silently expand scope.

---

## 15. Preferred AI Task Format

When given a task, respond and implement within this pattern:

```text
Scope:
- files to change

Goal:
- what will be implemented

Constraints:
- what will not be touched

Result:
- completed changes
- any limitations
- how to test
```

For coding tasks, keep changes small and reviewable.

---

## 16. Error Handling Rules

User-facing errors should be understandable.

Bad:

```text
JSON parse error at line 23
```

Better:

```text
词条数据文件格式有问题，无法读取。请联系项目负责人检查数据文件。
```

Technical error details may be logged or hidden behind “查看技术详情”.

---

## 17. Testing Expectations

After changes, ensure the project can still run:

```bash
npm run dev
```

When relevant, also check:

```bash
npm run build
```

Manual test checklist:

```text
open project
load entries
edit translation
save translation
refresh and confirm saved data remains
term hints work
task progress works
change package export/import works if touched
statistics remain correct
```

Do not claim a feature is complete if it has not been tested or cannot be tested.

---

## 18. Git Commit Guidance

Use small commits.

Examples:

```text
add core types
add jsonl utilities
add entry loading
add entry editor
add term hints
fix entry save error
add task service
```

Do not mix unrelated changes in one commit.

---

## 19. Documentation Rules

Update documentation when changing:

```text
data formats
module responsibilities
public workflows
permission behavior
task behavior
sync behavior
export format
```

If examples become outdated, update:

```text
examples/simple-project/
```

---

## 20. Definition of Done

A change is done only if:

```text
it runs
it is small and scoped
it follows module boundaries
it does not break existing behavior
it does not casually change data formats
errors are handled reasonably
user-facing wording is understandable
tests or manual checks were described
```

For service modules:

```text
clear function names
clear input/output
no UI dependency
reusable by other modules
basic error handling
```

For UI modules:

```text
simple layout
clear button text
loading state if needed
error display if needed
no direct file writes
no hidden business logic
```

---

## 21. If Unsure

If unsure about architecture, do not improvise.

Ask or state the uncertainty.

Prefer the smallest safe implementation.

Do not introduce a large abstraction just in case.

The project should remain:

``` text
easy for a human to understand
easy for AI to modify safely
easy to roll back
easy to test with examples/simple-project
```
