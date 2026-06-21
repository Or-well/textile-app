<script setup lang="ts">
import { ref, watch } from "vue";
import type {
  ChangeConflict,
  ConflictResolution,
  ConflictResolutionAction,
} from "../services/changes";
import type { Entry, EntryStatus } from "../model/types";
import {
  ENTRY_STATUSES,
  hasVisibleText,
  hasWorkflowTarget,
} from "../model/status";

interface ConflictDraft {
  entryId: string;
  action: ConflictResolutionAction;
  target: string;
  status: EntryStatus;
}

const props = defineProps<{
  conflicts: ChangeConflict[];
  isApplying?: boolean;
  canApply?: boolean;
  disabledReason?: string;
}>();

const emit = defineEmits<{
  apply: [resolutions: ConflictResolution[]];
}>();

const drafts = ref<ConflictDraft[]>([]);

watch(
  () => props.conflicts,
  (conflicts) => {
    drafts.value = conflicts.map((conflict) => ({
      entryId: conflict.entryId,
      action: "keep_main",
      target: conflict.mainEntry.target,
      status: conflict.mainEntry.status,
    }));
  },
  { immediate: true },
);

function updateAction(entryId: string, action: ConflictResolutionAction) {
  const draft = drafts.value.find((item) => item.entryId === entryId);
  const conflict = props.conflicts.find((item) => item.entryId === entryId);

  if (!draft || !conflict) {
    return;
  }

  draft.action = action;

  if (action === "use_package") {
    draft.target = conflict.packageEntry.target;
    draft.status = conflict.packageEntry.status;
  }

  if (action === "keep_main" || action === "skip") {
    draft.target = conflict.mainEntry.target;
    draft.status = conflict.mainEntry.status;
  }
}

function handleApply() {
  emit(
    "apply",
    drafts.value.map((draft) => ({
      entryId: draft.entryId,
      action: draft.action,
      target: draft.target,
      status: draft.status,
    })),
  );
}

function formatConflictReasons(reasons: ChangeConflict["reasons"]): string {
  const labels: Record<ChangeConflict["reasons"][number], string> = {
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
  };

  return reasons.map((reason) => labels[reason]).join("、");
}

function formatTarget(entry: Entry): string {
  if (hasVisibleText(entry.target)) {
    return entry.target;
  }

  return hasWorkflowTarget(entry) ? "空白译文" : "未填写译文";
}
</script>

<template>
  <section v-if="conflicts.length > 0" class="conflict-resolver">
    <div class="header-row">
      <h2>发现内容冲突</h2>
      <button
        type="button"
        :disabled="isApplying || !canApply"
        @click="handleApply"
      >
        {{ isApplying ? "正在应用..." : "应用处理结果" }}
      </button>
    </div>

    <p v-if="!canApply && disabledReason" class="disabled-reason">
      {{ disabledReason }}
    </p>

    <article
      v-for="conflict in conflicts"
      :key="conflict.entryId"
      class="conflict-card"
    >
      <div class="conflict-title">
        <strong>{{ conflict.entryId }}</strong>
        <span>{{ formatConflictReasons(conflict.reasons) }} 不一致</span>
      </div>

      <div class="compare-grid">
        <section>
          <h3>主项目版本</h3>
          <p>{{ formatTarget(conflict.mainEntry) }}</p>
          <small>状态：{{ conflict.mainEntry.status }}</small>
        </section>
        <section>
          <h3>我的修改</h3>
          <p>{{ formatTarget(conflict.packageEntry) }}</p>
          <small>状态：{{ conflict.packageEntry.status }}</small>
        </section>
      </div>

      <div
        v-for="draft in drafts.filter((item) => item.entryId === conflict.entryId)"
        :key="draft.entryId"
        class="resolution-form"
      >
        <label>
          <span>处理方式</span>
          <select
            v-model="draft.action"
            @change="updateAction(conflict.entryId, draft.action)"
          >
            <option value="keep_main">保留主项目</option>
            <option value="use_package">使用我的修改</option>
            <option value="manual_merge">手动处理</option>
            <option value="skip">跳过</option>
          </select>
        </label>

        <label v-if="draft.action === 'manual_merge'">
          <span>处理后的译文</span>
          <textarea v-model="draft.target" rows="4" />
        </label>

        <label v-if="draft.action === 'manual_merge'">
          <span>处理后的状态</span>
          <select v-model="draft.status">
            <option
              v-for="status in ENTRY_STATUSES"
              :key="status"
              :value="status"
            >
              {{ status }}
            </option>
          </select>
        </label>
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

@media (max-width: 720px) {
  .header-row,
  .compare-grid {
    flex-direction: column;
  }
}
</style>
