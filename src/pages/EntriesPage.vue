<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import ProjectPageHeader from "../components/ProjectPageHeader.vue";
import {
  buildMemberOptions,
  getMemberDisplayName,
} from "../model/memberOptions";
import { PERMISSION_ACTIONS } from "../model/permissions";
import {
  getEntryWorkflowLabel,
  hasVisibleText,
  hasWorkflowTarget,
} from "../model/status";
import type {
  Entry,
  EntryStatus,
  Member,
  ProjectConfig,
  Task,
} from "../model/types";
import {
  executeEntryBatch,
  previewEntryBatch,
  type EntryBatchOperation,
  type EntryBatchPreview,
} from "../services/entryBatch";
import { loadAllEntries } from "../services/entries";
import { can } from "../services/permissions";
import { isEntryInTask, loadTasks } from "../services/tasks";
import { formatDateTime } from "../utils/time";

type StatusFilter = EntryStatus | "all";
type DisputeFilter = "all" | "disputed" | "clear";
type SortMode = "file-index" | "updated-desc" | "status";

const pageSizeOptions = [20, 50, 100, 200, 500, 800];

interface BatchActionOption {
  value: EntryBatchOperation;
  label: string;
  permissions: string[];
}

const props = defineProps<{
  project: ProjectConfig;
  members: Member[];
  currentUser: Member | null;
  initialFileId?: string;
}>();

const emit = defineEmits<{
  openEntry: [fileId: string, entryId: string, entryIndex: number];
  entriesChanged: [];
}>();

const batchActionOptions: BatchActionOption[] = [
  {
    value: "set_reviewed",
    label: "已审核",
    permissions: [PERMISSION_ACTIONS.ENTRY_REVIEW],
  },
  {
    value: "set_proofread",
    label: "已校对",
    permissions: [
      PERMISSION_ACTIONS.ENTRY_PROOFREAD,
      PERMISSION_ACTIONS.ENTRY_ROLLBACK,
    ],
  },
  {
    value: "set_translated",
    label: "已翻译",
    permissions: [
      PERMISSION_ACTIONS.ENTRY_EDIT,
      PERMISSION_ACTIONS.ENTRY_TRANSLATE,
      PERMISSION_ACTIONS.ENTRY_ROLLBACK,
    ],
  },
  {
    value: "set_disputed",
    label: "有争议",
    permissions: [PERMISSION_ACTIONS.ENTRY_MARK_DISPUTED],
  },
  {
    value: "clear_disputed",
    label: "无争议",
    permissions: [PERMISSION_ACTIONS.ENTRY_RESOLVE_DISPUTE],
  },
];

const entries = ref<Entry[]>([]);
const tasks = ref<Task[]>([]);
const selectedEntryIds = ref(new Set<string>());
const searchText = ref("");
const fileFilter = ref(props.initialFileId ?? "all");
const taskFilter = ref("all");
const assigneeFilter = ref("all");
const statusFilter = ref<StatusFilter>("all");
const disputeFilter = ref<DisputeFilter>("all");
const sortMode = ref<SortMode>("file-index");
const pageSize = ref(50);
const currentPage = ref(1);
const selectedOperation = ref<EntryBatchOperation>("set_reviewed");
const batchNote = ref("");
const batchPreview = ref<EntryBatchPreview | null>(null);
const isLoading = ref(false);
const isPreviewing = ref(false);
const isExecuting = ref(false);
const errorMessage = ref("");
const noticeMessage = ref("");

const fileById = computed(
  () => new Map(props.project.files.map((file) => [file.id, file])),
);
const assigneeFilterOptions = computed(() =>
  buildMemberOptions(
    props.members,
    entries.value.map((entry) => entry.assignee),
  ),
);
const availableBatchActions = computed(() =>
  batchActionOptions.filter((option) =>
    option.permissions.some((permission) =>
      can(props.currentUser, permission, props.project),
    ),
  ),
);
const selectedTask = computed(() =>
  tasks.value.find((task) => task.id === taskFilter.value),
);

const filteredEntries = computed(() => {
  const keyword = searchText.value.trim().toLowerCase();
  const rows = entries.value.filter((entry) => {
    if (fileFilter.value !== "all" && entry.file_id !== fileFilter.value) {
      return false;
    }

    if (selectedTask.value && !isEntryInTask(entry, selectedTask.value)) {
      return false;
    }

    if (
      assigneeFilter.value !== "all" &&
      entry.assignee !== assigneeFilter.value
    ) {
      return false;
    }

    if (statusFilter.value !== "all" && entry.status !== statusFilter.value) {
      return false;
    }

    if (disputeFilter.value === "disputed" && !entry.disputed) {
      return false;
    }

    if (disputeFilter.value === "clear" && entry.disputed) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    return [
      entry.key,
      entry.source,
      entry.target,
      entry.speaker,
      fileById.value.get(entry.file_id)?.name ?? "",
    ].some((value) => value.toLowerCase().includes(keyword));
  });

  return rows.sort((left, right) => {
    if (sortMode.value === "updated-desc") {
      return (
        right.updated_at.localeCompare(left.updated_at) ||
        left.file_id.localeCompare(right.file_id) ||
        left.index - right.index
      );
    }

    if (sortMode.value === "status") {
      return (
        left.status.localeCompare(right.status) ||
        left.file_id.localeCompare(right.file_id) ||
        left.index - right.index
      );
    }

    return (
      left.file_id.localeCompare(right.file_id) ||
      left.index - right.index ||
      left.id.localeCompare(right.id)
    );
  });
});

const totalPages = computed(() =>
  Math.max(1, Math.ceil(filteredEntries.value.length / pageSize.value)),
);
const pagedEntries = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;

  return filteredEntries.value.slice(start, start + pageSize.value);
});
const selectedCount = computed(() => selectedEntryIds.value.size);
const selectedFilteredCount = computed(() =>
  filteredEntries.value.reduce(
    (count, entry) =>
      count + (selectedEntryIds.value.has(entry.id) ? 1 : 0),
    0,
  ),
);
const hiddenSelectedCount = computed(
  () => selectedCount.value - selectedFilteredCount.value,
);
const isCurrentPageSelected = computed(
  () =>
    pagedEntries.value.length > 0 &&
    pagedEntries.value.every((entry) => selectedEntryIds.value.has(entry.id)),
);
const selectedOperationLabel = computed(
  () =>
    batchActionOptions.find(
      (option) => option.value === selectedOperation.value,
    )?.label ?? "批量操作",
);
const batchNeedsNote = computed(
  () =>
    selectedOperation.value === "set_disputed" ||
    selectedOperation.value === "clear_disputed",
);

function getMemberName(memberId: string): string {
  return getMemberDisplayName(props.members, memberId);
}

function getFileName(fileId: string): string {
  return fileById.value.get(fileId)?.name ?? fileId;
}

function getTaskLabel(task: Task): string {
  const assignee = getMemberName(task.assignee);

  return `${task.title} · ${assignee}`;
}

function getTargetLabel(entry: Entry): string {
  if (hasVisibleText(entry.target)) {
    return entry.target;
  }

  return hasWorkflowTarget(entry) ? "空白译文" : "未填写";
}

async function loadPageData() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const [loadedEntries, loadedTasks] = await Promise.all([
      loadAllEntries(),
      props.project.settings.workflow?.enable_tasks === false
        ? Promise.resolve([])
        : loadTasks(),
    ]);

    entries.value = loadedEntries;
    tasks.value = loadedTasks;
  } catch (error) {
    entries.value = [];
    tasks.value = [];
    errorMessage.value =
      error instanceof Error ? error.message : "词条管理数据加载失败。";
  } finally {
    isLoading.value = false;
  }
}

function replaceSelection(nextIds: Iterable<string>) {
  selectedEntryIds.value = new Set(nextIds);
}

function toggleEntry(entryId: string) {
  const nextIds = new Set(selectedEntryIds.value);

  if (nextIds.has(entryId)) {
    nextIds.delete(entryId);
  } else {
    nextIds.add(entryId);
  }

  replaceSelection(nextIds);
}

function toggleCurrentPage() {
  const nextIds = new Set(selectedEntryIds.value);

  if (isCurrentPageSelected.value) {
    for (const entry of pagedEntries.value) {
      nextIds.delete(entry.id);
    }
  } else {
    for (const entry of pagedEntries.value) {
      nextIds.add(entry.id);
    }
  }

  replaceSelection(nextIds);
}

function selectAllFiltered() {
  const nextIds = new Set(selectedEntryIds.value);

  for (const entry of filteredEntries.value) {
    nextIds.add(entry.id);
  }

  replaceSelection(nextIds);
}

function clearSelection() {
  replaceSelection([]);
}

function movePage(offset: -1 | 1) {
  currentPage.value = Math.min(
    totalPages.value,
    Math.max(1, currentPage.value + offset),
  );
}

function closeBatchPreview() {
  if (!isExecuting.value) {
    batchPreview.value = null;
  }
}

async function handlePreviewBatch() {
  if (selectedCount.value === 0 || !props.currentUser) {
    return;
  }

  isPreviewing.value = true;
  errorMessage.value = "";
  noticeMessage.value = "";

  try {
    batchPreview.value = await previewEntryBatch({
      entryIds: Array.from(selectedEntryIds.value),
      operation: selectedOperation.value,
      actor: props.currentUser,
      project: props.project,
      note: batchNote.value,
    });
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "批量操作预检失败。";
  } finally {
    isPreviewing.value = false;
  }
}

async function handleExecuteBatch() {
  if (!batchPreview.value || !props.currentUser) {
    return;
  }

  isExecuting.value = true;
  errorMessage.value = "";
  noticeMessage.value = "";

  try {
    const result = await executeEntryBatch({
      entryIds: Array.from(selectedEntryIds.value),
      operation: selectedOperation.value,
      actor: props.currentUser,
      project: props.project,
      note: batchNote.value,
    });

    noticeMessage.value =
      `批量操作完成：更新 ${result.updatedEntries.length} 条` +
      (result.skipped.length > 0 ? `，跳过 ${result.skipped.length} 条。` : "。");
    batchPreview.value = null;
    clearSelection();
    batchNote.value = "";
    await loadPageData();
    emit("entriesChanged");
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "批量操作执行失败。";
  } finally {
    isExecuting.value = false;
  }
}

watch(
  [
    searchText,
    fileFilter,
    taskFilter,
    assigneeFilter,
    statusFilter,
    disputeFilter,
    sortMode,
    pageSize,
  ],
  () => {
    currentPage.value = 1;
  },
);

watch(totalPages, (value) => {
  currentPage.value = Math.min(currentPage.value, value);
});

watch(
  () => props.initialFileId,
  (fileId) => {
    fileFilter.value = fileId || "all";
  },
);

watch(availableBatchActions, (actions) => {
  if (
    actions.length > 0 &&
    !actions.some((action) => action.value === selectedOperation.value)
  ) {
    selectedOperation.value = actions[0].value;
  }
}, { immediate: true });

onMounted(loadPageData);
</script>

<template>
  <section class="entries-page">
    <ProjectPageHeader
      eyebrow="词条管理"
      title="词条"
      summary="跨文件筛选、查看和批量处理项目词条。"
    >
      <template #actions>
        <p class="count-summary">
          {{ filteredEntries.length }} / {{ entries.length }} 条
        </p>
      </template>
    </ProjectPageHeader>

    <div
      v-if="errorMessage || noticeMessage"
      class="message-row"
      aria-live="polite"
    >
      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
      <p v-else class="notice-message">{{ noticeMessage }}</p>
    </div>

    <section class="filter-bar" aria-label="词条筛选">
      <label class="search-field">
        <span>搜索</span>
        <input
          v-model="searchText"
          type="search"
          placeholder="键值、原文、译文、说话人或文件"
        />
      </label>

      <label>
        <span>文件</span>
        <select v-model="fileFilter">
          <option value="all">全部文件</option>
          <option
            v-for="file in project.files"
            :key="file.id"
            :value="file.id"
          >
            {{ file.name }}
          </option>
        </select>
      </label>

      <label v-if="tasks.length > 0">
        <span>任务</span>
        <select v-model="taskFilter">
          <option value="all">全部任务</option>
          <option v-for="task in tasks" :key="task.id" :value="task.id">
            {{ getTaskLabel(task) }}
          </option>
        </select>
      </label>

      <label>
        <span>负责人</span>
        <select v-model="assigneeFilter">
          <option value="all">全部负责人</option>
          <option value="">未分配</option>
          <option
            v-for="member in assigneeFilterOptions"
            :key="member.id"
            :value="member.id"
          >
            {{ member.label }}
          </option>
        </select>
      </label>

      <label>
        <span>状态</span>
        <select v-model="statusFilter">
          <option value="all">全部状态</option>
          <option value="untranslated">未翻译</option>
          <option value="translated">已翻译</option>
          <option value="proofread">已校对</option>
          <option value="reviewed">已审核</option>
        </select>
      </label>

      <label>
        <span>争议</span>
        <select v-model="disputeFilter">
          <option value="all">全部</option>
          <option value="disputed">有争议</option>
          <option value="clear">无争议</option>
        </select>
      </label>

      <label>
        <span>排序</span>
        <select v-model="sortMode">
          <option value="file-index">文件与序号</option>
          <option value="updated-desc">最近修改</option>
          <option value="status">状态</option>
        </select>
      </label>
    </section>

    <section class="batch-bar" aria-label="批量操作">
      <div class="selection-summary">
        <strong>已选 {{ selectedCount }} 条</strong>
        <span v-if="hiddenSelectedCount > 0">
          其中 {{ hiddenSelectedCount }} 条不在当前筛选结果中
        </span>
      </div>

      <div class="selection-actions">
        <button
          type="button"
          class="secondary-button"
          :disabled="filteredEntries.length === 0"
          @click="selectAllFiltered"
        >
          选择全部筛选结果
        </button>
        <button
          type="button"
          class="secondary-button"
          :disabled="selectedCount === 0"
          @click="clearSelection"
        >
          清空选择
        </button>
      </div>

      <div v-if="availableBatchActions.length > 0" class="batch-controls">
        <select v-model="selectedOperation" aria-label="批量操作">
          <option
            v-for="action in availableBatchActions"
            :key="action.value"
            :value="action.value"
          >
            {{ action.label }}
          </option>
        </select>
        <input
          v-if="batchNeedsNote"
          v-model="batchNote"
          type="text"
          maxlength="500"
          placeholder="统一说明（可选，将写入每条词条批注）"
        />
        <button
          type="button"
          class="primary-button"
          :disabled="selectedCount === 0 || isPreviewing"
          @click="handlePreviewBatch"
        >
          {{ isPreviewing ? "正在预检..." : "预检并执行" }}
        </button>
      </div>
      <p v-else class="permission-message">当前成员没有可用的批量操作权限。</p>
    </section>

    <p v-if="isLoading" class="empty-state">正在加载项目词条...</p>

    <section v-else class="table-frame">
      <div class="table-scroll">
        <table>
          <colgroup>
            <col class="check-column" />
            <col class="location-column" />
            <col class="key-column" />
            <col class="text-column" />
            <col class="text-column" />
            <col class="member-column" />
            <col class="status-column" />
            <col class="dispute-column" />
            <col class="time-column" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="选择当前页"
                  :checked="isCurrentPageSelected"
                  @change="toggleCurrentPage"
                />
              </th>
              <th>位置</th>
              <th>键值</th>
              <th>原文</th>
              <th>译文</th>
              <th>负责人</th>
              <th>状态</th>
              <th>争议</th>
              <th>最后修改</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in pagedEntries"
              :key="entry.id"
              :class="{ selected: selectedEntryIds.has(entry.id) }"
            >
              <td>
                <input
                  type="checkbox"
                  :aria-label="`选择词条 ${entry.key}`"
                  :checked="selectedEntryIds.has(entry.id)"
                  @change="toggleEntry(entry.id)"
                />
              </td>
              <td>
                <button
                  type="button"
                  class="entry-link"
                  :title="`${getFileName(entry.file_id)} #${entry.index}`"
                  @click="emit('openEntry', entry.file_id, entry.id, entry.index)"
                >
                  <span>{{ getFileName(entry.file_id) }}</span>
                  <small>#{{ entry.index }}</small>
                </button>
              </td>
              <td class="truncate-cell" :title="entry.key">{{ entry.key }}</td>
              <td class="truncate-cell" :title="entry.source">
                {{ entry.source || "—" }}
              </td>
              <td
                class="truncate-cell target-cell"
                :class="{ empty: !hasWorkflowTarget(entry) }"
                :title="entry.target"
              >
                {{ getTargetLabel(entry) }}
              </td>
              <td class="truncate-cell" :title="getMemberName(entry.assignee)">
                {{ getMemberName(entry.assignee) }}
              </td>
              <td>
                <span class="status-badge" :class="entry.status">
                  {{ getEntryWorkflowLabel(entry, project.settings.workflow) }}
                </span>
              </td>
              <td>
                <span v-if="entry.disputed" class="dispute-badge">有争议</span>
                <span v-else class="muted-text">—</span>
              </td>
              <td class="time-cell">
                <span>{{ getMemberName(entry.updated_by) }}</span>
                <small>{{ formatDateTime(entry.updated_at, { seconds: false }) || "时间无效" }}</small>
              </td>
            </tr>
            <tr v-if="pagedEntries.length === 0">
              <td colspan="9" class="empty-table">没有符合条件的词条。</td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer class="pagination">
        <label>
          <span>每页</span>
          <select v-model="pageSize">
            <option
              v-for="option in pageSizeOptions"
              :key="option"
              :value="option"
            >
              {{ option }}
            </option>
          </select>
        </label>
        <span>第 {{ currentPage }} / {{ totalPages }} 页</span>
        <button
          type="button"
          class="secondary-button"
          :disabled="currentPage <= 1"
          @click="movePage(-1)"
        >
          上一页
        </button>
        <button
          type="button"
          class="secondary-button"
          :disabled="currentPage >= totalPages"
          @click="movePage(1)"
        >
          下一页
        </button>
      </footer>
    </section>

    <div
      v-if="batchPreview"
      class="dialog-backdrop"
      role="presentation"
      @click.self="closeBatchPreview"
    >
      <section
        class="batch-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-dialog-title"
      >
        <header>
          <div>
            <p class="eyebrow">批量操作确认</p>
            <h2 id="batch-dialog-title">{{ selectedOperationLabel }}</h2>
          </div>
          <button
            type="button"
            class="close-button"
            aria-label="关闭"
            :disabled="isExecuting"
            @click="closeBatchPreview"
          >
            ×
          </button>
        </header>

        <dl class="preview-summary">
          <div>
            <dt>已选择</dt>
            <dd>{{ batchPreview.selectedCount }}</dd>
          </div>
          <div>
            <dt>可以处理</dt>
            <dd>{{ batchPreview.applicableEntryIds.length }}</dd>
          </div>
          <div>
            <dt>将跳过</dt>
            <dd>{{ batchPreview.skipped.length }}</dd>
          </div>
        </dl>

        <section v-if="batchPreview.skippedReasonCounts.length > 0" class="skip-list">
          <h3>跳过原因</h3>
          <ul>
            <li
              v-for="item in batchPreview.skippedReasonCounts"
              :key="item.reason"
            >
              <span>{{ item.reason }}</span>
              <strong>{{ item.count }} 条</strong>
            </li>
          </ul>
        </section>

        <p class="dialog-note">
          执行时会重新读取并再次校验词条；状态或权限已经变化的词条会按最新结果处理。
        </p>

        <footer>
          <button
            type="button"
            class="secondary-button"
            :disabled="isExecuting"
            @click="closeBatchPreview"
          >
            取消
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="batchPreview.applicableEntryIds.length === 0 || isExecuting"
            @click="handleExecuteBatch"
          >
            {{ isExecuting ? "正在执行..." : `确认处理 ${batchPreview.applicableEntryIds.length} 条` }}
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.entries-page {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 16px;
  height: calc(100vh - 108px);
  min-height: 0;
  overflow: hidden;
}

.batch-controls,
.selection-actions,
.pagination,
.batch-dialog header,
.batch-dialog footer {
  display: flex;
  align-items: center;
}

.eyebrow,
h1,
h2,
h3,
p,
dl,
dd {
  margin: 0;
}

.eyebrow {
  margin-bottom: 5px;
  color: #5b6472;
  font-size: 13px;
}

h1 {
  color: #111827;
  font-size: 28px;
}

h2 {
  color: #111827;
  font-size: 21px;
}

h3 {
  color: #374151;
  font-size: 14px;
}

.count-summary {
  color: #4b5563;
  font-size: 14px;
}

.filter-bar {
  display: grid;
  grid-template-columns: minmax(260px, 1.8fr) repeat(6, minmax(128px, 1fr));
  gap: 10px;
  padding: 12px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.message-row {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  line-height: 1.4;
}

label {
  display: grid;
  gap: 5px;
  min-width: 0;
}

label > span {
  color: #5b6472;
  font-size: 12px;
}

input,
select {
  min-width: 0;
  min-height: 36px;
  padding: 0 9px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  font-size: 13px;
}

input[type="checkbox"] {
  width: 16px;
  min-height: 16px;
  margin: 0;
  padding: 0;
}

.batch-bar {
  display: grid;
  grid-template-columns: minmax(150px, 0.8fr) auto minmax(360px, 1.4fr);
  align-items: center;
  gap: 8px 12px;
  min-height: 52px;
  padding: 8px 12px;
  overflow: hidden;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #f8fafb;
}

.selection-summary {
  display: grid;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
}

.selection-summary strong {
  color: #174346;
  font-size: 14px;
}

.selection-summary span,
.permission-message {
  color: #5b6472;
  font-size: 12px;
}

.selection-summary strong,
.selection-summary span,
.permission-message {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selection-actions,
.batch-controls {
  gap: 8px;
  min-width: 0;
}

.batch-controls {
  min-width: 0;
  justify-content: flex-end;
}

.batch-controls select {
  flex: 0 0 116px;
}

.batch-controls input {
  flex: 1 1 260px;
  max-width: 360px;
}

.primary-button,
.secondary-button,
.close-button,
.entry-link {
  min-height: 36px;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.primary-button,
.secondary-button {
  padding: 0 12px;
  border: 1px solid #2f6f73;
  font-size: 13px;
}

.primary-button {
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button {
  background: #ffffff;
  color: #285f63;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.error-message,
.notice-message {
  min-width: 0;
  overflow: hidden;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.error-message {
  color: #b42318;
}

.notice-message {
  color: #166534;
}

.table-frame {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.table-scroll {
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}

table {
  width: 100%;
  min-width: 1280px;
  border-collapse: collapse;
  table-layout: fixed;
}

.check-column {
  width: 42px;
}

.location-column {
  width: 150px;
}

.key-column {
  width: 150px;
}

.text-column {
  width: 260px;
}

.member-column {
  width: 110px;
}

.status-column {
  width: 110px;
}

.dispute-column {
  width: 78px;
}

.time-column {
  width: 160px;
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 40px;
  padding: 0 10px;
  border-bottom: 1px solid #d7dde5;
  background: #f3f5f7;
  color: #374151;
  font-size: 12px;
  text-align: left;
}

td {
  height: 52px;
  padding: 6px 10px;
  border-bottom: 1px solid #e7ebef;
  color: #1f2937;
  font-size: 13px;
  vertical-align: middle;
}

tbody tr:hover,
tbody tr.selected {
  background: #f0f8f6;
}

.entry-link {
  display: grid;
  align-content: center;
  gap: 2px;
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: #236368;
  text-align: left;
}

.entry-link span,
.entry-link small,
.truncate-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-link small,
.time-cell small {
  color: #6b7280;
  font-size: 11px;
}

.target-cell.empty,
.muted-text {
  color: #9ca3af;
}

.status-badge,
.dispute-badge {
  display: inline-block;
  max-width: 100%;
  padding: 3px 7px;
  overflow: hidden;
  border-radius: 999px;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge {
  background: #eef2f4;
  color: #46515e;
}

.status-badge.proofread {
  background: #e7f3ed;
  color: #166534;
}

.status-badge.reviewed {
  background: #e6f0ef;
  color: #174346;
}

.dispute-badge {
  background: #fff4e5;
  color: #92400e;
}

.time-cell {
  display: grid;
  align-content: center;
  gap: 2px;
}

.time-cell span,
.time-cell small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-table,
.empty-state {
  padding: 24px;
  color: #5b6472;
  text-align: center;
}

.pagination {
  justify-content: flex-end;
  gap: 10px;
  min-height: 50px;
  padding: 7px 12px;
  border-top: 1px solid #d7dde5;
  background: #f8fafb;
  color: #4b5563;
  font-size: 13px;
}

.pagination label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pagination select {
  min-height: 32px;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(17 24 39 / 45%);
}

.batch-dialog {
  width: min(620px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgb(17 24 39 / 24%);
}

.batch-dialog header,
.batch-dialog footer {
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
}

.batch-dialog header {
  border-bottom: 1px solid #e5e7eb;
}

.batch-dialog footer {
  justify-content: flex-end;
  border-top: 1px solid #e5e7eb;
}

.close-button {
  width: 36px;
  padding: 0;
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #4b5563;
  font-size: 22px;
}

.preview-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-bottom: 1px solid #e5e7eb;
}

.preview-summary div {
  display: grid;
  gap: 4px;
  padding: 16px 18px;
}

.preview-summary dt {
  color: #6b7280;
  font-size: 12px;
}

.preview-summary dd {
  color: #111827;
  font-size: 24px;
  font-weight: 700;
}

.skip-list {
  display: grid;
  gap: 10px;
  padding: 16px 18px 4px;
}

.skip-list ul {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.skip-list li {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  color: #4b5563;
  font-size: 13px;
}

.skip-list strong {
  flex: 0 0 auto;
  color: #1f2937;
}

.dialog-note {
  padding: 14px 18px 18px;
  color: #5b6472;
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 1280px) {
  .filter-bar {
    grid-template-columns: repeat(4, minmax(140px, 1fr));
  }

  .search-field {
    grid-column: span 2;
  }

  .batch-bar {
    grid-template-columns: minmax(150px, 1fr) minmax(250px, auto);
  }

  .batch-controls {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .batch-controls input {
    max-width: none;
  }
}

@media (max-width: 840px) {
  .entries-page {
    grid-template-rows: auto 24px auto auto minmax(560px, 1fr);
    height: auto;
    min-height: 0;
    overflow: visible;
  }

  .filter-bar {
    grid-template-columns: 1fr 1fr;
  }

  .search-field {
    grid-column: 1 / -1;
  }

  .batch-controls {
    justify-content: stretch;
  }

  .batch-controls > * {
    flex: 1 1 100%;
    max-width: none;
  }

  .batch-bar {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .selection-actions,
  .batch-controls {
    flex-wrap: wrap;
  }

  .table-frame {
    min-height: 560px;
  }
}
</style>
