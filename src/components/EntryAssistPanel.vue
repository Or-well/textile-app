<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import CommentPanel from "./CommentPanel.vue";
import ContextPanel from "./ContextPanel.vue";
import TermEditDialog from "./TermEditDialog.vue";
import TermHint from "./TermHint.vue";
import { getMemberDisplayName } from "../model/memberOptions";
import { ENTRY_STATUS_LABELS, getEntryProofreadCount } from "../model/status";
import type {
  Comment,
  Entry,
  Member,
  ProjectEvent,
  Term,
} from "../model/types";
import {
  getEntryHistory,
  isEntryHistoryVersionEvent,
  projectEntryHistory,
  type EntryHistoryRow,
  type EntryHistoryVersion,
} from "../services/history";
import { restoreEntryVersion } from "../services/entries";
import {
  addTerm,
  checkTermUsage,
  searchTerms,
  updateTerm,
  type TermInput,
  type TermUsageResult,
} from "../services/terms";
import {
  canCreateTerm,
  canRestoreEntryVersion,
  canUpdateTerm,
  getCurrentUser,
} from "../services/permissions";
import { formatDateTime } from "../utils/time";

type AssistTab = "terms" | "comments" | "context" | "history";

interface TermDisplayItem {
  term: Term;
  matchedText?: string;
  isRecommendedUsed?: boolean;
}

const props = defineProps<{
  entry?: Entry;
  members?: Member[];
  draftTarget: string;
  activeTab?: AssistTab;
  highlightCommentId?: string;
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  entryUpdated: [entry: Entry];
  historyApplied: [entry: Entry];
  historyBusy: [busy: boolean];
  updateActiveTab: [tab: AssistTab];
  viewEntryComment: [comment: Comment];
}>();

const activeTab = ref<AssistTab>(props.activeTab ?? "terms");
const termResults = ref<TermUsageResult[]>([]);
const termSearchText = ref("");
const termSearchResults = ref<Term[]>([]);
const editingTerm = ref<Term>();
const isTermDialogOpen = ref(false);
const isSavingTerm = ref(false);
const historyEvents = ref<ProjectEvent[]>([]);
const termErrorMessage = ref("");
const termActionMessage = ref("");
const historyErrorMessage = ref("");
const historyActionMessage = ref("");
const isReadingHistory = ref(false);
const pendingHistoryAction = ref("");
const selectedHistoryKey = ref("");
let termRequestId = 0;
let termSearchRequestId = 0;
let historyRequestId = 0;

const currentUser = computed(() => getCurrentUser());
const canCreateTerms = computed(() => canCreateTerm(currentUser.value));
const canUpdateTerms = computed(() => canUpdateTerm(currentUser.value));
const isSearchingTerms = computed(() => Boolean(termSearchText.value.trim()));
const displayedTerms = computed<TermDisplayItem[]>(() => {
  if (isSearchingTerms.value) {
    return termSearchResults.value.map((term) => ({ term }));
  }

  return termResults.value.map((result) => ({
    term: result.term,
    matchedText: result.matchedText,
    isRecommendedUsed: result.isRecommendedUsed,
  }));
});
const termEmptyText = computed(() =>
  isSearchingTerms.value ? "没有找到术语" : "没有相关术语",
);
const canChangeVersion = computed(() =>
  canRestoreEntryVersion(currentUser.value, props.entry),
);
const historyBusy = computed(() =>
  props.isSaving || isReadingHistory.value || Boolean(pendingHistoryAction.value),
);
const history = computed(() =>
  props.entry ? projectEntryHistory(props.entry, historyEvents.value) : { rows: [], currentKey: undefined },
);

const tabs: Array<{ id: AssistTab; label: string }> = [
  { id: "terms", label: "术语" },
  { id: "comments", label: "批注" },
  { id: "context", label: "上下文" },
  { id: "history", label: "历史" },
];

function setActiveTab(tab: AssistTab) {
  activeTab.value = tab;
  emit("updateActiveTab", tab);
}

function describeEvent(event: ProjectEvent): string {
  if (event.type === "entry.restored") {
    if (event.detail?.operation === "undo") return "撤销了译文修改";
    if (event.detail?.operation === "redo") return "重做了译文修改";
    return "切换了当前译文";
  }

  if (event.type === "entry.target_replaced") return "替换了译文";

  if (event.type === "entry.updated") {
    if (!isEntryHistoryVersionEvent(event)) {
      return "词条已更新";
    }

    return event.detail.before_target === event.detail.after_target
      ? "更新了词条状态"
      : "更新了译文";
  }

  if (event.type === "entry.disputed" || event.type === "entry.mark_disputed") {
    return "标记为有争议";
  }

  if (
    event.type === "entry.dispute_resolved" ||
    event.type === "entry.resolve_dispute"
  ) {
    return "争议已处理";
  }

  return "记录已更新";
}

function canRestoreVersion(version: EntryHistoryVersion): boolean {
  return canChangeVersion.value && version.target !== props.entry?.target;
}

function getAuditStatus(event: ProjectEvent): string {
  return event.type === "entry.updated" && isEntryHistoryVersionEvent(event)
    ? ENTRY_STATUS_LABELS[event.detail.after_status]
    : "";
}

function selectHistoryVersion(key: string): void {
  selectedHistoryKey.value = selectedHistoryKey.value === key ? "" : key;
}

function formatEventTime(value: string): string {
  return formatDateTime(value) || "时间无效";
}

function getMemberName(memberId: string): string {
  return getMemberDisplayName(props.members ?? [], memberId, {
    emptyLabel: "未知成员",
  });
}

async function applyHistoryVersion({ event, version }: EntryHistoryRow): Promise<void> {
  const entry = props.entry;
  if (!entry || !event || !version || !canRestoreVersion(version) || historyBusy.value) return;

  const consequences: string[] = [];
  if (props.draftTarget !== entry.target) consequences.push("未保存的译文草稿会被替换。");
  const results = [
    entry.status === "proofread" || getEntryProofreadCount(entry) > 0 ? "校对" : "",
    entry.status === "reviewed" || entry.reviewed_by ? "审核" : "",
  ].filter(Boolean);
  if (results.length > 0) consequences.push(`现有${results.join("和")}结果会被清除。`);
  if (consequences.length > 0 &&
    !window.confirm(`确认设为当前译文吗？\n\n${consequences.join("\n")}`)) {
    return;
  }

  pendingHistoryAction.value = version.key;
  emit("historyBusy", true);
  historyErrorMessage.value = "";
  historyActionMessage.value = "";

  try {
    const restoredEntry = await restoreEntryVersion(entry.id, event.id, {
      actor: currentUser.value,
      snapshot: version.snapshot,
    });
    emit("historyApplied", restoredEntry);
    if (props.entry?.id === entry.id && activeTab.value === "history") {
      historyActionMessage.value = "已设为当前译文。";
    }
    await nextTick();
  } catch (error) {
    if (props.entry?.id === entry.id && activeTab.value === "history") {
      historyErrorMessage.value = error instanceof Error ? error.message : "切换译文版本失败。";
    }
  } finally {
    pendingHistoryAction.value = "";
    emit("historyBusy", false);
  }
}

async function refreshEntryHistory(entryId: string): Promise<void> {
  const requestId = (historyRequestId += 1);
  isReadingHistory.value = true;
  historyErrorMessage.value = "";
  try {
    const events = await getEntryHistory(entryId);

    if (requestId === historyRequestId) {
      historyEvents.value = events;
    }
  } catch (error) {
    if (requestId === historyRequestId) {
      historyEvents.value = [];
      historyErrorMessage.value =
        error instanceof Error ? error.message : "历史记录无法读取。";
    }
  } finally {
    if (requestId === historyRequestId) isReadingHistory.value = false;
  }
}

async function refreshRelatedTerms() {
  const requestId = (termRequestId += 1);
  const sourceText = props.entry?.source ?? "";

  if (!sourceText) {
    termResults.value = [];
    termErrorMessage.value = "";
    return;
  }

  try {
    const results = await checkTermUsage(sourceText, props.draftTarget);

    if (requestId === termRequestId) {
      termResults.value = results;
      termErrorMessage.value = "";
    }
  } catch (error) {
    if (requestId === termRequestId) {
      termResults.value = [];
      termErrorMessage.value =
        error instanceof Error ? error.message : "术语提示无法读取。";
    }
  }
}

async function refreshSearchTerms() {
  const requestId = (termSearchRequestId += 1);
  const keyword = termSearchText.value.trim();

  if (!keyword) {
    termSearchResults.value = [];
    return;
  }

  try {
    const results = await searchTerms(keyword);

    if (requestId === termSearchRequestId) {
      termSearchResults.value = results;
      termErrorMessage.value = "";
    }
  } catch (error) {
    if (requestId === termSearchRequestId) {
      termSearchResults.value = [];
      termErrorMessage.value =
        error instanceof Error ? error.message : "术语搜索失败。";
    }
  }
}

function openCreateTermDialog() {
  if (!canCreateTerms.value) {
    return;
  }

  editingTerm.value = undefined;
  termActionMessage.value = "";
  isTermDialogOpen.value = true;
}

function openEditTermDialog(term: Term) {
  if (!canUpdateTerms.value) {
    return;
  }

  editingTerm.value = term;
  termActionMessage.value = "";
  isTermDialogOpen.value = true;
}

function closeTermDialog() {
  if (!isSavingTerm.value) {
    isTermDialogOpen.value = false;
  }
}

async function saveTerm(input: TermInput) {
  if (editingTerm.value && !canUpdateTerms.value) {
    return;
  }

  if (!editingTerm.value && !canCreateTerms.value) {
    return;
  }

  isSavingTerm.value = true;
  termErrorMessage.value = "";
  termActionMessage.value = "";

  try {
    if (editingTerm.value) {
      await updateTerm(editingTerm.value.id, input);
      termActionMessage.value = "术语已更新。";
    } else {
      await addTerm(input, currentUser.value?.id ?? "unknown_user");
      termActionMessage.value = "术语已创建。";
    }

    isTermDialogOpen.value = false;
    editingTerm.value = undefined;
    await refreshRelatedTerms();
    await refreshSearchTerms();
  } catch (error) {
    termErrorMessage.value =
      error instanceof Error ? error.message : "术语保存失败。";
  } finally {
    isSavingTerm.value = false;
  }
}

watch(
  () => props.activeTab,
  (tab) => {
    if (tab) activeTab.value = tab;
  },
);

watch(
  [() => props.entry?.source, () => props.draftTarget],
  () => {
    void refreshRelatedTerms();
  },
  { immediate: true },
);

watch(termSearchText, () => {
  void refreshSearchTerms();
});

watch(
  [activeTab, () => props.entry],
  ([tab, entry], [, previousEntry]) => {
    if (entry?.id !== previousEntry?.id || tab !== "history") {
      selectedHistoryKey.value = "";
      historyEvents.value = [];
      historyActionMessage.value = "";
      historyErrorMessage.value = "";
    } else if (entry !== previousEntry && !pendingHistoryAction.value) {
      historyActionMessage.value = "";
    }
    if (tab === "history" && entry) {
      void refreshEntryHistory(entry.id);
    } else {
      historyRequestId += 1;
      isReadingHistory.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <aside class="entry-assist-panel">
    <div class="assist-tabs" role="tablist" aria-label="词条辅助信息">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-button"
        :class="{ active: activeTab === tab.id }"
        type="button"
        :disabled="Boolean(pendingHistoryAction)"
        @click="setActiveTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <section v-if="activeTab === 'terms'" class="tab-panel term-panel">
      <div class="term-toolbar" :class="{ 'without-create': !canCreateTerms }">
        <button
          v-if="canCreateTerms"
          class="add-term-button"
          type="button"
          aria-label="创建术语"
          title="创建术语"
          @click="openCreateTermDialog"
        >
          +
        </button>
        <input v-model="termSearchText" type="search" placeholder="搜索术语" />
      </div>

      <p v-if="termErrorMessage" class="error-message">{{ termErrorMessage }}</p>
      <template v-else>
        <TermHint
          :items="displayedTerms"
          :empty-text="termEmptyText"
          :can-edit="canUpdateTerms"
          @request-edit-term="openEditTermDialog"
        />
        <p v-if="termActionMessage" class="term-action-message">
          {{ termActionMessage }}
        </p>
      </template>

      <TermEditDialog
        v-if="isTermDialogOpen"
        :term="editingTerm"
        :is-saving="isSavingTerm"
        @cancel="closeTermDialog"
        @save="saveTerm"
      />
    </section>

    <section v-else-if="activeTab === 'comments'" class="tab-panel">
      <CommentPanel
        :entry="entry"
        :members="props.members ?? []"
        :highlight-comment-id="highlightCommentId"
        @view-entry-comment="emit('viewEntryComment', $event)"
      />
    </section>

    <section v-else-if="activeTab === 'context'" class="tab-panel">
      <ContextPanel :entry="entry" @entry-updated="emit('entryUpdated', $event)" />
    </section>

    <section v-else class="tab-panel history-panel">
      <p v-if="historyErrorMessage" class="error-message" role="alert">
        {{ historyErrorMessage }}
      </p>
      <p v-if="historyActionMessage" class="term-action-message" role="status">
        {{ historyActionMessage }}
      </p>
      <p v-if="historyEvents.length === 0 && isReadingHistory" class="empty-text">
        正在读取历史记录...
      </p>
      <p v-else-if="historyEvents.length === 0 && !historyErrorMessage" class="empty-text">
        暂无历史记录
      </p>
      <ul v-if="history.rows.length > 0" class="history-list">
        <li v-for="row in history.rows" :key="row.key">
          <template v-if="row.version">
            <button
              class="history-version"
              type="button"
              :aria-expanded="selectedHistoryKey === row.key"
              :disabled="Boolean(pendingHistoryAction)"
              @click="selectHistoryVersion(row.key)"
            >
              <span class="history-heading">
                <span v-if="row.event" class="history-meta">
                  <template v-if="row.version.snapshot === 'before'">修改前 · </template>
                  <template v-else>
                    <template v-if="row.event.type === 'entry.target_replaced'">替换译文 · </template>
                    {{ getMemberName(row.event.user_id) }} ·
                  </template>
                  {{ formatEventTime(row.event.created_at) }}
                </span>
                <span v-if="row.key === history.currentKey" class="current-version">当前译文</span>
              </span>
              <span class="history-target">{{ row.version.target || "空译文" }}</span>
            </button>
            <div v-if="selectedHistoryKey === row.key" class="history-version-details">
              <span class="history-meta">
                {{ ENTRY_STATUS_LABELS[row.key === history.currentKey && entry ? entry.status : row.version.status] }}
              </span>
              <button
                v-if="row.event && canRestoreVersion(row.version)"
                class="restore-button"
                type="button"
                :disabled="historyBusy"
                @click="applyHistoryVersion(row)"
              >{{ pendingHistoryAction === row.key ? "正在切换..." : "设为当前译文" }}</button>
            </div>
          </template>
          <div v-else-if="row.event" class="history-audit">
            <strong>{{ describeEvent(row.event) }}</strong>
            <span v-if="getAuditStatus(row.event)"> · {{ getAuditStatus(row.event) }}</span>
            <span class="history-meta">
              {{ getMemberName(row.event.user_id) }} · {{ formatEventTime(row.event.created_at) }}
            </span>
          </div>
        </li>
      </ul>
    </section>
  </aside>
</template>

<style scoped>
.entry-assist-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  overflow: hidden;
}

.assist-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-bottom: 1px solid #e5e7eb;
}

.tab-button {
  min-height: var(--control-lg);
  border: 0;
  border-right: 1px solid #e5e7eb;
  background: var(--color-surface-muted);
  color: #4b5563;
  font: inherit;
  cursor: pointer;
}

.tab-button:last-child {
  border-right: 0;
}

.tab-button.active {
  background: var(--color-surface);
  color: var(--color-brand-strong);
  font-weight: 700;
}

.tab-panel {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: var(--panel-padding);
  scrollbar-gutter: stable;
}

.term-panel {
  display: grid;
  align-content: start;
  gap: var(--space-4);
}

.term-toolbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-3);
  align-items: center;
}

.term-toolbar.without-create {
  grid-template-columns: minmax(0, 1fr);
}

.term-toolbar input {
  width: 100%;
  min-height: var(--control-md);
  padding: 0 var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-sm);
}

.term-toolbar input:focus {
  outline: none;
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

.add-term-button {
  width: var(--control-md);
  min-height: var(--control-md);
  border: 1px solid var(--color-brand);
  border-radius: var(--radius-sm);
  background: var(--color-brand);
  color: var(--color-surface);
  font: inherit;
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}

.empty-text,
.term-action-message,
.error-message {
  margin: 0;
  line-height: 1.5;
}

.empty-text {
  color: var(--color-muted);
}

.error-message {
  color: #b42318;
}

.term-action-message {
  color: var(--color-brand);
}

.history-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.history-list {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-version {
  display: grid;
  gap: var(--space-1);
  width: 100%;
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid #eef1f5;
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  color: var(--color-text);
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.history-version:hover,
.history-version[aria-expanded="true"] {
  border-color: var(--color-border-strong);
}

.history-version-details {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) 0;
}

.history-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
}

.current-version {
  color: var(--color-brand);
  font-size: var(--font-sm);
  font-weight: 700;
  white-space: nowrap;
}

.history-target {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: var(--space-3);
  border-left: 3px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
  line-height: 1.5;
}

.history-version[aria-expanded="false"] .history-target {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.history-audit {
  padding: var(--space-1) var(--space-3);
  color: var(--color-muted);
  font-size: var(--font-sm);
}

.history-audit .history-meta {
  display: block;
}

.restore-button {
  justify-self: start;
  min-height: var(--control-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--color-brand);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-brand);
  font: inherit;
  font-size: var(--font-sm);
  font-weight: 700;
  cursor: pointer;
}

.restore-button:disabled {
  cursor: default;
  opacity: 0.6;
}

.history-list strong {
  color: var(--color-heading);
  font-size: var(--font-sm);
}

.history-meta {
  color: var(--color-muted);
  font-size: var(--font-sm);
}

@media (max-width: 1180px) {
  .entry-assist-panel {
    height: auto;
    overflow: visible;
  }

  .tab-panel {
    overflow: visible;
  }
}
</style>
