<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import EntryAssistPanel from "../components/EntryAssistPanel.vue";
import EntryEditor from "../components/EntryEditor.vue";
import EntrySideList from "../components/EntrySideList.vue";
import type { Entry, EntryStatus, ProjectConfig } from "../model/types";
import { markDisputed, resolveDispute } from "../services/comments";
import { getEntryById, loadEntries, saveEntry } from "../services/entries";

type EntryFilter = EntryStatus | "all" | "disputed";
type AssistTab = "terms" | "comments" | "context" | "history";

const props = defineProps<{
  project: ProjectConfig;
  fileId: string;
}>();

const entries = ref<Entry[]>([]);
const selectedEntry = ref<Entry>();
const searchText = ref("");
const statusFilter = ref<EntryFilter>("all");
const assistTab = ref<AssistTab>("terms");
const draftTarget = ref("");
const isLoading = ref(false);
const isSaving = ref(false);
const errorMessage = ref("");
const savedMessage = ref("");

const currentFile = computed(() =>
  props.project.files.find((file) => file.id === props.fileId),
);

const filteredEntries = computed(() => {
  const keyword = searchText.value.trim().toLowerCase();

  return entries.value.filter((entry) => {
    if (statusFilter.value === "disputed" && entry.disputed !== true) {
      return false;
    }

    if (
      statusFilter.value !== "all" &&
      statusFilter.value !== "disputed" &&
      entry.status !== statusFilter.value
    ) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    return (
      entry.source.toLowerCase().includes(keyword) ||
      entry.target.toLowerCase().includes(keyword) ||
      entry.id.toLowerCase().includes(keyword) ||
      entry.speaker.toLowerCase().includes(keyword)
    );
  });
});

const selectedIndex = computed(() =>
  selectedEntry.value
    ? filteredEntries.value.findIndex((entry) => entry.id === selectedEntry.value?.id)
    : -1,
);
const canGoPrevious = computed(() => selectedIndex.value > 0);
const canGoNext = computed(
  () => selectedIndex.value >= 0 && selectedIndex.value < filteredEntries.value.length - 1,
);

async function loadFileEntries() {
  isLoading.value = true;
  errorMessage.value = "";
  savedMessage.value = "";
  selectedEntry.value = undefined;
  draftTarget.value = "";

  try {
    const file = currentFile.value;
    const loadedEntries = await loadEntries(props.fileId);
    entries.value = loadedEntries.map((entry) => ({
      ...entry,
      locked: entry.locked || Boolean(file?.locked),
      hidden: entry.hidden || Boolean(file?.hidden),
    }));
    selectedEntry.value = entries.value[0];
    draftTarget.value = selectedEntry.value?.target ?? "";
  } catch (error) {
    entries.value = [];
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "词条列表加载失败。请确认文件数据可以读取。";
  } finally {
    isLoading.value = false;
  }
}

async function handleSelectEntry(entry: Entry) {
  selectedEntry.value = (await getEntryById(entry.id)) ?? entry;
  draftTarget.value = selectedEntry.value.target;
  savedMessage.value = "";
}

function replaceEntry(savedEntry: Entry) {
  entries.value = entries.value.map((entry) =>
    entry.id === savedEntry.id ? savedEntry : entry,
  );
  selectedEntry.value = savedEntry;
  draftTarget.value = savedEntry.target;
}

function selectEntryByOffset(offset: -1 | 1) {
  const nextEntry = filteredEntries.value[selectedIndex.value + offset];

  if (nextEntry) {
    void handleSelectEntry(nextEntry);
  }
}

async function handleSaveEntry(entry: Entry) {
  isSaving.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const savedEntry = await saveEntry(entry);

    replaceEntry(savedEntry);
    savedMessage.value = "已保存译文。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "保存失败。请确认项目文件夹仍然可以访问。";
  } finally {
    isSaving.value = false;
  }
}

async function handleWorkflowStatus(entry: Entry) {
  isSaving.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const savedEntry = await saveEntry(entry);

    replaceEntry(savedEntry);
    savedMessage.value = "词条状态已更新。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "状态更新失败。请确认项目文件夹仍然可以访问。";
  } finally {
    isSaving.value = false;
  }
}

async function handleMarkDisputed(entry: Entry) {
  isSaving.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const updatedEntry = await markDisputed(entry, "");

    replaceEntry(updatedEntry);
    savedMessage.value = "已标记为争议。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "标记争议失败。请稍后再试。";
  } finally {
    isSaving.value = false;
  }
}

async function handleResolveDispute(entry: Entry) {
  isSaving.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const updatedEntry = await resolveDispute(entry, "");

    replaceEntry(updatedEntry);
    savedMessage.value = "争议已解决。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "解决争议失败。请稍后再试。";
  } finally {
    isSaving.value = false;
  }
}

async function handleSaveAndNext(entry: Entry) {
  isSaving.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const savedEntry = await saveEntry(entry);
    const nextEntry = filteredEntries.value[selectedIndex.value + 1];

    replaceEntry(savedEntry);

    if (nextEntry) {
      await handleSelectEntry(nextEntry);
    }

    savedMessage.value = "已保存译文。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "保存失败。请确认项目文件夹仍然可以访问。";
  } finally {
    isSaving.value = false;
  }
}

function handleEntryUpdated(entry: Entry) {
  replaceEntry(entry);
  savedMessage.value = "词条状态已更新。";
}

function handleOpenContext() {
  assistTab.value = "context";
}

watch(
  () => [props.project.project_id, props.fileId],
  () => {
    void loadFileEntries();
  },
);

watch(filteredEntries, (nextEntries) => {
  if (
    selectedEntry.value &&
    nextEntries.some((entry) => entry.id === selectedEntry.value?.id)
  ) {
    return;
  }

  selectedEntry.value = nextEntries[0];
  draftTarget.value = selectedEntry.value?.target ?? "";
});

onMounted(loadFileEntries);
</script>

<template>
  <section class="entry-page">
    <header class="entry-page-header">
      <div>
        <p class="eyebrow">文件词条</p>
        <h1>{{ currentFile?.name || fileId }}</h1>
      </div>
      <p class="entry-count">{{ filteredEntries.length }} / {{ entries.length }} 条</p>
    </header>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="savedMessage" class="saved-message">{{ savedMessage }}</p>
    <p v-if="isLoading" class="empty-state">正在加载词条...</p>

    <section v-else-if="entries.length > 0" class="entry-workspace">
      <EntrySideList
        :entries="filteredEntries"
        :selected-entry-id="selectedEntry?.id"
        :search-text="searchText"
        :status-filter="statusFilter"
        :total-count="entries.length"
        :workflow="project.settings.workflow"
        @select="handleSelectEntry"
        @update-search-text="searchText = $event"
        @update-status-filter="statusFilter = $event"
      />

      <EntryEditor
        :entry="selectedEntry"
        :file-name="currentFile?.name || fileId"
        :is-saving="isSaving"
        :can-go-previous="canGoPrevious"
        :can-go-next="canGoNext"
        :workflow="project.settings.workflow"
        @save="handleSaveEntry"
        @save-next="handleSaveAndNext"
        @previous="selectEntryByOffset(-1)"
        @next="selectEntryByOffset(1)"
        @draft-target-changed="draftTarget = $event"
        @workflow-status="handleWorkflowStatus"
        @mark-disputed="handleMarkDisputed"
        @resolve-dispute="handleResolveDispute"
        @open-context="handleOpenContext"
      />

      <EntryAssistPanel
        :entry="selectedEntry"
        :draft-target="draftTarget"
        :active-tab="assistTab"
        @entry-updated="handleEntryUpdated"
        @update-active-tab="assistTab = $event"
      />
    </section>

    <p v-else-if="!errorMessage" class="empty-state">
      这个文件还没有可编辑的词条。
    </p>
  </section>
</template>

<style scoped>
.entry-page {
  display: grid;
  gap: 14px;
  height: calc(100vh - 108px);
  min-height: 640px;
}

.entry-page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #5b6472;
  font-size: 14px;
}

h1,
p {
  margin: 0;
}

h1 {
  color: #111827;
  font-size: 28px;
  line-height: 1.2;
}

.entry-count {
  padding: 5px 10px;
  border-radius: 999px;
  background: #e6f0ef;
  color: #174346;
  font-size: 13px;
  font-weight: 700;
}

.error-message,
.saved-message,
.empty-state {
  line-height: 1.7;
}

.error-message {
  color: #b42318;
}

.saved-message {
  color: #166534;
}

.empty-state {
  padding: 18px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #4b5563;
}

.entry-workspace {
  display: grid;
  grid-template-columns: minmax(240px, 0.75fr) minmax(360px, 1.35fr) minmax(280px, 0.9fr);
  gap: 14px;
  min-height: 0;
}

@media (max-width: 1180px) {
  .entry-page {
    height: auto;
  }

  .entry-workspace {
    grid-template-columns: 1fr;
  }
}
</style>
