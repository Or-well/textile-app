<script setup lang="ts">
import ProgressBar from "./ProgressBar.vue";
import type { ProjectFile } from "../model/types";

defineProps<{
  file: ProjectFile;
  totalEntries: number;
  translatedPercent: number;
  proofreadPercent: number;
  reviewedPercent: number;
  disputedEntries: number;
  updatedAt: string;
  canUpdate: boolean;
  canImportTranslation: boolean;
  canRename: boolean;
  canLock: boolean;
  canHide: boolean;
  canDelete: boolean;
}>();

const emit = defineEmits<{
  open: [fileId: string];
  updateSource: [fileId: string];
  importTranslation: [fileId: string];
  rename: [fileId: string];
  toggleHidden: [fileId: string];
  toggleLocked: [fileId: string];
  delete: [fileId: string];
  history: [fileId: string];
}>();
</script>

<template>
  <article class="file-row" :class="{ hidden: file.hidden, locked: file.locked }">
    <button class="file-main" type="button" @click="emit('open', file.id)">
      <strong>{{ file.name }}</strong>
      <small>
        {{ file.folder || "未分组" }} · {{ totalEntries }} 词条
        <template v-if="file.hidden"> · 已隐藏</template>
        <template v-if="file.locked"> · 已锁定</template>
      </small>
    </button>

    <span class="metric">
      <ProgressBar :percent="translatedPercent" label="已翻译" />
    </span>
    <span class="metric">
      <ProgressBar :percent="proofreadPercent" label="已校对" />
    </span>
    <span class="metric">
      <ProgressBar :percent="reviewedPercent" label="已审核" />
    </span>
    <span class="dispute-count">{{ disputedEntries }} 争议</span>
    <span class="updated-at">{{ updatedAt }}</span>

    <div class="row-actions">
      <button
        class="text-button"
        type="button"
        :disabled="!canUpdate"
        @click="emit('updateSource', file.id)"
      >
        更新
      </button>
      <button
        class="text-button"
        type="button"
        :disabled="!canImportTranslation"
        @click="emit('importTranslation', file.id)"
      >
        导入译文
      </button>
      <details class="more-menu">
        <summary>更多</summary>
        <div class="menu-panel">
          <button type="button" :disabled="!canRename" @click="emit('rename', file.id)">
            重命名
          </button>
          <button
            type="button"
            :disabled="!canHide"
            @click="emit('toggleHidden', file.id)"
          >
            {{ file.hidden ? "取消隐藏" : "隐藏" }}
          </button>
          <button
            type="button"
            :disabled="!canLock"
            @click="emit('toggleLocked', file.id)"
          >
            {{ file.locked ? "解锁" : "锁定" }}
          </button>
          <button type="button" :disabled="!canDelete" @click="emit('delete', file.id)">
            删除
          </button>
          <button type="button" @click="emit('history', file.id)">查看历史</button>
        </div>
      </details>
    </div>
  </article>
</template>

<style scoped>
.file-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.2fr) minmax(126px, 0.6fr) minmax(126px, 0.6fr) minmax(126px, 0.6fr) minmax(78px, 0.32fr) minmax(132px, 0.48fr) minmax(230px, 0.7fr);
  gap: 12px;
  align-items: center;
  min-height: 78px;
  padding: 12px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.file-row.hidden {
  background: #f7f7f8;
}

.file-row.locked {
  border-color: #d7c49a;
}

.file-main {
  display: grid;
  gap: 4px;
  min-width: 0;
  border: 0;
  background: transparent;
  color: #111827;
  text-align: left;
  cursor: pointer;
}

.file-main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-main small,
.updated-at,
.dispute-count {
  color: #5b6472;
  font-size: 13px;
}

.metric {
  min-width: 0;
}

.row-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.text-button,
.more-menu summary,
.menu-panel button {
  min-height: 32px;
  padding: 0 9px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.more-menu {
  position: relative;
}

.more-menu summary {
  display: inline-flex;
  align-items: center;
  list-style: none;
}

.more-menu summary::-webkit-details-marker {
  display: none;
}

.menu-panel {
  position: absolute;
  top: 38px;
  right: 0;
  z-index: 3;
  display: grid;
  min-width: 130px;
  padding: 6px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
}

.menu-panel button {
  border: 0;
  text-align: left;
}

.menu-panel button:hover:not(:disabled) {
  background: #eef5f4;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

@media (max-width: 1180px) {
  .file-row {
    grid-template-columns: 1fr;
  }

  .row-actions {
    justify-content: flex-start;
  }
}
</style>
