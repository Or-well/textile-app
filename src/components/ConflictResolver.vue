<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  ChangeConflict,
  ConflictResolution,
  ConflictResolutionAction,
} from "../services/changes";
import type { Comment, Entry, Member, ProjectFile, Task, Term } from "../model/types";
import { getEntryDisplayName, getFileDisplayName } from "../model/displayNames";
import { getMemberDisplayName } from "../model/memberOptions";
import {
  hasVisibleText,
  hasWorkflowTarget,
} from "../model/status";

interface ConflictDraft {
  conflictId: string;
  entryId?: string;
  taskId?: string;
  action: ConflictResolutionAction | "";
  target?: string;
  context?: string;
  term?: Term;
  variantsText?: string;
}

const props = defineProps<{
  conflicts: ChangeConflict[];
  isApplying?: boolean;
  canApply?: boolean;
  disabledReason?: string;
  isProjectUpdate?: boolean;
  members?: Member[];
  files?: ProjectFile[];
}>();

const emit = defineEmits<{
  apply: [resolutions: ConflictResolution[]];
}>();

const drafts = ref<ConflictDraft[]>([]);

watch(
  () => props.conflicts,
  (conflicts) => {
    drafts.value = conflicts.map((conflict) => {
      if (conflict.kind === "entry") {
        return {
          conflictId: conflict.conflictId,
          entryId: conflict.entryId,
          action: "",
          target: conflict.mainEntry.target,
          context: conflict.mainEntry.context,
        };
      }

      if (conflict.kind === "term") {
        const term =
          conflict.mainTerm ??
          conflict.packageTerm ??
          conflict.deletion?.term;

        return {
          conflictId: conflict.conflictId,
          action: "",
          term: term ? cloneTerm(term) : undefined,
          variantsText: term?.variants.join("\n") ?? "",
        };
      }

      return {
        conflictId: conflict.conflictId,
        entryId: conflict.kind === "comment" ? conflict.entryId : undefined,
        taskId: conflict.kind === "task" ? conflict.taskId : undefined,
        action: "",
      };
    });
  },
  { immediate: true },
);

const unresolvedCount = computed(
  () => drafts.value.filter((draft) => !draft.action).length,
);
const canSubmit = computed(
  () => Boolean(props.canApply) && unresolvedCount.value === 0,
);

function applyBulkAction(action: "keep_main" | "use_package") {
  for (const conflict of props.conflicts) {
    updateAction(conflict, action);
  }
}

function updateAction(
  conflict: ChangeConflict,
  action: ConflictResolutionAction,
) {
  const draft = drafts.value.find(
    (item) => item.conflictId === conflict.conflictId,
  );

  if (!draft) {
    return;
  }

  draft.action = action;

  if (conflict.kind === "term") {
    const term =
      action === "use_package"
        ? conflict.packageTerm ?? conflict.deletion?.term
        : conflict.mainTerm ?? conflict.packageTerm ?? conflict.deletion?.term;

    draft.term = term ? cloneTerm(term) : undefined;
    draft.variantsText = term?.variants.join("\n") ?? "";
    return;
  }

  if (conflict.kind !== "entry") {
    return;
  }

  if (action === "use_package") {
    draft.target = conflict.packageEntry.target;
    draft.context = conflict.packageEntry.context;
  }

  if (action === "keep_main" || action === "skip") {
    draft.target = conflict.mainEntry.target;
    draft.context = conflict.mainEntry.context;
  }
}

function handleApply() {
  if (unresolvedCount.value > 0) {
    return;
  }

  emit(
    "apply",
    drafts.value.map((draft) => ({
      conflictId: draft.conflictId,
      entryId: draft.entryId,
      taskId: draft.taskId,
      action: draft.action as ConflictResolutionAction,
      target: draft.target,
      context: draft.context,
      term: draft.term
        ? {
            ...draft.term,
            variants: parseVariantsText(draft.variantsText ?? ""),
          }
        : undefined,
    })),
  );
}

function cloneTerm(term: Term): Term {
  return {
    ...term,
    variants: [...term.variants],
  };
}

function parseVariantsText(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatConflictReasons(conflict: ChangeConflict): string {
  const entryLabels: Record<string, string> = {
    target: "译文",
    status: "状态",
    translated_by: "译者",
    proofread_by: "校对成员",
    proofread_count: "校对次数",
    reviewed_by: "审核成员",
    disputed: "争议状态",
    dispute_reason: "争议原因",
    dispute_resolved_at: "争议解决时间",
    dispute_resolved_by: "争议解决人",
    context: "上下文",
  };
  const commentLabels: Record<string, string> = {
    deleted: "删除状态",
    status: "批注状态",
    resolved_at: "解决时间",
    resolved_by: "解决人",
  };
  const termLabels: Record<string, string> = {
    source: "原文",
    target: "推荐译名",
    part_of_speech: "词性",
    note: "备注",
    variants: "变体",
    case_sensitive: "大小写规则",
    deleted: "删除状态",
  };
  const taskLabels: Record<string, string> = {
    title: "任务名",
    description: "说明",
    type: "任务类型",
    scope: "任务范围",
    assignee: "负责人",
    status: "任务状态",
    target: "目标",
    submit_method: "提交方式",
    proofread_round: "校对轮次",
    created_by: "创建人",
    created_at: "创建时间",
    due_at: "截止时间",
    due_time_zone: "截止时区",
  };
  const labels =
    conflict.kind === "entry"
      ? entryLabels
      : conflict.kind === "comment"
        ? commentLabels
        : conflict.kind === "term"
          ? termLabels
          : taskLabels;

  return conflict.reasons
    .map((reason) => labels[reason] ?? "其他字段")
    .join("、");
}

function formatConflictTitle(conflict: ChangeConflict): string {
  if (conflict.kind === "entry") {
    return `词条 ${getEntryDisplayName(conflict.mainEntry, props.files)}`;
  }

  if (conflict.kind === "comment") {
    const body = conflict.mainComment?.body ?? conflict.packageComment?.body ?? "";
    const summary = body.trim().replace(/\s+/g, " ").slice(0, 24);
    return summary ? `批注“${summary}${body.length > 24 ? "…" : ""}”` : "批注";
  }

  if (conflict.kind === "term") {
    const term = conflict.mainTerm ?? conflict.packageTerm ?? conflict.deletion?.term;
    return term?.source ? `术语 ${term.source}` : "术语";
  }

  const title = conflict.mainTask.title || conflict.packageTask.title;
  return title ? `任务 ${title}` : "未命名任务";
}

function formatTarget(entry: Entry): string {
  if (hasVisibleText(entry.target)) {
    return entry.target;
  }

  return hasWorkflowTarget(entry) ? "空白译文" : "未填写译文";
}

function formatContext(entry: Entry): string {
  return entry.context?.trim() || "无上下文";
}

function getCommentStatus(comment: Comment): "open" | "resolved" {
  return comment.status ?? (comment.resolved ? "resolved" : "open");
}

function formatCommentStatus(comment: Comment): string {
  return getCommentStatus(comment) === "resolved" ? "已解决" : "未解决";
}

function formatCommentResolution(comment: Comment): string {
  if (getCommentStatus(comment) !== "resolved") {
    return "未解决";
  }

  const parts = [
    comment.resolved_by
      ? `解决人：${getMemberDisplayName(props.members ?? [], comment.resolved_by)}`
      : "",
    comment.resolved_at ? `时间：${comment.resolved_at}` : "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join("，") : "已解决";
}

function formatTerm(term: Term | undefined): string {
  if (!term) {
    return "无术语";
  }

  return `${term.source} → ${term.target}`;
}

function formatTermMeta(term: Term | undefined): string {
  if (!term) {
    return "";
  }

  return [
    term.part_of_speech ? `词性：${term.part_of_speech}` : "",
    term.variants.length > 0 ? `变体：${term.variants.join("、")}` : "",
    term.case_sensitive ? "区分大小写" : "忽略大小写",
  ].filter(Boolean).join("；");
}

function formatTaskMeta(task: Task): string {
  const fileIds = task.file_ids?.length
    ? task.file_ids
    : task.file_id
      ? [task.file_id]
      : [];
  const scope = task.entry_ids.length > 0
    ? `${task.entry_ids.length} 个指定词条`
    : `${
        fileIds.length > 0
          ? fileIds
              .map((fileId) => getFileDisplayName(props.files ?? [], fileId))
              .join("、")
          : "未指定文件"
      }，${task.range_start}-${task.range_end}`;

  return [
    task.description ? `说明：${task.description}` : "",
    task.assignee
      ? `负责人：${getMemberDisplayName(props.members ?? [], task.assignee)}`
      : "",
    `范围：${scope}`,
    task.due_at ? `截止：${task.due_at}` : "",
  ].filter(Boolean).join("；");
}
</script>

<template>
  <section v-if="conflicts.length > 0" class="conflict-resolver">
    <div class="header-row">
      <div>
        <h2>发现内容冲突</h2>
        <p class="resolution-summary">
          共 {{ conflicts.length }} 项，仍有 {{ unresolvedCount }} 项未选择。
        </p>
      </div>
      <div class="header-actions">
        <button type="button" class="secondary" @click="applyBulkAction('use_package')">
          {{ isProjectUpdate ? "全部保留本地修改" : "全部使用修改包" }}
        </button>
        <button type="button" class="secondary" @click="applyBulkAction('keep_main')">
          {{ isProjectUpdate ? "全部使用项目更新" : "全部保留当前项目" }}
        </button>
        <button
          type="button"
          :disabled="isApplying || !canSubmit"
          @click="handleApply"
        >
          {{ isApplying ? "正在应用..." : "应用处理结果" }}
        </button>
      </div>
    </div>

    <p v-if="!canApply && disabledReason" class="disabled-reason">
      {{ disabledReason }}
    </p>

    <article
      v-for="conflict in conflicts"
      :key="conflict.conflictId"
      class="conflict-card"
    >
      <div class="conflict-title">
        <strong>{{ formatConflictTitle(conflict) }}</strong>
        <span>{{ formatConflictReasons(conflict) }} 不一致</span>
      </div>

      <div class="compare-grid">
        <section>
          <h3>{{ isProjectUpdate ? "项目更新版本" : "当前项目版本" }}</h3>
          <template v-if="conflict.kind === 'entry'">
            <p>{{ formatTarget(conflict.mainEntry) }}</p>
            <small>状态：{{ conflict.mainEntry.status }}</small>
            <small>上下文：{{ formatContext(conflict.mainEntry) }}</small>
          </template>
          <template v-else-if="conflict.kind === 'comment'">
            <p>{{ conflict.mainComment?.body ?? "项目更新中已删除" }}</p>
            <template v-if="conflict.mainComment">
              <small>状态：{{ formatCommentStatus(conflict.mainComment) }}</small>
              <small>{{ formatCommentResolution(conflict.mainComment) }}</small>
            </template>
          </template>
          <template v-else-if="conflict.kind === 'term'">
            <p>{{ formatTerm(conflict.mainTerm) }}</p>
            <small>{{ formatTermMeta(conflict.mainTerm) }}</small>
          </template>
          <template v-else>
            <p>{{ conflict.mainTask.title }}</p>
            <small>状态：{{ conflict.mainTask.status }}</small>
            <small>{{ formatTaskMeta(conflict.mainTask) }}</small>
          </template>
        </section>
        <section>
          <h3>{{ isProjectUpdate ? "本地工作版本" : "修改包版本" }}</h3>
          <template v-if="conflict.kind === 'entry'">
            <p>{{ formatTarget(conflict.packageEntry) }}</p>
            <small>状态：{{ conflict.packageEntry.status }}</small>
            <small>上下文：{{ formatContext(conflict.packageEntry) }}</small>
          </template>
          <template v-else-if="conflict.kind === 'comment'">
            <p>{{ conflict.packageComment?.body ?? "本地已删除" }}</p>
            <template v-if="conflict.packageComment">
              <small>状态：{{ formatCommentStatus(conflict.packageComment) }}</small>
              <small>{{ formatCommentResolution(conflict.packageComment) }}</small>
            </template>
          </template>
          <template v-else-if="conflict.kind === 'term'">
            <p>
              {{
                conflict.deletion
                  ? `删除：${formatTerm(conflict.deletion.term)}`
                  : formatTerm(conflict.packageTerm)
              }}
            </p>
            <small>
              {{
                conflict.deletion
                  ? formatTermMeta(conflict.deletion.term)
                  : formatTermMeta(conflict.packageTerm)
              }}
            </small>
          </template>
          <template v-else>
            <p>{{ conflict.packageTask.title }}</p>
            <small>状态：{{ conflict.packageTask.status }}</small>
            <small>{{ formatTaskMeta(conflict.packageTask) }}</small>
          </template>
        </section>
      </div>

      <div
        v-for="draft in drafts.filter((item) => item.conflictId === conflict.conflictId)"
        :key="draft.conflictId"
        class="resolution-form"
      >
        <label>
          <span>处理方式</span>
          <select
            v-model="draft.action"
            @change="draft.action && updateAction(conflict, draft.action)"
          >
            <option disabled value="">请选择处理方式</option>
            <option value="keep_main">
              {{ isProjectUpdate ? "使用项目更新" : "保留当前项目" }}
            </option>
            <option value="use_package">
              {{ isProjectUpdate ? "保留本地修改" : "使用修改包版本" }}
            </option>
            <option
              v-if="conflict.kind === 'entry' || (conflict.kind === 'term' && conflict.packageTerm)"
              value="manual_merge"
            >
              手动处理
            </option>
            <option value="skip">跳过</option>
          </select>
        </label>

        <label v-if="conflict.kind === 'entry' && draft.action === 'manual_merge'">
          <span>处理后的译文</span>
          <textarea v-model="draft.target" rows="4" />
        </label>

        <label v-if="conflict.kind === 'entry' && draft.action === 'manual_merge'">
          <span>处理后的上下文</span>
          <textarea v-model="draft.context" rows="3" />
        </label>
        <p v-if="conflict.kind === 'entry' && draft.action === 'manual_merge'" class="manual-note">
          手动修改译文后，词条会按现有工作流安全地回到已翻译或未翻译状态。
        </p>

        <template v-if="conflict.kind === 'term' && draft.action === 'manual_merge' && draft.term">
          <label>
            <span>术语原文</span>
            <input v-model="draft.term.source" />
          </label>
          <label>
            <span>推荐译名</span>
            <input v-model="draft.term.target" />
          </label>
          <label>
            <span>词性</span>
            <input v-model="draft.term.part_of_speech" />
          </label>
          <label>
            <span>备注</span>
            <textarea v-model="draft.term.note" rows="3" />
          </label>
          <label>
            <span>变体</span>
            <textarea v-model="draft.variantsText" rows="3" />
          </label>
          <label class="checkbox-label">
            <input v-model="draft.term.case_sensitive" type="checkbox" />
            <span>区分大小写</span>
          </label>
        </template>
      </div>
    </article>
  </section>
</template>

<style scoped>
.conflict-resolver {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.header-row,
.conflict-title,
.compare-grid {
  display: flex;
  gap: 12px;
}

.header-row {
  align-items: center;
  justify-content: space-between;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.resolution-summary,
.manual-note {
  margin-top: 6px;
  color: #5b6472;
  font-size: 13px;
  line-height: 1.6;
}

h2,
h3,
p {
  margin: 0;
}

h2 {
  font-size: 18px;
}

h3 {
  margin-bottom: 8px;
  font-size: 14px;
}

button {
  min-height: 38px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: #ffffff;
  font-size: 14px;
  cursor: pointer;
}

button:disabled {
  cursor: wait;
  opacity: 0.68;
}

button.secondary {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #334155;
}

.conflict-card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #eef1f5;
  border-radius: 6px;
  background: #f9fafb;
}

.conflict-title {
  flex-wrap: wrap;
  justify-content: space-between;
}

.conflict-title span,
small,
label span,
.disabled-reason {
  color: #5b6472;
  font-size: 13px;
}

small {
  display: block;
  margin-top: 6px;
}

.disabled-reason {
  margin: 0;
  line-height: 1.6;
}

.compare-grid {
  align-items: stretch;
}

.compare-grid section {
  flex: 1;
  min-width: 0;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #ffffff;
}

.compare-grid p {
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.resolution-form {
  display: grid;
  gap: 10px;
}

label {
  display: grid;
  gap: 6px;
}

select,
input,
textarea {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
}

textarea {
  resize: vertical;
  line-height: 1.6;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checkbox-label input {
  width: auto;
}

@media (max-width: 720px) {
  .header-row,
  .compare-grid {
    flex-direction: column;
  }

  .header-actions {
    justify-content: stretch;
  }
}
</style>
