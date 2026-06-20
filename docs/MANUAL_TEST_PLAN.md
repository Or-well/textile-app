# Textile 全链路手工测试集

本文档用于对 Textile 执行可重复、可留证、可清理的全链路手工测试。测试不直接使用仓库 `examples/`，所有项目、修改包、导出物和故障样本都在独立临时工作区中创建。

## 1. 测试目标

手工测试同时验证：

- 用户能否完成真实工作流程。
- 权限不足时是否给出明确提示。
- 页面显示、状态和统计是否一致。
- 项目磁盘数据是否正确写入。
- 导入、覆盖和删除失败时是否避免部分写入。
- `.hproj`、修改包、成品和程序更新是否符合文档语义。
- 测试结束后是否没有遗留无用目录、临时包和下载文件。

手工测试不替代单元测试。开始前仍需运行：

```powershell
npm.cmd run test:unit
npm.cmd run build
```

## 2. 测试级别

| 级别 | 使用时机 | 目标时长 | 范围 |
| --- | --- | ---: | --- |
| Smoke | 每次重要提交后 | 15-25 分钟 | 创建项目、添加文件、翻译、校对、备份、重开 |
| Regression | 修改相关模块后 | 45-90 分钟 | 执行本次修改影响的章节及相邻链路 |
| Release | 正式发布前 | 2-4 小时 | 全部 P0/P1 用例 |
| Update | 发布候选安装包完成后 | 30-60 分钟 | 旧版安装、发现新版、安全阻止、安装重启 |

优先级：

- `P0`：失败时禁止发布，涉及数据丢失、无法启动、无法保存、错误覆盖或更新失败。
- `P1`：核心业务或权限错误，发布前必须通过。
- `P2`：辅助功能、文案、非关键交互，可评估后延期。

结果：

- `PASS`：步骤和预期全部满足。
- `FAIL`：存在可复现偏差。
- `BLOCKED`：环境或前置条件不足，不能视为通过。
- `SKIP`：当前发布范围明确不适用，并记录原因。

## 3. 发布门槛

正式发布必须满足：

- 所有 `P0` 用例为 `PASS`。
- 所有适用的 `P1` 用例为 `PASS`。
- `BLOCKED` 用例必须由负责人确认风险，不能静默忽略。
- 没有未解释的项目文件变化和临时目录残留。
- 安装升级后测试项目仍能打开。
- 失败记录包含截图、日志、版本、操作步骤和测试数据。

## 4. 测试环境矩阵

最低覆盖：

| 编号 | 环境 | 浏览器/程序 | 用途 |
| --- | --- | --- | --- |
| ENV-WEB | Web/PWA | 当前稳定版 Chrome 或 Edge | File System Access、PWA、Web 更新 |
| ENV-TAURI | Windows 桌面版 | 当前候选 Tauri 安装包 | 本地运行、安装、自动更新 |
| ENV-OLD | 上一公开版本 | 已安装旧版 Textile | Update 测试 |

项目形态：

| 编号 | 形态 | 用途 |
| --- | --- | --- |
| STORE-DIR | 普通本地项目文件夹 | 日常编辑和磁盘检查 |
| STORE-HPROJ | 从 `.hproj` 导入得到的本地项目 | 备份、迁移和导入失败 |

工作流：

| 编号 | 校对次数 | 审核 | 自校对 | 同人多轮校对 |
| --- | ---: | --- | --- | --- |
| WF-STRICT | 1 | 开启 | 禁止 | 禁止 |
| WF-NO-REVIEW | 1 | 关闭 | 禁止 | 禁止 |
| WF-NO-QA | 0 | 关闭 | 不适用 | 不适用 |
| WF-MULTI | 2 | 开启 | 禁止 | 禁止 |

## 5. 测试角色

在测试项目中创建以下成员：

| 成员名 | 角色 | 测试密码 | 主要用途 |
| --- | --- | --- | --- |
| `owner-test` | owner | 仅测试环境使用 | 项目管理、导入、发布更新 |
| `translator-a` | translator | 仅测试环境使用 | 翻译和普通修改包 |
| `proofreader-a` | proofreader | 仅测试环境使用 | 校对 |
| `proofreader-b` | proofreader | 仅测试环境使用 | 第二轮校对 |
| `reviewer-a` | reviewer | 仅测试环境使用 | 审核 |
| `readonly-a` | readonly | 仅测试环境使用 | 权限拒绝和项目更新接收 |

不要在文档、截图和缺陷单中记录真实生产密码。测试完成后删除整个测试工作区。

## 6. 测试工作区

在系统临时目录下创建独立根目录：

```powershell
$ManualTestRoot = Join-Path $env:TEMP "Textile-manual-test"
$ResolvedTempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd("\") + "\"
$ResolvedManualTestRoot = [System.IO.Path]::GetFullPath($ManualTestRoot)

if (
  -not $ResolvedManualTestRoot.StartsWith(
    $ResolvedTempRoot,
    [System.StringComparison]::OrdinalIgnoreCase
  ) -or
  [System.IO.Path]::GetFileName($ResolvedManualTestRoot) -ne "Textile-manual-test"
) {
  throw "测试目录不在预期临时路径中。"
}

if (Test-Path -LiteralPath $ResolvedManualTestRoot) {
  throw "测试目录已存在。请先确认其中没有需要保留的测试证据。"
}

New-Item -ItemType Directory -Path $ResolvedManualTestRoot | Out-Null

$Directories = @(
  "projects",
  "imports",
  "packages",
  "packages\keys",
  "exports",
  "evidence",
  "fixtures"
)

foreach ($Directory in $Directories) {
  New-Item -ItemType Directory -Path (Join-Path $ResolvedManualTestRoot $Directory) |
    Out-Null
}

Get-ChildItem $ResolvedManualTestRoot
```

预期结构：

```text
Textile-manual-test/
  projects/
  imports/
  packages/
  exports/
  evidence/
  fixtures/
```

禁止：

- 在仓库 `examples/` 中执行测试。
- 使用唯一的真实翻译项目。
- 把成员身份私钥放进项目目录。
- 清理目录时使用未经校验的变量或通配符递归删除。

## 7. 固定测试数据

### 7.1 源文件

创建 `fixtures/script_a.txt`：

```powershell
@'
今日はいい天気ですね。
そうだな。
先輩、魔術回路が暴走しています！
落ち着いて、順番に確認しましょう。
この選択は後戻りできません。
セーブしますか？
はい
いいえ
変数 {player_name} を保持してください。
[wait time=500]
第一章 終了
次回へ続く
'@ | Set-Content (
  Join-Path $ResolvedManualTestRoot "fixtures\script_a.txt"
) -Encoding utf8

$ScriptAPath = Join-Path $ResolvedManualTestRoot "fixtures\script_a.txt"
$ScriptAText = (Get-Content $ScriptAPath -Raw -Encoding utf8).TrimEnd("`r", "`n")
[System.IO.File]::WriteAllText(
  $ScriptAPath,
  $ScriptAText,
  [System.Text.UTF8Encoding]::new($false)
)
```

创建 `fixtures/script_a_updated.txt`：

```powershell
@'
今日はとてもいい天気ですね。
そうだな。
先輩、魔術回路が暴走しています！
落ち着いて、順番に確認しましょう。
この選択は後戻りできません。
セーブしますか？
はい
いいえ
変数 {player_name} を保持してください。
[wait time=500]
第一章 終了
次回へ続く
追加された新しい行です。
'@ | Set-Content (
  Join-Path $ResolvedManualTestRoot "fixtures\script_a_updated.txt"
) -Encoding utf8

$ScriptAUpdatedPath = Join-Path $ResolvedManualTestRoot "fixtures\script_a_updated.txt"
$ScriptAUpdatedText = (
  Get-Content $ScriptAUpdatedPath -Raw -Encoding utf8
).TrimEnd("`r", "`n")
[System.IO.File]::WriteAllText(
  $ScriptAUpdatedPath,
  $ScriptAUpdatedText,
  [System.Text.UTF8Encoding]::new($false)
)
```

创建 `fixtures/script_b.json`：

```powershell
@'
[
  {
    "key": "scene_b_001",
    "speaker": "美咲",
    "source": "準備はできましたか？",
    "context": "作戦開始前"
  },
  {
    "key": "scene_b_002",
    "speaker": "蓮",
    "source": "いつでも行ける。",
    "context": "落ち着いた口調"
  },
  {
    "key": "scene_b_003",
    "speaker": "",
    "source": "扉が静かに開いた。",
    "context": "地の文"
  }
]
'@ | Set-Content (
  Join-Path $ResolvedManualTestRoot "fixtures\script_b.json"
) -Encoding utf8

$ScriptBPath = Join-Path $ResolvedManualTestRoot "fixtures\script_b.json"
$ScriptBText = (Get-Content $ScriptBPath -Raw -Encoding utf8).TrimEnd("`r", "`n")
[System.IO.File]::WriteAllText(
  $ScriptBPath,
  $ScriptBText,
  [System.Text.UTF8Encoding]::new($false)
)
```

### 7.2 译文导入文件

创建 `fixtures/script_a_translation.csv`：

```powershell
@'
key,source,target,context
line_000001,今日はいい天気ですね。,今天天气真好。,天气对话
line_000002,そうだな。,是啊。,
line_000003,先輩、魔術回路が暴走しています！,前辈，魔术回路正在失控！,
missing_key,存在しない,不应导入,
'@ | Set-Content (
  Join-Path $ResolvedManualTestRoot "fixtures\script_a_translation.csv"
) -Encoding utf8

$TranslationCsvPath = Join-Path $ResolvedManualTestRoot "fixtures\script_a_translation.csv"
$TranslationCsvText = (
  Get-Content $TranslationCsvPath -Raw -Encoding utf8
).TrimEnd("`r", "`n")
[System.IO.File]::WriteAllText(
  $TranslationCsvPath,
  $TranslationCsvText,
  [System.Text.UTF8Encoding]::new($false)
)
```

### 7.3 术语导入文件

创建 `fixtures/terms.csv`：

```powershell
@'
source,target,pos,note
魔術回路,魔术回路,名词,保持统一
セーブ,保存,动词,界面动作
先輩,前辈,称谓,根据角色关系使用
'@ | Set-Content (
  Join-Path $ResolvedManualTestRoot "fixtures\terms.csv"
) -Encoding utf8

$TermsCsvPath = Join-Path $ResolvedManualTestRoot "fixtures\terms.csv"
$TermsCsvText = (Get-Content $TermsCsvPath -Raw -Encoding utf8).TrimEnd("`r", "`n")
[System.IO.File]::WriteAllText(
  $TermsCsvPath,
  $TermsCsvText,
  [System.Text.UTF8Encoding]::new($false)
)
```

### 7.4 故障样本

创建损坏 JSON：

```powershell
[System.IO.File]::WriteAllText(
  (Join-Path $ResolvedManualTestRoot "fixtures\broken.json"),
  '{"broken":',
  [System.Text.UTF8Encoding]::new($false)
)
```

修改包篡改样本必须从测试导出的修改包复制后制作，不能修改唯一原件。

## 8. 证据和结果记录

每次 Release 测试在：

```text
evidence/<版本>-<日期>/
```

保存：

- 测试结果表。
- 失败截图。
- 浏览器控制台错误。
- Tauri 日志。
- 关键磁盘结构截图或文本。
- 导出包文件名和 SHA-256。

创建证据目录：

```powershell
$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$TestDate = Get-Date -Format "yyyy-MM-dd"
$EvidenceDirectory = Join-Path $ResolvedManualTestRoot "evidence\$Version-$TestDate"
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
```

结果表模板：

```markdown
| 用例 | 结果 | 环境 | 执行人 | 时间 | 证据/缺陷 |
| --- | --- | --- | --- | --- | --- |
| MT-PRJ-001 | PASS | ENV-WEB |  |  |  |
```

缺陷至少记录：

```text
标题：
版本：
环境：
项目形态：
当前成员：
前置条件：
复现步骤：
实际结果：
预期结果：
是否可重复：
磁盘影响：
截图/日志：
清理状态：
```

## 9. Smoke 测试清单

Smoke 必须按顺序执行：

| 顺序 | 用例 | 目标 |
| ---: | --- | --- |
| 1 | MT-PRJ-001 | 创建项目 |
| 2 | MT-FILE-001 | 添加源文件 |
| 3 | MT-ENTRY-001 | 保存译文 |
| 4 | MT-HIST-001 | 查看和恢复历史 |
| 5 | MT-WF-001 | 校对和审核 |
| 6 | MT-COMMENT-001 | 新增评论 |
| 7 | MT-TERM-001 | 新增术语 |
| 8 | MT-STATS-001 | 统计一致 |
| 9 | MT-EXPORT-001 | 导出成品 |
| 10 | MT-HPROJ-001 | 导出项目备份 |
| 11 | MT-SESSION-001 | 关闭并重新打开 |
| 12 | MT-CLEAN-001 | 清理检查 |

## 10. 项目、会话和身份

### MT-PRJ-001 创建普通文件夹项目

- 优先级：`P0`
- 级别：Smoke、Release
- 环境：ENV-WEB、ENV-TAURI
- 前置：`projects/project-main` 不存在。

步骤：

1. 从启动中心点击“创建项目”。
2. 选择 `projects/project-main`。
3. 填写项目名 `Textile Manual Main`。
4. 源语言选日语，目标语言选简体中文。
5. 使用 WF-STRICT。
6. owner 名称设为 `owner-test`。
7. 完成创建。

预期：

- 自动登录并进入文件页。
- 磁盘出现 `project.json`、`members.json`。
- 出现 `source/`、`entries/`、`terms/`、`tasks/`、`comments/`、`logs/`、`exports/`、`changes/`。
- `members.json` 只有一个 owner，密码不是明文。
- `logs/events.jsonl`、术语和任务 JSONL 可读取。

证据：

```powershell
Get-ChildItem "$ResolvedManualTestRoot\projects\project-main"
Get-Content "$ResolvedManualTestRoot\projects\project-main\project.json"
```

清理：保留作为后续基线。

### MT-PRJ-002 非空关键目录拒绝覆盖

- 优先级：`P0`
- 级别：Release

步骤：

1. 复制 `project.json` 到一个专用目标目录。
2. 尝试在该目录创建新项目。
3. 取消或确认失败提示。

预期：

- Textile 拒绝覆盖。
- 原文件内容不变。
- 不出现半创建的成员或 entries 数据。

清理：删除专用失败测试目录。

### MT-SESSION-001 重新打开和会话恢复

- 优先级：`P0`
- 级别：Smoke、Release

步骤：

1. 登录 `owner-test`。
2. 关闭标签页或桌面程序。
3. 重新启动 Textile。
4. 从最近项目打开。

预期：

- 普通文件夹项目可以恢复。
- 授权失效时明确要求重新授权，而不是显示空白页。
- 有效会话恢复为原成员。
- 项目统计和文件数与关闭前一致。

### MT-SESSION-002 从最近项目移除

- 优先级：`P1`
- 级别：Regression、Release

步骤：

1. 从启动页移除测试项目。
2. 检查最近项目列表。
3. 检查磁盘目录。
4. 再次手工打开同一项目目录。

预期：

- 最近记录和会话被清除。
- 磁盘项目没有被删除。
- 项目仍可重新打开。

### MT-AUTH-001 登录错误和正确密码

- 优先级：`P1`
- 级别：Release

步骤：

1. 退出登录。
2. 使用不存在成员登录。
3. 使用错误密码登录。
4. 使用正确密码登录。

预期：

- 前三步不会进入项目。
- 提示不泄露密码哈希或盐。
- 正确密码进入项目。

### MT-MEMBER-001 创建角色成员

- 优先级：`P1`
- 级别：Regression、Release

步骤：

1. owner 进入设置 > 成员管理。
2. 创建测试角色表中的五个非 owner 成员。
3. 为每个成员分配对应角色。
4. 逐个登录确认。

预期：

- 成员可登录且显示正确名称。
- `members.json` 有对应角色。
- 密码只以哈希和盐保存。

### MT-MEMBER-002 停用、重置密码和 owner 保护

- 优先级：`P1`
- 级别：Release

步骤：

1. 重置 `readonly-a` 密码并用新密码登录。
2. 停用 `readonly-a`。
3. 尝试恢复其旧会话或登录。
4. 尝试普通停用 owner。

预期：

- 密码重置立即生效。
- 停用成员不能登录或恢复会话。
- owner 不能被普通停用流程移除。
- 项目始终保留可用管理成员。

## 11. 文件和分块

### MT-FILE-001 添加 TXT 与 JSON 源文件

- 优先级：`P0`
- 级别：Smoke、Release

步骤：

1. owner 添加 `script_a.txt`。
2. 再添加 `script_b.json`。
3. 打开两个文件。

预期：

- 文件列表新增两项。
- TXT 每行生成一条词条，包括空行时按当前解析结果核对。
- JSON 保留 key、speaker、source、context。
- `source/` 保存原文件。
- `entries/<file_id>/chunk_*.jsonl` 存在。
- `project.json.files` 最后更新且路径正确。

### MT-FILE-002 `chunk_size` 真正控制分块

- 优先级：`P1`
- 级别：Regression、Release
- 说明：当前没有设置页 UI，只在临时测试项目中受控编辑。

步骤：

1. 关闭项目。
2. 备份 `project.json`。
3. 将 `settings.chunk_size` 改为 `3`。
4. 重新打开项目。
5. 删除并重新添加一份 12 行测试文件，或新增 `script_chunk.txt`。
6. 检查 entries 目录。

预期：

- 12 条词条生成 4 个 chunk。
- 每个 chunk 最多 3 条。
- 文件名按 `chunk_0001.jsonl` 递增。
- 页面能加载全部词条。

清理：

1. 删除该专用测试文件。
2. 恢复原 `project.json` 或把 `chunk_size` 改回原值。
3. 重新打开确认正常。

### MT-FILE-003 更新源文件并保留译文

- 优先级：`P0`
- 级别：Regression、Release

步骤：

1. 给 `script_a.txt` 前三条填写译文。
2. 导出 `.hproj` 备份。
3. 使用 `script_a_updated.txt` 更新源文件。
4. 打开文件并检查词条。

预期：

- 可匹配的原词条保留译文和审计字段。
- 新增行作为新词条出现。
- 文件总词条数更新。
- source 和 entries 一致。
- 没有旧 chunk 残留导致重复词条。

### MT-FILE-004 导入译文并显示匹配统计

- 优先级：`P1`
- 级别：Regression、Release

步骤：

1. 对未翻译或重置后的 `script_a` 导入 `script_a_translation.csv`。
2. 记录匹配和跳过数。
3. 打开前三条。

预期：

- 三个有效 key 填入译文。
- `missing_key` 被跳过。
- 状态变为已翻译。
- `translated_by` 和 `updated_by` 是当前导入成员。

### MT-FILE-005 锁定、隐藏和删除

- 优先级：`P1`
- 级别：Release

步骤：

1. 锁定 `script_b`。
2. 尝试编辑其词条。
3. 隐藏该文件。
4. 检查成品导出摘要。
5. 取消隐藏和锁定。
6. 导出备份后删除 `script_b`。

预期：

- 锁定时不能保存词条。
- 隐藏文件不进入成品。
- 删除前有确认。
- 删除后 `project.json`、source 和 entries 均移除对应文件。
- 其他文件不受影响。

## 12. 翻译、历史和工作流

### MT-ENTRY-001 保存译文和审计字段

- 优先级：`P0`
- 级别：Smoke、Release

步骤：

1. 以 `translator-a` 登录。
2. 打开第一条未翻译词条。
3. 输入译文并保存。
4. 再修改译文并保存。
5. 不修改内容再次保存。

预期：

- 首次保存进入“已翻译/待校对”。
- `translated_by` 为 `translator-a`。
- `updated_by` 和 `updated_at` 更新。
- 两次真实变化生成历史。
- 无变化保存不生成空历史事件。

### MT-HIST-001 查看和恢复历史译文

- 优先级：`P0`
- 级别：Smoke、Release

步骤：

1. 在同一词条连续保存版本 A、B、C。
2. 打开历史面板。
3. 确认当前版本标记。
4. 恢复版本 A。

预期：

- 能看到修改人、时间、译文和状态。
- 首次记录前版本可见。
- 恢复需要确认。
- 恢复后追加新历史，不删除 B、C。
- 非空译文回到 translated，校对和审核字段清空。
- 恢复者写入 `updated_by`。
- `translated_by` 恢复为历史版本原译者，不错误归给恢复者。

### MT-HIST-002 恢复后校对权限提示

- 优先级：`P0`
- 级别：Regression、Release

步骤：

1. 让 `translator-a` 创建译文历史。
2. 由 owner 恢复其中一个版本。
3. 以 `proofreader-a` 登录。
4. 检查校对按钮。
5. 再以原译者身份检查。

预期：

- `proofreader-a` 可以校对。
- owner 恢复不会导致 owner 被误记为译者。
- 原译者在禁止自校对时不能校对，并显示具体原因。
- “待校对”状态与成员可操作性提示不混淆。

### MT-WF-001 完整翻译、校对、审核

- 优先级：`P0`
- 级别：Smoke、Release
- 工作流：WF-STRICT

步骤：

1. `translator-a` 保存译文。
2. `proofreader-a` 校对通过。
3. `reviewer-a` 审核通过。

预期：

- 状态依次为 translated、proofread、reviewed。
- `proofread_by` 包含校对者且次数为 1。
- `reviewed_by` 为审核者。
- 概览、文件和统计页进度同步变化。

### MT-WF-002 自校对和自审核阻止

- 优先级：`P1`
- 级别：Release

步骤：

1. 给 `translator-a` 临时增加校对权限。
2. 登录 `translator-a` 打开自己翻译的词条。
3. 检查校对动作和提示。
4. 给其临时增加审核权限，并在满足校对后检查审核。

预期：

- 禁止自校对时显示明确原因。
- 禁止自审核时不能审核自己的译文。
- 去掉临时权限后恢复原角色权限。

### MT-WF-003 两轮校对

- 优先级：`P1`
- 级别：Release
- 工作流：WF-MULTI

步骤：

1. 设置校对次数为 2。
2. `proofreader-a` 完成第一轮。
3. 同一成员尝试第二轮。
4. `proofreader-b` 完成第二轮。

预期：

- 第一轮显示“校对中 1/2”。
- 默认禁止同一成员重复校对，并显示原因。
- 第二名校对者完成后进入待审核。
- `proofread_by` 顺序和计数正确。

### MT-WF-004 流程退回

- 优先级：`P1`
- 级别：Release

步骤：

1. 准备已审核词条。
2. 有回退权限成员退回校对。
3. 再退回翻译。

预期：

- reviewed 可退回 proofread。
- proofread 可退回 translated。
- 退回只改变工作流，不恢复旧译文内容。
- 后续审计字段按状态清理。

### MT-WF-005 关闭审核后的完成语义

- 优先级：`P0`
- 级别：Regression、Release
- 工作流：WF-NO-REVIEW

步骤：

1. 关闭审核，保留 1 次校对。
2. 完成翻译和校对。
3. 查看概览和统计。
4. 勾选“只导出流程完成词条”。

预期：

- UI 显示“未启用审核”。
- 校对完成即视为流程完成。
- 审核权重为 0，其他权重重新归一化。
- 成品包含已完成校对的词条。

### MT-WF-006 关闭校对和审核

- 优先级：`P1`
- 级别：Release
- 工作流：WF-NO-QA

步骤：

1. 校对次数设为 0，关闭审核。
2. 保存一条非空译文。
3. 检查统计和完成过滤。

预期：

- 非空译文即可视为流程完成。
- 不出现校对或审核动作。
- 统计不要求不存在的流程阶段。

### MT-DISPUTE-001 标记和解决争议

- 优先级：`P1`
- 级别：Release

步骤：

1. 标记一个已翻译词条为争议。
2. 填写原因并添加评论。
3. 尝试校对或审核。
4. 解决争议。

预期：

- 主状态不新增第五种 disputed 状态。
- 争议标记和原因可见。
- 争议期间工作流动作被阻止并提示。
- 解决后记录处理人和时间。

## 13. 上下文、术语、评论和任务

### MT-CONTEXT-001 上下文增删改

- 优先级：`P1`
- 级别：Regression、Release

步骤：

1. 新增上下文。
2. 修改上下文。
3. 清空并保存。
4. 检查 entries JSONL。

预期：

- 上下文写入词条 `context` 字段。
- `updated_by` 和 `updated_at` 更新。
- 不要求独立 `contexts/` 文件。

### MT-TERM-001 术语 CRUD 和词条提示

- 优先级：`P1`
- 级别：Smoke、Release

步骤：

1. 新建“魔術回路 -> 魔术回路”。
2. 打开包含该词的词条。
3. 检查右侧术语提示。
4. 编辑术语。
5. 删除术语并确认。

预期：

- 术语匹配当前原文。
- 编辑后提示同步更新。
- 删除前二次确认。
- `terms/terms.jsonl` 与页面一致。

### MT-TERM-002 术语导入和导出

- 优先级：`P2`
- 级别：Release

步骤：

1. 导入 `terms.csv`。
2. 记录新增、更新或跳过结果。
3. 导出 JSONL。
4. 检查导出内容。

预期：

- 三个术语可搜索。
- 字段映射正确。
- 导出文件可解析。

### MT-COMMENT-001 评论、回复和跳转

- 优先级：`P1`
- 级别：Smoke、Release

步骤：

1. 在词条添加评论。
2. 回复评论。
3. 标记解决，再重新打开。
4. 从项目评论页跳转回词条。

预期：

- 评论保存到对应文件和 entry index。
- 回复关系正确。
- 状态切换可见。
- 跳转定位到正确文件、词条和评论。

### MT-COMMENT-002 评论删除权限

- 优先级：`P1`
- 级别：Release

步骤：

1. `translator-a` 创建评论。
2. `readonly-a` 尝试删除。
3. 创建者删除自己的评论。
4. 有任意评论删除权限的成员删除另一条评论。

预期：

- 无权限成员没有入口或得到明确拒绝。
- 创建者可按权限删除自己的评论。
- 删除父评论时回复按当前语义一并删除。

### MT-TASK-001 任务全流程

- 优先级：`P1`
- 级别：Release

步骤：

1. owner 创建翻译任务，关联 `script_a` 的词条范围。
2. 分配给 `translator-a`。
3. translator 领取或开始任务。
4. 修改任务范围内词条。
5. 提交任务。
6. owner 完成任务。
7. 重新打开任务。

预期：

- 状态按未领取/已分配/进行中/已提交/已完成变化。
- 任务进度使用项目工作流口径。
- 无权限成员不能管理任务。
- 删除任务前二次确认。

## 14. 统计和权限

### MT-STATS-001 页面统计一致性

- 优先级：`P0`
- 级别：Smoke、Release

步骤：

1. 准备未翻译、已翻译、已校对、已审核、有争议词条各至少一条。
2. 查看概览、文件列表、任务和统计页。
3. 手工计算数量。

预期：

- 各页面对相同词条状态的统计一致。
- 综合进度使用项目权重。
- 有争议是独立计数，不改变主状态总数。

### MT-PERM-001 readonly 权限拒绝

- 优先级：`P0`
- 级别：Release

步骤：

1. 登录 `readonly-a`。
2. 尝试编辑译文、术语、上下文、任务和成员。
3. 尝试导出或导入权限不允许的修改包。
4. 查看允许读取的页面。

预期：

- 不显示无权限写入口，或操作时明确拒绝。
- 不发生磁盘写入。
- 可读取权限范围内页面。
- 不通过角色字符串绕过 deny 权限。

### MT-PERM-002 显式 deny 优先

- 优先级：`P1`
- 级别：Regression、Release

步骤：

1. 给测试成员一个包含编辑权限的角色。
2. 在 `deny_permissions` 禁止对应 action。
3. 登录并尝试操作。

预期：

- deny 优先于角色和 allow。
- UI 和 service 均拒绝。
- 去掉 deny 后权限恢复。

## 15. 修改包协作

准备两个同项目 ID 的副本：

- `project-main`：负责人主项目。
- `project-member`：从主项目 `.hproj` 导入的成员副本。

不要通过操作系统复制后随意修改 `project_id`。

### MT-CHANGE-001 导出普通修改包

- 优先级：`P0`
- 级别：Regression、Release

步骤：

1. 在 `project-member` 登录 `translator-a`。
2. 修改两个词条，新增一条评论。
3. 导出“我的全部修改”。
4. 保存到 `packages/`。

预期：

- 生成 ZIP 修改包。
- 预览 manifest 显示正确项目 ID、成员和摘要。
- 只收集当前成员相关修改。
- 没有身份私钥。

证据：

```powershell
Get-FileHash "$ResolvedManualTestRoot\packages\<实际文件名>" -Algorithm SHA256
```

### MT-CHANGE-002 主项目无冲突导入

- 优先级：`P0`
- 级别：Regression、Release

步骤：

1. 在 `project-main` 以 owner 选择普通修改包。
2. 检查预览、完整性、签名状态和摘要。
3. 应用修改包。
4. 打开受影响词条和评论。

预期：

- 项目 ID 匹配。
- 无冲突时可直接应用。
- 词条、评论和日志更新。
- 未涉及内容保持不变。
- 导入中失败时写入计划可恢复，页面不会报告假成功。

### MT-CHANGE-003 词条冲突处理

- 优先级：`P0`
- 级别：Release

步骤：

1. 从同一基线分别修改主项目和成员副本的同一词条。
2. 导出成员修改包。
3. 主项目导入。
4. 分别测试“保留主项目”“使用修改包”“手动处理”“跳过”。

预期：

- 每条冲突必须有处理结果。
- 未处理完不能应用。
- 选择结果与最终词条一致。
- 手动处理保存输入的译文和状态。

### MT-CHANGE-004 项目 ID 不匹配拒绝

- 优先级：`P0`
- 级别：Release

步骤：

1. 新建完全独立的 `project-other`。
2. 尝试导入 `project-member` 的修改包。

预期：

- 预检查显示项目不匹配。
- 不能应用。
- `project-other` 磁盘文件无变化。

### MT-CHANGE-005 内容 hash 篡改拒绝

- 优先级：`P0`
- 级别：Release

步骤：

1. 复制普通修改包为 `tampered.zip`。
2. 使用 ZIP 工具修改其中一个 entries 文件但不更新 manifest hash。
3. 导入篡改包。

预期：

- 完整性检查失败。
- 默认禁止导入。
- 没有项目写入。
- 只有拥有危险导入权限时才可能出现明确高风险入口和确认。

清理：删除 `tampered.zip`。

### MT-CHANGE-006 维护修改包风险确认

- 优先级：`P1`
- 级别：Release

步骤：

1. owner 创建一项项目设置或测试成员变更。
2. 导出维护修改包。
3. 在同项目副本导入。

预期：

- 预览明确显示维护类型和受影响内容。
- 成员、权限或凭据变更需要额外确认。
- owner 凭据或权限变化需要再次确认。

### MT-UPDATEPKG-001 发布和接收签名项目更新包

- 优先级：`P0`
- 级别：Release

步骤：

1. owner 生成身份密钥并安全导出到 `packages/keys/`。
2. 在主项目完成一轮权威修改。
3. 发布签名项目更新包。
4. 在成员副本以 `readonly-a` 或有接收权限成员导入。

预期：

- 项目更新包必须签名。
- 签名有效且发布者有权限。
- base revision 与本地匹配时可接收。
- 正文、源文件、术语、任务和公开成员信息更新。
- 接收方本地密码哈希和盐保留。
- 身份私钥不进入包。

### MT-UPDATEPKG-002 未导出个人修改阻止接收

- 优先级：`P0`
- 级别：Release

步骤：

1. 在成员副本产生个人修改但不导出。
2. 尝试接收新的项目更新包。
3. 先导出个人修改包。
4. 再尝试接收。

预期：

- 第一次被阻止并提示先导出。
- 导出后满足其他条件时可继续。
- 不静默覆盖个人修改。

### MT-UPDATEPKG-003 revision 不连续拒绝

- 优先级：`P0`
- 级别：Release

步骤：

1. 连续发布更新包 A、B。
2. 在旧基线副本跳过 A，直接导入 B。

预期：

- base revision 不匹配。
- 不写入项目。
- 提示获取连续更新或新基线。

## 16. 成品和项目备份

### MT-EXPORT-001 成品导出和报告

- 优先级：`P0`
- 级别：Smoke、Release

步骤：

1. 准备已完成、未翻译、争议和术语不一致词条。
2. 导出 JSON 成品，包含原文、key、manifest 和报告。
3. 保存 ZIP 到 `exports/`。
4. 解压检查。

预期：

- `release/` 中有成品。
- `manifest.json` 存在且与选择一致。
- untranslated、disputes、term-check 报告存在。
- 隐藏文件和隐藏词条不进入成品。
- 项目内 `exports/` 不会被浏览器下载自动写入。

### MT-EXPORT-002 流程完成过滤

- 优先级：`P0`
- 级别：Regression、Release

分别测试：

1. 审核开启：只包含 reviewed。
2. 审核关闭、校对开启：包含完成校对。
3. 校对和审核关闭：包含非空译文。

预期：

- 三种设置严格使用各自完成语义。
- 页面导出前摘要与 ZIP 实际条数一致。

### MT-HPROJ-001 导出 `.hproj` 备份

- 优先级：`P0`
- 级别：Smoke、Release

步骤：

1. 从主项目导出 Textile 项目备份。
2. 保存到 `exports/`。
3. 检查文件大小和 hash。

预期：

- `.hproj` 非空。
- 包含项目配置、成员、source、entries、术语、任务、评论和日志。
- 不包含成员身份私钥。

### MT-HPROJ-002 预览不写入

- 优先级：`P0`
- 级别：Release

步骤：

1. 记录 `imports/` 当前目录列表。
2. 在启动页预览 `.hproj`。
3. 展开项目简介。
4. 取消预览。
5. 再次检查 `imports/`。

预期：

- 显示项目摘要和将创建的文件夹名称。
- 没有创建项目目录。
- 没有写入项目数据。

### MT-HPROJ-003 导入为本地项目

- 优先级：`P0`
- 级别：Release

步骤：

1. 选择 `.hproj`。
2. 选择 `imports/` 作为位置。
3. 完成导入。
4. 登录并打开词条。
5. 修改一条译文。

预期：

- 创建新的本地项目子目录。
- 保留原 `project_id`。
- 后续编辑写入新目录。
- 原 `.hproj` 文件不变化。

### MT-HPROJ-004 损坏项目包导入失败无残留

- 优先级：`P0`
- 级别：Release

步骤：

1. 复制 `.hproj` 为故障样本。
2. 使用 ZIP 工具删除 `project.json` 或破坏 JSONL。
3. 记录导入位置目录列表。
4. 尝试导入。
5. 再次检查目录列表。

预期：

- 导入前校验失败。
- 不创建目标项目目录。
- 如果中断发生在写入阶段，已创建文件被恢复和清理。
- 清理不完整时错误列出具体残留路径。

清理：删除故障 `.hproj`。

## 17. 程序更新

### MT-WEBUPDATE-001 Web/PWA 已是最新版

- 优先级：`P1`
- 级别：Release

步骤：

1. 使用当前构建打开设置 > 更新。
2. 检查更新。

预期：

- 当前版本和 `public/version.json` 一致时显示最新版。
- 不显示虚假的待刷新提示。
- 发布地址为空时按钮明确禁用。

### MT-WEBUPDATE-002 同版本新构建待刷新优先级

- 优先级：`P0`
- 级别：Regression、Release

步骤：

1. 部署同版本号但不同 assets hash 的 PWA 构建。
2. 打开旧构建，等待 Service Worker 准备新版。
3. 在编辑页面或导入导出页面检查。
4. 再手动检查更新。

预期：

- 显示“新构建已准备好”。
- 编辑或写入期间显示暂缓原因。
- 后续“已是最新版”检查不会覆盖待刷新状态。
- 安全后可刷新。

### MT-TAURIUPDATE-001 首次安装

- 优先级：`P0`
- 级别：Update

步骤：

1. 在干净测试机安装候选 NSIS。
2. 启动并创建一个小测试项目。
3. 关闭并重开。

预期：

- 安装和启动成功。
- 设置页版本正确。
- 项目数据在重启后存在。

### MT-TAURIUPDATE-002 旧版升级到候选版

- 优先级：`P0`
- 级别：Update

步骤：

1. 安装上一公开版本。
2. 创建或打开测试项目。
3. 发布更高版本候选 Release。
4. 在旧版检查更新。
5. 下载、安装并重启。

预期：

- 发现更高语义版本。
- 下载和签名验证成功。
- 重启后版本更新。
- 原项目仍可打开且内容不变。

### MT-TAURIUPDATE-003 更新安全阻止

- 优先级：`P0`
- 级别：Update

步骤：

1. 在旧版打开词条编辑页并产生未完成编辑。
2. 触发更新。
3. 再在导入导出操作期间触发。
4. 完成操作后重试。

预期：

- 不安全状态显示具体阻止原因。
- 不强制重启覆盖当前操作。
- 状态安全后允许安装并重启。

## 18. 故障和恢复

### MT-FAIL-001 文件夹授权丢失

- 优先级：`P1`
- 级别：Release

步骤：

1. 打开普通项目。
2. 关闭应用。
3. 在浏览器设置中撤销站点文件系统权限，或换新浏览器配置。
4. 从最近项目恢复。

预期：

- 明确提示重新授权。
- 不显示成功但空数据。
- 重新选择同目录后可恢复。

### MT-FAIL-002 外部移动项目目录

- 优先级：`P1`
- 级别：Release

步骤：

1. 关闭 Textile。
2. 在操作系统中临时重命名测试项目目录。
3. 从最近项目打开。
4. 恢复目录名并手工打开。

预期：

- 最近项目恢复失败有明确提示。
- 不创建空项目替代原项目。
- 恢复目录后数据仍正常。

### MT-FAIL-003 格式错误导入拒绝

- 优先级：`P0`
- 级别：Release

步骤：

1. 尝试把 `broken.json` 作为源文件或译文导入。
2. 尝试导入缺少 manifest 的 ZIP 修改包。

预期：

- 解析或预检查阶段失败。
- 不更新 `project.json`。
- 不新增坏 entries。
- 不显示导入成功。

### MT-FAIL-004 操作取消

- 优先级：`P1`
- 级别：Release

覆盖：

- 取消创建项目目录选择。
- 取消添加源文件。
- 取消删除文件/术语/任务。
- 取消导入 `.hproj` 位置选择。
- 取消恢复历史版本。

预期：

- 无写入。
- 页面仍可继续操作。
- 不遗留空目录或临时状态。

## 19. 磁盘一致性检查

对每个 P0 写操作完成后至少抽查：

```powershell
$ProjectRoot = "$ResolvedManualTestRoot\projects\project-main"

Get-Content "$ProjectRoot\project.json" -Raw | ConvertFrom-Json | Out-Null
Get-Content "$ProjectRoot\members.json" -Raw | ConvertFrom-Json | Out-Null

Get-ChildItem "$ProjectRoot\entries" -Recurse -Filter "*.jsonl" |
  ForEach-Object {
    $FilePath = $_.FullName
    $LineNumber = 0
    Get-Content $FilePath | ForEach-Object {
      $LineNumber += 1
      if ($_.Trim()) {
        try {
          $_ | ConvertFrom-Json | Out-Null
        } catch {
          throw "JSONL 无效：$FilePath 第 $LineNumber 行"
        }
      }
    }
  }
```

检查：

- `project.json.files` 指向存在的 entries 目录。
- 非删除文件的 `source_path` 存在。
- chunk 不重复、不遗漏词条。
- `logs/events.jsonl` 可逐行解析。
- 评论文件可逐行解析。
- members 不含明文密码。
- 项目目录不含成员身份私钥。

## 20. 测试清理

### MT-CLEAN-001 清理和残留检查

- 优先级：`P0`
- 级别：Smoke、Release

先保存需要保留的证据到仓库外位置。然后确认测试根目录：

```powershell
$ResolvedTempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd("\") + "\"
$ResolvedManualTestRoot = [System.IO.Path]::GetFullPath($ManualTestRoot)

if (
  -not $ResolvedManualTestRoot.StartsWith(
    $ResolvedTempRoot,
    [System.StringComparison]::OrdinalIgnoreCase
  ) -or
  [System.IO.Path]::GetFileName($ResolvedManualTestRoot) -ne "Textile-manual-test"
) {
  throw "拒绝删除预期测试目录以外的路径：$ResolvedManualTestRoot"
}

Get-ChildItem -LiteralPath $ResolvedManualTestRoot -Recurse |
  Select-Object FullName
```

确认没有需要保留的证据后删除：

```powershell
Remove-Item -LiteralPath $ResolvedManualTestRoot -Recurse -Force
```

清理后检查：

```powershell
Test-Path -LiteralPath $ResolvedManualTestRoot
git status --short
```

预期：

- 测试目录不存在。
- 仓库没有因手工测试产生的项目、ZIP、`.hproj`、导出物或私钥。
- `examples/` 没有测试变化。
- 浏览器下载目录中没有遗留测试包。
- Tauri/PWA 测试产生的临时安装包按发布流程处理。

不要删除：

- 正式 updater 私钥和加密备份。
- 已发布版本的必要审计记录。
- 尚未复制到安全位置的缺陷证据。

## 21. Release 执行顺序

推荐顺序：

1. 创建全新测试工作区和固定数据。
2. 运行自动化单元测试和构建。
3. 执行 Smoke。
4. 执行项目、文件、翻译和工作流用例。
5. 执行术语、评论、任务和统计。
6. 从主项目导出 `.hproj`，创建成员副本。
7. 执行修改包和项目更新包链路。
8. 执行成品导出和 `.hproj` 故障用例。
9. 执行 Web/PWA 更新测试。
10. 使用候选安装包执行 Tauri 安装和升级测试。
11. 执行磁盘一致性检查。
12. 汇总 P0/P1 结果和缺陷。
13. 复制需要保留的证据。
14. 执行 MT-CLEAN-001。

## 22. Release 汇总模板

```markdown
# Textile <版本> 手工测试报告

## 环境

- Commit:
- Tag:
- Web 浏览器:
- Windows:
- Tauri 旧版本:
- Tauri 候选版本:
- 执行人:
- 日期:

## 汇总

| 优先级 | PASS | FAIL | BLOCKED | SKIP |
| --- | ---: | ---: | ---: | ---: |
| P0 |  |  |  |  |
| P1 |  |  |  |  |
| P2 |  |  |  |  |

## 发布结论

- [ ] 可以发布
- [ ] 修复后复测
- [ ] 暂缓发布

## 未解决问题

| 缺陷 | 严重度 | 影响 | 处理决定 |
| --- | --- | --- | --- |

## 数据和清理

- [ ] 测试项目已删除
- [ ] 临时包已删除
- [ ] 下载测试文件已删除
- [ ] 私钥未进入项目或仓库
- [ ] `git status --short` 已检查
```

## 23. 覆盖映射

| 业务边界 | 对应用例 |
| --- | --- |
| 项目创建和会话 | MT-PRJ、MT-SESSION、MT-AUTH |
| 成员和权限 | MT-MEMBER、MT-PERM |
| 源文件和分块 | MT-FILE |
| 翻译和历史 | MT-ENTRY、MT-HIST |
| 校对审核和争议 | MT-WF、MT-DISPUTE |
| 辅助协作 | MT-CONTEXT、MT-TERM、MT-COMMENT、MT-TASK |
| 统计 | MT-STATS |
| 普通修改包 | MT-CHANGE |
| 项目更新包 | MT-UPDATEPKG |
| 成品和备份 | MT-EXPORT、MT-HPROJ |
| 程序更新 | MT-WEBUPDATE、MT-TAURIUPDATE |
| 故障恢复 | MT-FAIL |
| 数据和垃圾检查 | MT-CLEAN、磁盘一致性检查 |

新增用户可见功能、数据写入路径或高风险操作时，必须在本测试集中增加或更新对应手工用例。
