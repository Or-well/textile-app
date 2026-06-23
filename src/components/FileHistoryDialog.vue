<script setup lang="ts">
import type { FileHistoryRow } from "../services/history";
import { formatDateTime } from "../utils/time";

defineProps<{
  open: boolean;
  fileName: string;
  rows: FileHistoryRow[];
  isLoading: boolean;
  errorMessage: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

function formatCreatedAt(value: string): string {
  return formatDateTime(value, { seconds: false }) || value || "时间无效";
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "空";
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.join("、") : "空";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function getDetailEntries(detail: Record<string, unknown>) {
  return Object.entries(detail).filter(([key]) => key !== "file_id");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop"
      role="presentation"
      @click.self="emit('close')"
    >
      <section
        class="history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-history-title"
      >
        <header class="history-dialog-header">
          <div>
            <p>文件历史</p>
            <h2 id="file-history-title">{{ fileName }}</h2>
          </div>
          <button
            class="close-button"
            type="button"
            aria-label="关闭"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
        <p v-else-if="isLoading" class="empty-state">正在加载历史...</p>
        <p v-else-if="rows.length === 0" class="empty-state">
          暂无可显示的文件历史。
        </p>

        <ul v-else class="history-list">
          <li v-for="row in rows" :key="row.id">
            <div class="history-main">
              <strong>{{ row.label }}</strong>
              <small>
                {{ formatCreatedAt(row.createdAt) }} · {{ row.userId || "未知成员" }}
              </small>
            </div>
            <span v-if="row.entryId" class="entry-chip">{{ row.entryId }}</span>
            <details v-if="getDetailEntries(row.detail).length > 0">
              <summary>详情</summary>
              <dl>
                <div
                  v-for="[key, value] in getDetailEntries(row.detail)"
                  :key="key"
                >
                  <dt>{{ key }}</dt>
                  <dd>{{ formatDetailValue(value) }}</dd>
                </div>
              </dl>
            </details>
          </li>
        </ul>

        <footer>
          <button class="secondary-button" type="button" @click="emit('close')">
            关闭
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(17, 24, 39, 0.42);
}

.history-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 14px;
  width: min(720px, 100%);
  max-height: min(720px, calc(100vh - 32px));
  padding: 16px;
  overflow: hidden;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.26);
}

.history-dialog-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: start;
  gap: 12px;
}

.history-dialog-header p,
.history-dialog-header h2,
.empty-state,
.error-message,
dl,
dd {
  margin: 0;
}

.history-dialog-header p {
  color: #5b6472;
  font-size: 13px;
}

.history-dialog-header h2 {
  margin-top: 4px;
  color: #111827;
  font-size: 20px;
  overflow-wrap: anywhere;
}

.close-button {
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid #ccd4df;
  border-radius: 6px;
  background: #ffffff;
  color: #344054;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.error-message {
  color: #b42318;
  line-height: 1.7;
}

.empty-state {
  padding: 16px;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #ffffff;
  color: #526071;
}

.history-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.history-list li {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #ffffff;
}

.history-main {
  display: grid;
  gap: 4px;
}

.history-main strong {
  color: #111827;
}

.history-main small,
.entry-chip,
summary,
dt {
  color: #5b6472;
  font-size: 12px;
}

.entry-chip {
  justify-self: start;
  padding: 3px 7px;
  border-radius: 999px;
  background: #eef5f4;
  color: #174346;
  font-weight: 700;
}

summary {
  cursor: pointer;
}

dl {
  display: grid;
  gap: 6px;
  margin-top: 8px;
}

dl div {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 10px;
}

dd {
  min-width: 0;
  color: #1f2937;
  overflow-wrap: anywhere;
}

footer {
  display: flex;
  justify-content: flex-end;
}

.secondary-button {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #172033;
  font-size: 14px;
  cursor: pointer;
}

@media (max-width: 640px) {
  dl div {
    grid-template-columns: 1fr;
  }
}
</style>
