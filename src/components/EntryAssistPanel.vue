<script setup lang="ts">
import { ref, watch } from "vue";
import CommentPanel from "./CommentPanel.vue";
import TermHint from "./TermHint.vue";
import type { Entry, ProjectEvent } from "../model/types";
import { getEntryHistory } from "../services/history";
import { checkTermUsage, type TermUsageResult } from "../services/terms";

const props = defineProps<{
  entry?: Entry;
  draftTarget: string;
}>();

const emit = defineEmits<{
  entryUpdated: [entry: Entry];
}>();

type AssistTab = "history" | "terms" | "comments";

const activeTab = ref<AssistTab>("terms");
const termResults = ref<TermUsageResult[]>([]);
const historyEvents = ref<ProjectEvent[]>([]);
const termErrorMessage = ref("");
const historyErrorMessage = ref("");
let termRequestId = 0;
let historyRequestId = 0;

const tabs: Array<{ id: AssistTab; label: string }> = [
  { id: "history", label: "历史" },
  { id: "terms", label: "术语" },
  { id: "comments", label: "注释" },
];

function describeEvent(event: ProjectEvent): string {
  if (event.type === "entry.updated") {
    return "词条已更新";
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

watch(
  [() => props.entry?.source, () => props.draftTarget],
  async ([sourceText, targetText]) => {
    const requestId = (termRequestId += 1);

    if (!sourceText) {
      termResults.value = [];
      termErrorMessage.value = "";
      return;
    }

    try {
      const results = await checkTermUsage(sourceText, targetText);

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
  },
  { immediate: true },
);

watch(
  () => props.entry?.id,
  async (entryId) => {
    const requestId = (historyRequestId += 1);

    if (!entryId) {
      historyEvents.value = [];
      historyErrorMessage.value = "";
      return;
    }

    try {
      const events = await getEntryHistory(entryId);

      if (requestId === historyRequestId) {
        historyEvents.value = events.sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
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
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <section v-if="activeTab === 'history'" class="tab-panel">
      <p v-if="historyErrorMessage" class="error-message">
        {{ historyErrorMessage }}
      </p>
      <p v-else-if="historyEvents.length === 0" class="empty-text">
        暂无历史记录
      </p>
      <ul v-else class="history-list">
        <li v-for="event in historyEvents" :key="event.id">
          <strong>{{ describeEvent(event) }}</strong>
          <span>{{ event.user_id }} · {{ event.created_at }}</span>
        </li>
      </ul>
    </section>

    <section v-else-if="activeTab === 'terms'" class="tab-panel">
      <p v-if="termErrorMessage" class="error-message">{{ termErrorMessage }}</p>
      <TermHint v-else :terms="termResults" />
    </section>

    <section v-else class="tab-panel">
      <CommentPanel :entry="entry" @entry-updated="emit('entryUpdated', $event)" />
    </section>
  </aside>
</template>

<style scoped>
.entry-assist-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.assist-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-bottom: 1px solid #e5e7eb;
}

.tab-button {
  min-height: 42px;
  border: 0;
  border-right: 1px solid #e5e7eb;
  background: #f8fafb;
  color: #4b5563;
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
  padding: 16px;
}

.empty-text,
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

.history-list strong {
  color: #111827;
  font-size: 14px;
}

.history-list span {
  color: #5b6472;
  font-size: 13px;
}
</style>
