<script setup lang="ts">
import type { Entry } from "../model/types";

defineProps<{
  entries: Entry[];
  selectedEntryId?: string;
}>();

const emit = defineEmits<{
  select: [entry: Entry];
}>();
</script>

<template>
  <div class="entry-list">
    <button
      v-for="entry in entries"
      :key="entry.id"
      class="entry-row"
      :class="{ selected: entry.id === selectedEntryId }"
      type="button"
      @click="emit('select', entry)"
    >
      <span class="entry-index">#{{ entry.index }}</span>
      <span class="entry-speaker">{{ entry.speaker || "旁白" }}</span>
      <span class="entry-source">{{ entry.source }}</span>
      <span class="entry-target">{{ entry.target || "未填写译文" }}</span>
      <span class="entry-status">{{ entry.status }}</span>
    </button>
  </div>
</template>

<style scoped>
.entry-list {
  display: grid;
  gap: 8px;
}

.entry-row {
  display: grid;
  grid-template-columns: 64px 88px minmax(0, 1.2fr) minmax(0, 1fr) 104px;
  gap: 12px;
  align-items: center;
  width: 100%;
  min-height: 48px;
  padding: 10px 12px;
  border: 1px solid #d7dde5;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
}

.entry-row:hover,
.entry-row.selected {
  border-color: #2563eb;
  background: #eff6ff;
}

.entry-index,
.entry-speaker,
.entry-status {
  color: #5b6472;
  font-size: 13px;
}

.entry-source,
.entry-target {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-target {
  color: #4b5563;
}

@media (max-width: 820px) {
  .entry-row {
    grid-template-columns: 56px 1fr;
  }

  .entry-source,
  .entry-target,
  .entry-status {
    grid-column: 1 / -1;
    white-space: normal;
  }
}
</style>
