<script setup lang="ts">
import type { Entry, EntryStatus } from "../model/types";

defineProps<{
  entries: Entry[];
  selectedEntryId?: string;
  searchText: string;
  statusFilter: EntryStatus | "all";
  totalCount: number;
}>();

const emit = defineEmits<{
  select: [entry: Entry];
  updateSearchText: [value: string];
  updateStatusFilter: [value: EntryStatus | "all"];
}>();

const statusLabels: Record<EntryStatus, string> = {
  untranslated: "未翻译",
  translated: "已翻译",
  proofread: "已校对",
  reviewed: "已审核",
  disputed: "有争议",
};

function summarize(text: string): string {
  return text.length > 54 ? `${text.slice(0, 54)}...` : text;
}
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
          @change="emit('updateStatusFilter', ($event.target as HTMLSelectElement).value as EntryStatus | 'all')"
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

    <div class="entry-list" role="list">
      <button
        v-for="entry in entries"
        :key="entry.id"
        class="entry-row"
        :class="{ selected: entry.id === selectedEntryId, disputed: entry.status === 'disputed' }"
        type="button"
        @click="emit('select', entry)"
      >
        <span class="entry-source">{{ summarize(entry.source) }}</span>
        <span class="entry-row-meta">
          <span>{{ statusLabels[entry.status] }}</span>
          <span v-if="entry.status === 'disputed'">有争议</span>
          <span v-if="entry.updated_at">有记录</span>
        </span>
      </button>
    </div>

    <p class="list-count">显示 {{ entries.length }} / {{ totalCount }} 条</p>
  </aside>
</template>

<style scoped>
.entry-side-list {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 0;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
}

.list-tools {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid #e5e7eb;
}

label {
  display: grid;
  gap: 6px;
}

label span {
  color: #5b6472;
  font-size: 13px;
}

input,
select {
  width: 100%;
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
}

.entry-list {
  display: grid;
  align-content: start;
  gap: 6px;
  min-height: 0;
  overflow: auto;
  padding: 10px;
}

.entry-row {
  display: grid;
  gap: 7px;
  width: 100%;
  min-height: 72px;
  padding: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
}

.entry-row:hover,
.entry-row.selected {
  border-color: #2f6f73;
  background: #f0f8f6;
}

.entry-row.disputed {
  border-left: 4px solid #b45309;
}

.entry-source {
  overflow: hidden;
  color: #111827;
  font-size: 14px;
  line-height: 1.45;
}

.entry-row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.entry-row-meta span {
  padding: 2px 6px;
  border-radius: 999px;
  background: #f3f5f7;
  color: #5b6472;
  font-size: 12px;
}

.list-count {
  margin: 0;
  padding: 11px 14px;
  border-top: 1px solid #e5e7eb;
  color: #5b6472;
  font-size: 13px;
}
</style>
