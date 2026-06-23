<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import EntryAssistPanel from "../components/EntryAssistPanel.vue";
import EntryEditor from "../components/EntryEditor.vue";
import EntrySideList from "../components/EntrySideList.vue";
import ProjectPageHeader from "../components/ProjectPageHeader.vue";
import { useAppDraft } from "../composables/useAppDraft";
import type {
  Comment,
  Entry,
  EntryStatus,
  Member,
  ProjectConfig,
} from "../model/types";
import { markDisputed, resolveDispute } from "../services/comments";
import {
  loadEntries,
  saveEntry,
  updateEntryAccess,
} from "../services/entries";
import { getCurrentUser } from "../services/permissions";

type EntryFilter = EntryStatus | "all" | "disputed";
type AssistTab = "terms" | "comments" | "context" | "history";
type EntryScrollPosition = "nearest" | "second" | "top";
const ENTRY_PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500, 800] as const;

const props = defineProps<{
  project: ProjectConfig;
  members?: Member[];
  fileId: string;
  targetEntryId?: string;
  targetEntryIndex?: number;
  targetAssistTab?: AssistTab;
  targetCommentId?: string;
  lastViewedEntryId?: string;
}>();

const emit = defineEmits<{
  openCommentTarget: [comment: Comment];
  entryViewed: [fileId: string, entryId: string];
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
const currentEntryPage = ref(1);
const entryPageSize = ref<(typeof ENTRY_PAGE_SIZE_OPTIONS)[number]>(50);
const scrollTargetEntryId = ref("");
const scrollTargetPosition = ref<EntryScrollPosition>("nearest");
const scrollRequestId = ref(0);

const currentFile = computed(() =>
  props.project.files.find((file) => file.id === props.fileId),
);
const selectedEffectiveEntry = computed(() =>
  selectedEntry.value
    ? {
        ...selectedEntry.value,
        locked:
          selectedEntry.value.locked || currentFile.value?.locked === true,
        hidden:
          selectedEntry.value.hidden || currentFile.value?.hidden === true,
      }
    : undefined,
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

const totalEntryPages = computed(() =>
  Math.max(1, Math.ceil(filteredEntries.value.length / entryPageSize.value)),
);
const selectedIndex = computed(() => {
  if (!selectedEntry.value) {
    return -1;
  }

  return filteredEntries.value.findIndex(
    (entry) => entry.id === selectedEntry.value?.id,
  );
});
const pageStartIndex = computed(
  () => (currentEntryPage.value - 1) * entryPageSize.value,
);
const pagedEntries = computed(() =>
  filteredEntries.value.slice(
    pageStartIndex.value,
    pageStartIndex.value + entryPageSize.value,
  ),
);
const pageStart = computed(() =>
  filteredEntries.value.length === 0 ? 0 : pageStartIndex.value + 1,
);
const pageEnd = computed(() =>
  Math.min(
    filteredEntries.value.length,
    pageStartIndex.value + pagedEntries.value.length,
  ),
);
const canGoPrevious = computed(() => selectedIndex.value > 0);
const canGoNext = computed(
  () => selectedIndex.value >= 0 && selectedIndex.value < filteredEntries.value.length - 1,
);
const entryCountLabel = computed(() => {
  const isFiltered = statusFilter.value !== "all" || Boolean(searchText.value.trim());

  return isFiltered
    ? `匹配 ${filteredEntries.value.length} 条 / 共 ${entries.value.length} 条`
    : `共 ${entries.value.length} 条`;
});
const currentUser = computed(() => getCurrentUser());
const hasUnsavedTranslation = computed(
  () =>
    Boolean(selectedEntry.value) &&
    draftTarget.value !== selectedEntry.value?.target,
);

useAppDraft("译文", hasUnsavedTranslation);

function getSaveEntryOptions() {
  return {
    actor: currentUser.value,
    workflow: props.project.settings.workflow,
  };
}

function getRequestedEntry(loadedEntries: Entry[]): Entry | undefined {
  if (props.targetEntryId) {
    return loadedEntries.find((entry) => entry.id === props.targetEntryId);
  }

  if (props.targetEntryIndex && props.targetEntryIndex > 0) {
    return loadedEntries.find((entry) => entry.index === props.targetEntryIndex);
  }

  return undefined;
}

function getInitialEntry(loadedEntries: Entry[]): Entry | undefined {
  const requestedEntry = getRequestedEntry(loadedEntries);

  if (requestedEntry) {
    return requestedEntry;
  }

  if (props.lastViewedEntryId) {
    return loadedEntries.find((entry) => entry.id === props.lastViewedEntryId);
  }

  return loadedEntries[0];
}

function getEntryIndex(entry: Entry | undefined): number {
  if (!entry) {
    return -1;
  }

  return filteredEntries.value.findIndex((item) => item.id === entry.id);
}

function getEntryPage(entry: Entry | undefined): number {
  const index = getEntryIndex(entry);

  return index < 0 ? -1 : Math.floor(index / entryPageSize.value) + 1;
}

function requestEntryScroll(
  entry: Entry | undefined,
  position: EntryScrollPosition,
) {
  if (!entry && position !== "top") {
    return;
  }

  scrollTargetEntryId.value = entry?.id ?? "";
  scrollTargetPosition.value = position;
  scrollRequestId.value += 1;
}

function rememberViewedEntry(entry: Entry | undefined) {
  if (entry) {
    emit("entryViewed", props.fileId, entry.id);
  }
}

function setSelectedEntry(
  entry: Entry | undefined,
  options: {
    ensurePage?: boolean;
    remember?: boolean;
    scrollPosition?: EntryScrollPosition;
  } = {},
) {
  selectedEntry.value = entry;
  draftTarget.value = entry?.target ?? "";

  const entryPage = getEntryPage(entry);

  if (options.ensurePage !== false && entryPage > 0) {
    currentEntryPage.value = entryPage;
  }

  if (options.scrollPosition) {
    requestEntryScroll(entry, options.scrollPosition);
  }

  if (options.remember !== false) {
    rememberViewedEntry(entry);
  }
}

function handleUpdatePage(page: number) {
  const nextPage = Math.min(
    totalEntryPages.value,
    Math.max(1, page),
  );

  if (nextPage === currentEntryPage.value) {
    return;
  }

  currentEntryPage.value = nextPage;
  requestEntryScroll(undefined, "top");
}

function handleUpdatePageSize(pageSize: number) {
  if (!ENTRY_PAGE_SIZE_OPTIONS.includes(pageSize as (typeof ENTRY_PAGE_SIZE_OPTIONS)[number])) {
    return;
  }

  entryPageSize.value = pageSize as (typeof ENTRY_PAGE_SIZE_OPTIONS)[number];
  const selectedPage = getEntryPage(selectedEntry.value);
  currentEntryPage.value = selectedPage > 0 ? selectedPage : 1;
  requestEntryScroll(selectedEntry.value, "nearest");
}

async function loadFileEntries() {
  isLoading.value = true;
  errorMessage.value = "";
  savedMessage.value = "";
  selectedEntry.value = undefined;
  draftTarget.value = "";
  currentEntryPage.value = 1;

  try {
    const loadedEntries = await loadEntries(props.fileId);
    entries.value = loadedEntries;
    setSelectedEntry(getInitialEntry(entries.value), {
      scrollPosition: "second",
    });
    if (props.targetAssistTab) {
      assistTab.value = props.targetAssistTab;
    }
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

function handleSelectEntry(
  entry: Entry,
  scrollPosition?: EntryScrollPosition,
) {
  setSelectedEntry(entry, { scrollPosition });
  savedMessage.value = "";
}

function replaceEntry(savedEntry: Entry) {
  entries.value = entries.value.map((entry) =>
    entry.id === savedEntry.id ? savedEntry : entry,
  );
  setSelectedEntry(savedEntry, { ensurePage: false, remember: false });
}

function selectEntryByOffset(offset: -1 | 1) {
  const nextEntry = filteredEntries.value[selectedIndex.value + offset];

  if (nextEntry) {
    handleSelectEntry(nextEntry, "nearest");
  }
}

async function handleSaveEntry(entry: Entry) {
  isSaving.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const savedEntry = await saveEntry(entry, getSaveEntryOptions());

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
    const savedEntry = await saveEntry(entry, getSaveEntryOptions());

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

async function handleToggleEntryLocked(entry: Entry) {
  isSaving.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const updatedEntry = await updateEntryAccess(entry.id, {
      locked: !entry.locked,
    });

    replaceEntry(updatedEntry);
    savedMessage.value = updatedEntry.locked ? "词条已锁定。" : "词条已解锁。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "更新词条锁定状态失败。";
  } finally {
    isSaving.value = false;
  }
}

async function handleToggleEntryHidden(entry: Entry) {
  isSaving.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const updatedEntry = await updateEntryAccess(entry.id, {
      hidden: !entry.hidden,
    });

    replaceEntry(updatedEntry);
    savedMessage.value = updatedEntry.hidden ? "词条已隐藏。" : "词条已取消隐藏。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "更新词条隐藏状态失败。";
  } finally {
    isSaving.value = false;
  }
}

async function handleSaveAndNext(entry: Entry) {
  isSaving.value = true;
  errorMessage.value = "";
  savedMessage.value = "";

  try {
    const savedEntry = await saveEntry(entry, getSaveEntryOptions());
    const nextEntry = filteredEntries.value[selectedIndex.value + 1];

    replaceEntry(savedEntry);

    if (nextEntry) {
      handleSelectEntry(nextEntry, "nearest");
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

watch(
  () => [props.targetEntryId, props.targetEntryIndex],
  () => {
    const requestedEntry = getRequestedEntry(entries.value);

    if (requestedEntry) {
      setSelectedEntry(requestedEntry, { scrollPosition: "second" });
    }
  },
);

watch(
  () => props.lastViewedEntryId,
  () => {
    if (selectedEntry.value || props.targetEntryId || props.targetEntryIndex) {
      return;
    }

    const lastViewedEntry = entries.value.find(
      (entry) => entry.id === props.lastViewedEntryId,
    );

    if (lastViewedEntry) {
      setSelectedEntry(lastViewedEntry, { scrollPosition: "second" });
    }
  },
);

watch(
  () => [props.targetAssistTab, props.targetCommentId],
  () => {
    if (props.targetAssistTab) {
      assistTab.value = props.targetAssistTab;
    }
  },
  { immediate: true },
);

watch(filteredEntries, (nextEntries) => {
  if (
    selectedEntry.value &&
    nextEntries.some((entry) => entry.id === selectedEntry.value?.id)
  ) {
    return;
  }

  setSelectedEntry(nextEntries[0], { scrollPosition: "nearest" });
});

watch(totalEntryPages, () => {
  currentEntryPage.value = Math.min(
    totalEntryPages.value,
    Math.max(1, currentEntryPage.value),
  );
});

onMounted(loadFileEntries);
</script>

<template>
  <section class="entry-page">
    <ProjectPageHeader
      eyebrow="文件词条"
      :title="currentFile?.name || fileId"
      summary="编辑当前文件的译文、状态、批注、术语和上下文。"
    >
      <template #actions>
        <p class="entry-count">{{ entryCountLabel }}</p>
      </template>
    </ProjectPageHeader>

    <div class="entry-page-body">
      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
      <p v-if="savedMessage" class="saved-message">{{ savedMessage }}</p>
      <p v-if="isLoading" class="empty-state">正在加载词条...</p>

      <section v-else-if="entries.length > 0" class="entry-workspace">
        <EntrySideList
          :entries="pagedEntries"
          :selected-entry-id="selectedEntry?.id"
          :search-text="searchText"
          :status-filter="statusFilter"
          :total-count="entries.length"
          :filtered-count="filteredEntries.length"
          :page="currentEntryPage"
          :page-size="entryPageSize"
          :page-size-options="ENTRY_PAGE_SIZE_OPTIONS"
          :total-pages="totalEntryPages"
          :page-start="pageStart"
          :page-end="pageEnd"
          :scroll-target-entry-id="scrollTargetEntryId"
          :scroll-target-position="scrollTargetPosition"
          :scroll-request-id="scrollRequestId"
          :workflow="project.settings.workflow"
          :file-locked="currentFile?.locked"
          :file-hidden="currentFile?.hidden"
          @select="handleSelectEntry"
          @update-search-text="searchText = $event"
          @update-status-filter="statusFilter = $event"
          @update-page="handleUpdatePage"
          @update-page-size="handleUpdatePageSize"
        />

        <EntryEditor
          :entry="selectedEntry"
          :file-name="currentFile?.name || fileId"
          :is-saving="isSaving"
          :can-go-previous="canGoPrevious"
          :can-go-next="canGoNext"
          :workflow="project.settings.workflow"
          :file-locked="currentFile?.locked"
          :file-hidden="currentFile?.hidden"
          @save="handleSaveEntry"
          @save-next="handleSaveAndNext"
          @previous="selectEntryByOffset(-1)"
          @next="selectEntryByOffset(1)"
          @draft-target-changed="draftTarget = $event"
          @workflow-status="handleWorkflowStatus"
          @mark-disputed="handleMarkDisputed"
          @resolve-dispute="handleResolveDispute"
          @toggle-locked="handleToggleEntryLocked"
          @toggle-hidden="handleToggleEntryHidden"
          @open-context="handleOpenContext"
        />

        <EntryAssistPanel
          :entry="selectedEffectiveEntry"
          :members="members ?? []"
          :draft-target="draftTarget"
          :active-tab="assistTab"
          :highlight-comment-id="targetCommentId"
          @entry-updated="handleEntryUpdated"
          @update-active-tab="assistTab = $event"
          @view-entry-comment="emit('openCommentTarget', $event)"
        />
      </section>

      <p v-else-if="!errorMessage" class="empty-state">
        这个文件还没有可编辑的词条。
      </p>
    </div>
  </section>
</template>

<style scoped>
.entry-page {
  display: grid;
  gap: 16px;
}

p {
  margin: 0;
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

.entry-page-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  min-height: 0;
}

.entry-workspace {
  display: grid;
  grid-template-columns:
    minmax(300px, 0.82fr)
    minmax(340px, 1.34fr)
    minmax(250px, 0.84fr);
  gap: 14px;
  min-width: 0;
  height: calc(100vh - 196px);
  min-height: 0;
  overflow-x: clip;
  overflow-y: hidden;
}

.entry-workspace > * {
  min-width: 0;
}

@media (max-width: 1180px) {
  .entry-page {
    min-height: 0;
  }

  .entry-page-body {
    min-height: 0;
  }

  .entry-workspace {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 0;
    overflow: visible;
  }
}
</style>
