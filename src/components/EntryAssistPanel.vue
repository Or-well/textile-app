<script setup lang="ts">
import { computed, ref, watch } from "vue";
import CommentPanel from "./CommentPanel.vue";
import ContextPanel from "./ContextPanel.vue";
import TermEditDialog from "./TermEditDialog.vue";
import TermHint from "./TermHint.vue";
import { getMemberDisplayName } from "../model/memberOptions";
import { ENTRY_STATUS_LABELS } from "../model/status";
import type {
  Comment,
  Entry,
  EntryStatus,
  Member,
  ProjectEvent,
  Term,
} from "../model/types";
import {
  getEntryHistory,
  isEntryVersionEvent,
  type EntryVersionEvent,
  type EntryVersionSnapshot,
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
import { compareInstants, formatDateTime } from "../utils/time";

type AssistTab = "terms" | "comments" | "context" | "history";

interface TermDisplayItem {
  term: Term;
  matchedText?: string;
  isRecommendedUsed?: boolean;
}

interface HistoryVersion {
  key: string;
  event: EntryVersionEvent;
  snapshot: EntryVersionSnapshot;
  target: string;
  status: EntryStatus;
  isInitial: boolean;
}

interface HistoryRow {
  key: string;
  event: ProjectEvent;
  version?: HistoryVersion;
}

const props = defineProps<{
  entry?: Entry;
  members?: Member[];
  draftTarget: string;
  activeTab?: AssistTab;
  highlightCommentId?: string;
}>();

const emit = defineEmits<{
  entryUpdated: [entry: Entry];
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
const restoringEventId = ref("");
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
const historyVersions = computed<HistoryVersion[]>(() => {
  const events = historyEvents.value.filter(isEntryVersionEvent);
  const versions: HistoryVersion[] = events.map((event) => ({
    key: `${event.id}:after`,
    event,
    snapshot: "after",
    target: event.detail.after_target,
    status: event.detail.after_status,
    isInitial: false,
  }));
  const oldestEvent = events.at(-1);

  if (oldestEvent) {
    versions.push({
      key: `${oldestEvent.id}:before`,
      event: oldestEvent,
      snapshot: "before",
      target: oldestEvent.detail.before_target,
      status: oldestEvent.detail.before_status,
      isInitial: true,
    });
  }

  return versions;
});
const currentVersionKey = computed(
  () =>
    historyVersions.value.find(
      (version) =>
        version.target === props.entry?.target &&
        version.status === props.entry?.status,
    )?.key ?? "",
);
const historyRows = computed<HistoryRow[]>(() => {
  const versionByEventId = new Map(
    historyVersions.value
      .filter((version) => !version.isInitial)
      .map((version) => [version.event.id, version]),
  );
  const rows = historyEvents.value.map((event) => ({
    key: event.id,
    event,
    version: versionByEventId.get(event.id),
  }));
  const initialVersion = historyVersions.value.find(
    (version) => version.isInitial,
  );

  if (initialVersion) {
    rows.push({
      key: initialVersion.key,
      event: initialVersion.event,
      version: initialVersion,
    });
  }

  return rows;
});

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
    return "恢复了历史译文";
  }

  if (event.type === "entry.updated") {
    if (!isEntryVersionEvent(event)) {
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

function canRestoreVersion(version: HistoryVersion): boolean {
  return Boolean(
    props.entry &&
      version.key !== currentVersionKey.value &&
      canRestoreEntryVersion(currentUser.value, props.entry),
  );
}

function formatEventTime(value: string): string {
  return formatDateTime(value) || "时间无效";
}

function getMemberName(memberId: string): string {
  return getMemberDisplayName(props.members ?? [], memberId, {
    emptyLabel: "未知成员",
  });
}

async function handleRestoreVersion(version: HistoryVersion): Promise<void> {
  if (!props.entry || !canRestoreVersion(version)) {
    return;
  }

  const targetPreview = version.target || "空译文";

  if (
    !window.confirm(
      `确认恢复此历史译文吗？恢复后需要重新校对和审核。\n\n${targetPreview}`,
    )
  ) {
    return;
  }

  restoringEventId.value = version.key;
  historyErrorMessage.value = "";
  historyActionMessage.value = "";

  try {
    const restoredEntry = await restoreEntryVersion(
      props.entry.id,
      version.event.id,
      {
        actor: currentUser.value,
        snapshot: version.snapshot,
      },
    );

    emit("entryUpdated", restoredEntry);
    historyActionMessage.value = "已恢复历史译文，需重新校对和审核。";
    await refreshEntryHistory(restoredEntry.id);
  } catch (error) {
    historyErrorMessage.value =
      error instanceof Error ? error.message : "恢复历史译文失败。";
  } finally {
    restoringEventId.value = "";
  }
}

async function refreshEntryHistory(entryId?: string): Promise<void> {
  const requestId = (historyRequestId += 1);

  if (!entryId) {
    historyEvents.value = [];
    historyErrorMessage.value = "";
    historyActionMessage.value = "";
    return;
  }

  try {
    const events = await getEntryHistory(entryId);

    if (requestId === historyRequestId) {
      historyEvents.value = events.sort(
        (a, b) =>
          compareInstants(b.created_at, a.created_at) ||
          a.id.localeCompare(b.id),
      );
      historyErrorMessage.value = "";
    }
  } catch (error) {
    if (requestId === historyRequestId) {
      historyEvents.value = [];
      historyErrorMessage.value =
        error instanceof Error ? error.message : "历史记录无法读取。";
    }
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
    if (tab) {
      activeTab.value = tab;
    }
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
  [() => props.entry?.id, () => props.entry?.updated_at],
  ([entryId]) => {
    void refreshEntryHistory(entryId);
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

    <section v-else class="tab-panel">
      <p v-if="historyErrorMessage" class="error-message">
        {{ historyErrorMessage }}
      </p>
      <p v-if="historyActionMessage" class="term-action-message">
        {{ historyActionMessage }}
      </p>
      <p v-else-if="historyEvents.length === 0" class="empty-text">
        暂无历史记录
      </p>
      <ul v-else class="history-list">
        <li
          v-for="row in historyRows"
          :key="row.key"
        >
          <div class="history-heading">
            <strong>
              {{
                row.version?.isInitial
                  ? "首次记录前版本"
                  : describeEvent(row.event)
              }}
            </strong>
            <span
              v-if="row.version?.key === currentVersionKey"
              class="current-version"
            >
              当前版本
            </span>
          </div>
          <span :title="row.event.user_id || undefined">
            {{ getMemberName(row.event.user_id) }}
            {{ row.version?.isInitial ? "修改前" : "" }} ·
            {{ formatEventTime(row.event.created_at) }}
          </span>
          <template v-if="row.version">
            <div class="history-target">
              {{ row.version.target || "空译文" }}
            </div>
            <span>{{ ENTRY_STATUS_LABELS[row.version.status] }}</span>
            <button
              v-if="canRestoreVersion(row.version)"
              class="restore-button"
              type="button"
              :disabled="Boolean(restoringEventId)"
              @click="handleRestoreVersion(row.version)"
            >
              {{
                restoringEventId === row.version.key
                  ? "正在恢复..."
                  : "恢复此版本"
              }}
            </button>
          </template>
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
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
}

.assist-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-bottom: 1px solid #e5e7eb;
}

.tab-button {
  min-height: 42px;
  border: 0;
  border-right: 1px solid #e5e7eb;
  background: #f8fafb;
  color: #4b5563;
  font: inherit;
  cursor: pointer;
}

.tab-button:last-child {
  border-right: 0;
}

.tab-button.active {
  background: #ffffff;
  color: #174346;
  font-weight: 700;
}

.tab-panel {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 14px;
  scrollbar-gutter: stable;
}

.term-panel {
  display: grid;
  align-content: start;
  gap: 12px;
}

.term-toolbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.term-toolbar.without-create {
  grid-template-columns: minmax(0, 1fr);
}

.term-toolbar input {
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  color: #1f2937;
  font: inherit;
  font-size: 14px;
}

.term-toolbar input:focus {
  outline: none;
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

.add-term-button {
  width: 36px;
  min-height: 36px;
  border: 1px solid #2f6f73;
  border-radius: 6px;
  background: #2f6f73;
  color: #ffffff;
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
  line-height: 1.7;
}

.empty-text {
  color: #5b6472;
}

.error-message {
  color: #b42318;
}

.term-action-message {
  color: #2f6f73;
}

.history-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-list li {
  display: grid;
  gap: 5px;
  padding: 10px;
  border: 1px solid #eef1f5;
  border-radius: 6px;
  background: #f8fafb;
}

.history-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.current-version {
  color: #2f6f73;
  font-weight: 700;
}

.history-target {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 8px;
  border-left: 3px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
  line-height: 1.55;
}

.restore-button {
  justify-self: start;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid #2f6f73;
  border-radius: 6px;
  background: #ffffff;
  color: #2f6f73;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.restore-button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.history-list strong {
  color: #111827;
  font-size: 14px;
}

.history-list span {
  color: #5b6472;
  font-size: 13px;
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
