<script setup lang="ts">
import { computed, ref, watch } from "vue";
import CommentListItem from "../components/CommentListItem.vue";
import ProjectPageHeader from "../components/ProjectPageHeader.vue";
import {
  buildMemberOptions,
  getMemberDisplayName,
} from "../model/memberOptions";
import type { Comment, Entry, Member, ProjectConfig } from "../model/types";
import { loadAllComments } from "../services/comments";
import { loadAllEntries } from "../services/entries";
import { canViewComment, getCurrentUser } from "../services/permissions";
import { compareInstants } from "../utils/time";

type CommentFilter = "all" | "recent" | "open" | "resolved" | "disputed";
type CommentSortOrder = "newest" | "oldest";

interface CommentRow {
  comment: Comment;
  entry?: Entry;
}

const props = withDefaults(
  defineProps<{
    project?: ProjectConfig;
    members?: Member[];
  }>(),
  {
    members: () => [],
  },
);

const emit = defineEmits<{
  openCommentTarget: [comment: Comment];
}>();

const comments = ref<Comment[]>([]);
const entries = ref<Entry[]>([]);
const activeFilter = ref<CommentFilter>("all");
const selectedFileId = ref("all");
const selectedMemberId = ref("all");
const commentSortOrder = ref<CommentSortOrder>("newest");
const keyword = ref("");
const isLoading = ref(false);
const errorMessage = ref("");

const currentUser = computed(() => getCurrentUser());
const canViewComments = computed(() => canViewComment(currentUser.value));
const memberFilterOptions = computed(() =>
  buildMemberOptions(
    props.members,
    comments.value.map((comment) => comment.user_id),
  ),
);
const entryById = computed(
  () => new Map(entries.value.map((entry) => [entry.id, entry])),
);
const parentCommentById = computed(
  () => new Map(comments.value.map((comment) => [comment.id, comment])),
);
const rows = computed<CommentRow[]>(() =>
  comments.value.map((comment) => ({
    comment,
    entry: entryById.value.get(comment.entry_id),
  })),
);

const visibleRows = computed(() => {
  const searchText = keyword.value.trim().toLowerCase();
  const filteredRows = rows.value.filter(({ comment, entry }) => {
    const fileId = comment.file_id || entry?.file_id || "";

    if (selectedFileId.value !== "all" && fileId !== selectedFileId.value) {
      return false;
    }

    if (
      selectedMemberId.value !== "all" &&
      comment.user_id !== selectedMemberId.value
    ) {
      return false;
    }

    if (activeFilter.value === "open" && comment.status === "resolved") {
      return false;
    }

    if (activeFilter.value === "resolved" && comment.status !== "resolved") {
      return false;
    }

    if (
      activeFilter.value === "disputed" &&
      !comment.disputed &&
      entry?.disputed !== true
    ) {
      return false;
    }

    if (!searchText) {
      return true;
    }

    return [
      comment.body,
      comment.user_id,
      getMemberName(comment.user_id),
      getFileName(fileId),
      entry?.source,
      entry?.target,
    ]
      .join(" ")
      .toLowerCase()
      .includes(searchText);
  });

  const rowsForDisplay =
    activeFilter.value === "recent"
      ? [...filteredRows].sort(compareCommentRowsByNewest).slice(0, 30)
      : filteredRows;
  const sortedRows = [...rowsForDisplay].sort(compareCommentRowsBySortOrder);

  return sortedRows;
});

const filterTabs: Array<{ id: CommentFilter; label: string }> = [
  { id: "all", label: "全部批注" },
  { id: "recent", label: "最近批注" },
  { id: "open", label: "讨论中" },
  { id: "resolved", label: "已解决" },
  { id: "disputed", label: "有争议" },
];

function getFileName(fileId: string): string {
  return props.project?.files.find((file) => file.id === fileId)?.name || fileId;
}

function getMemberName(memberId: string): string {
  return getMemberDisplayName(props.members, memberId);
}

function compareCommentRowsBySortOrder(
  left: CommentRow,
  right: CommentRow,
): number {
  const direction = commentSortOrder.value === "newest" ? -1 : 1;

  return compareCommentRowsByTime(left, right) * direction;
}

function compareCommentRowsByNewest(
  left: CommentRow,
  right: CommentRow,
): number {
  return compareCommentRowsByTime(left, right) * -1;
}

function compareCommentRowsByTime(left: CommentRow, right: CommentRow): number {
  const leftComment = left.comment;
  const rightComment = right.comment;

  return (
    compareInstants(
      leftComment.created_at || leftComment.updated_at,
      rightComment.created_at || rightComment.updated_at,
    ) || leftComment.id.localeCompare(rightComment.id)
  );
}

async function refreshComments() {
  if (!props.project || !canViewComments.value) {
    comments.value = [];
    entries.value = [];
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    const [loadedEntries, loadedComments] = await Promise.all([
      loadAllEntries(),
      loadAllComments(),
    ]);

    entries.value = loadedEntries;
    comments.value = loadedComments;
  } catch (error) {
    comments.value = [];
    entries.value = [];
    errorMessage.value =
      error instanceof Error ? error.message : "批注列表加载失败。";
  } finally {
    isLoading.value = false;
  }
}

function handleViewEntry(comment: Comment) {
  emit("openCommentTarget", comment);
}

watch(
  () => props.project?.project_id,
  () => {
    selectedFileId.value = "all";
    selectedMemberId.value = "all";
    commentSortOrder.value = "newest";
    keyword.value = "";
    void refreshComments();
  },
  { immediate: true },
);
</script>

<template>
  <main class="comments-page">
    <ProjectPageHeader
      eyebrow="批注协作"
      title="批注"
      summary="查看词条讨论、争议记录和成员协作反馈。"
    >
      <template #actions>
        <p class="comment-count">{{ visibleRows.length }} / {{ comments.length }} 条</p>
      </template>
    </ProjectPageHeader>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="!canViewComments" class="empty-state">当前用户不能查看批注。</p>

    <section v-if="project && canViewComments" class="comment-toolbar">
      <div class="filter-tabs" role="tablist" aria-label="批注筛选">
        <button
          v-for="tab in filterTabs"
          :key="tab.id"
          class="filter-tab"
          :class="{ active: activeFilter === tab.id }"
          type="button"
          @click="activeFilter = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="filter-controls">
        <label>
          <span>按文件筛选</span>
          <select v-model="selectedFileId">
            <option value="all">全部文件</option>
            <option v-for="file in project.files" :key="file.id" :value="file.id">
              {{ file.name }}
            </option>
          </select>
        </label>

        <label>
          <span>按成员筛选</span>
          <select v-model="selectedMemberId">
            <option value="all">全部成员</option>
            <option
              v-for="member in memberFilterOptions"
              :key="member.id"
              :value="member.id"
            >
              {{ member.label }}
            </option>
          </select>
        </label>

        <label>
          <span>显示顺序</span>
          <select v-model="commentSortOrder">
            <option value="newest">由新到旧</option>
            <option value="oldest">由旧到新</option>
          </select>
        </label>

        <label class="search-field">
          <span>关键词搜索</span>
          <input v-model="keyword" type="search" placeholder="搜索批注、词条或成员" />
        </label>
      </div>
    </section>

    <p v-if="isLoading" class="empty-state">正在加载批注...</p>
    <p v-else-if="project && canViewComments && visibleRows.length === 0" class="empty-state">
      暂无符合条件的批注
    </p>

    <ul v-else-if="project && canViewComments" class="comment-list">
      <li v-for="{ comment, entry } in visibleRows" :key="comment.id">
        <CommentListItem
          :comment="comment"
          :members="members"
          :entry="entry"
          :file-name="getFileName(comment.file_id || entry?.file_id || '')"
          :parent-comment="
            comment.reply_to ? parentCommentById.get(comment.reply_to) : undefined
          "
          :can-reply="false"
          :can-resolve="false"
          :can-reopen="false"
          :can-delete="false"
          @view-entry="handleViewEntry"
        />
      </li>
    </ul>

    <p v-else-if="!project" class="empty-state">请先打开项目。</p>
  </main>
</template>

<style scoped>
.comments-page {
  display: grid;
  gap: 16px;
}

p {
  margin: 0;
}

.comment-count {
  padding: 5px 10px;
  border-radius: 999px;
  background: #e6f0ef;
  color: #174346;
  font-size: 13px;
  font-weight: 700;
}

.comment-toolbar {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.filter-tabs,
.filter-controls {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 8px;
}

.filter-tab {
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #4b5563;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.filter-tab.active {
  border-color: #2f6f73;
  background: #e6f0ef;
  color: #174346;
  font-weight: 700;
}

label {
  display: grid;
  gap: 5px;
}

label span {
  color: #5b6472;
  font-size: 13px;
}

select,
input {
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  font-size: 14px;
}

.search-field {
  min-width: min(320px, 100%);
  flex: 1;
}

.comment-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.empty-state {
  padding: 18px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #4b5563;
  line-height: 1.7;
}

.error-message {
  color: #b42318;
  line-height: 1.7;
}

@media (max-width: 760px) {
  .filter-controls {
    display: grid;
  }
}
</style>
