<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { Entry, EntryStatus, ProjectWorkflowSettings } from "../model/types";
import { getEntryWorkflowLabel } from "../model/status";

type EntryFilter = EntryStatus | "all" | "disputed";

const props = defineProps<{
  entries: Entry[];
  selectedEntryId?: string;
  searchText: string;
  statusFilter: EntryFilter;
  totalCount: number;
  filteredCount: number;
  page: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  totalPages: number;
  pageStart: number;
  pageEnd: number;
  workflow?: ProjectWorkflowSettings;
}>();

const emit = defineEmits<{
  select: [entry: Entry];
  updateSearchText: [value: string];
  updateStatusFilter: [value: EntryFilter];
  updatePage: [value: number];
  updatePageSize: [value: number];
}>();

const listRef = ref<HTMLElement | null>(null);

function summarize(text: string): string {
  return text.length > 68 ? `${text.slice(0, 68)}...` : text;
}

const countLabel = computed(() => {
  const isFiltered = props.statusFilter !== "all" || Boolean(props.searchText.trim());

  return isFiltered
    ? `匹配 ${props.filteredCount} 条 / 共 ${props.totalCount} 条`
    : `共 ${props.totalCount} 条`;
});

const pageRangeLabel = computed(() => {
  if (props.filteredCount === 0) {
    return "0 / 0";
  }

  return `${props.pageStart}-${props.pageEnd} / ${props.filteredCount}`;
});

function scrollSelectedEntryIntoSecondRow() {
  void nextTick(() => {
    const list = listRef.value;

    if (!list || !props.selectedEntryId) {
      return;
    }

    const rows = Array.from(
      list.querySelectorAll<HTMLElement>("[data-entry-id]"),
    );
    const selectedRow = rows.find(
      (row) => row.dataset.entryId === props.selectedEntryId,
    );

    if (!selectedRow) {
      list.scrollTop = 0;
      return;
    }

    const previousRow = selectedRow.previousElementSibling as HTMLElement | null;

    list.scrollTop = previousRow ? previousRow.offsetTop : selectedRow.offsetTop;
  });
}

watch(
  () => [props.selectedEntryId, props.entries.map((entry) => entry.id).join("|")],
  scrollSelectedEntryIntoSecondRow,
  { immediate: true },
);
</script>

<template>
  <aside class="entry-side-list">
    <div class="list-tools">
      <label>
        <span>搜索</span>
        <input
          :value="searchText"
          type="search"
          placeholder="搜索词条"
          @input="emit('updateSearchText', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <label>
        <span>筛选</span>
        <select
          :value="statusFilter"
          @change="emit('updateStatusFilter', ($event.target as HTMLSelectElement).value as EntryFilter)"
        >
          <option value="all">全部</option>
          <option value="untranslated">未翻译</option>
          <option value="translated">已翻译</option>
          <option value="proofread">已校对</option>
          <option value="reviewed">已审核</option>
          <option value="disputed">有争议</option>
        </select>
      </label>
    </div>

    <div ref="listRef" class="entry-list" role="list">
      <button
        v-for="entry in entries"
        :key="entry.id"
        class="entry-row"
        :class="{ selected: entry.id === selectedEntryId, disputed: entry.disputed }"
        :data-entry-id="entry.id"
        type="button"
        @click="emit('select', entry)"
      >
        <span class="entry-source">{{ summarize(entry.source) }}</span>
        <span class="entry-row-meta">
          <span>{{ getEntryWorkflowLabel(entry, workflow) }}</span>
          <span v-if="entry.disputed">有争议</span>
          <span v-if="entry.updated_at">有记录</span>
        </span>
      </button>
    </div>

    <footer class="entry-pagination" aria-label="词条分页">
      <div class="pagination-controls">
        <button
          type="button"
          :disabled="page <= 1"
          aria-label="第一页"
          @click="emit('updatePage', 1)"
        >
          «
        </button>
        <button
          type="button"
          :disabled="page <= 1"
          aria-label="上一页"
          @click="emit('updatePage', page - 1)"
        >
          ‹
        </button>

        <span class="page-indicator">{{ page }} / {{ totalPages }}</span>

        <button
          type="button"
          :disabled="page >= totalPages"
          aria-label="下一页"
          @click="emit('updatePage', page + 1)"
        >
          ›
        </button>
        <button
          type="button"
          :disabled="page >= totalPages"
          aria-label="最后一页"
          @click="emit('updatePage', totalPages)"
        >
          »
        </button>

        <select
          class="page-size-select"
          :value="pageSize"
          aria-label="每页词条数"
          @change="emit('updatePageSize', Number(($event.target as HTMLSelectElement).value))"
        >
          <option
            v-for="option in pageSizeOptions"
            :key="option"
            :value="option"
          >
            {{ option }}
          </option>
        </select>
      </div>

      <p class="pagination-summary">
        <span>{{ countLabel }}</span>
        <span>{{ pageRangeLabel }}</span>
      </p>
    </footer>
  </aside>
</template>

<style scoped>
.entry-side-list {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
}

.list-tools {
  display: grid;
  gap: 9px;
  padding: 10px 12px;
  border-bottom: 1px solid #e5e7eb;
}

label {
  display: grid;
  gap: 5px;
}

label span {
  color: #5b6472;
  font-size: 13px;
}

input,
select {
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
}

.entry-list {
  display: grid;
  align-content: start;
  gap: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0;
  scrollbar-gutter: stable;
}

.entry-row {
  display: grid;
  gap: 4px;
  width: 100%;
  min-height: 58px;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid #e5e7eb;
  border-left: 3px solid transparent;
  border-radius: 0;
  background: #ffffff;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
}

.entry-row:hover,
.entry-row.selected {
  border-left-color: #2f6f73;
  background: #f0f8f6;
}

.entry-row.disputed {
  border-left-color: #b45309;
}

.entry-row.selected.disputed {
  border-left-color: #2f6f73;
}

.entry-source {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  color: #111827;
  font-size: 13px;
  line-height: 1.35;
}

.entry-row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.entry-row-meta span {
  padding: 1px 6px;
  border-radius: 999px;
  background: #f3f5f7;
  color: #5b6472;
  font-size: 12px;
}

.entry-pagination {
  display: grid;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid #e5e7eb;
  background: #ffffff;
}

.pagination-summary {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  color: #5b6472;
  font-size: 12px;
  line-height: 1.35;
}

.pagination-controls {
  display: grid;
  grid-template-columns: 30px 30px minmax(54px, 1fr) 30px 30px 56px;
  gap: 5px;
  align-items: center;
  min-width: 0;
}

.pagination-controls button,
.page-size-select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 32px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
}

.pagination-controls button {
  padding: 0;
  font-size: 15px;
  cursor: pointer;
}

.pagination-controls button:not(:disabled):hover {
  border-color: #2f6f73;
  background: #eef7f5;
}

.pagination-controls button:disabled {
  color: #9ca3af;
  cursor: not-allowed;
}

.page-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  min-width: 0;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  color: #111827;
  font-size: 12px;
  font-weight: 700;
}

.page-size-select {
  padding: 0 4px;
  font-size: 13px;
}

@media (max-width: 1180px) {
  .entry-side-list {
    height: min(72vh, 680px);
  }
}
</style>
