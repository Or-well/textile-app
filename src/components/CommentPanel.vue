<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useAppDraft } from "../composables/useAppDraft";
import CommentEditor from "./CommentEditor.vue";
import CommentListItem from "./CommentListItem.vue";
import type { Comment, Entry } from "../model/types";
import {
  addComment,
  deleteComment,
  getCommentDeletionSet,
  loadComments,
  reopenComment,
  replyComment,
  resolveComment,
} from "../services/comments";
import {
  canCreateComment,
  canDeleteComment,
  canReopenComment,
  canReplyComment,
  canResolveComment,
  canViewComment,
  getCurrentUser,
} from "../services/permissions";
import { compareInstants } from "../utils/time";

type CommentSortOrder = "newest" | "oldest";

const props = defineProps<{
  entry?: Entry;
  highlightCommentId?: string;
}>();

const emit = defineEmits<{
  viewEntryComment: [comment: Comment];
}>();

const comments = ref<Comment[]>([]);
const newComment = ref("");
const replyText = ref("");
const replyingTo = ref<Comment>();
const commentSortOrder = ref<CommentSortOrder>("newest");
const isLoading = ref(false);
const isSaving = ref(false);
const errorMessage = ref("");
const message = ref("");

const currentUser = computed(() => getCurrentUser());
const canViewComments = computed(() => canViewComment(currentUser.value));
const canCreateComments = computed(() => canCreateComment(currentUser.value));
const canReplyComments = computed(() => canReplyComment(currentUser.value));
const canResolveComments = computed(() => canResolveComment(currentUser.value));
const canReopenComments = computed(() => canReopenComment(currentUser.value));
const commentById = computed(
  () => new Map(comments.value.map((comment) => [comment.id, comment])),
);
const hasUnsavedComment = computed(
  () =>
    Boolean(newComment.value.trim()) ||
    Boolean(replyText.value.trim()),
);
const displayedComments = computed(() =>
  [...comments.value].sort(compareCommentsBySortOrder),
);

useAppDraft("批注或回复", hasUnsavedComment);

function compareCommentsBySortOrder(left: Comment, right: Comment): number {
  const direction = commentSortOrder.value === "newest" ? -1 : 1;
  const timeCompare =
    compareInstants(
      left.created_at || left.updated_at,
      right.created_at || right.updated_at,
    ) ||
    left.id.localeCompare(right.id);

  return timeCompare * direction;
}

async function focusHighlightedComment() {
  if (!props.highlightCommentId || typeof document === "undefined") {
    return;
  }

  await nextTick();

  document
    .getElementById(`comment-${props.highlightCommentId}`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}

async function refreshComments() {
  if (!props.entry || !canViewComments.value) {
    comments.value = [];
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    comments.value = await loadComments(props.entry);
    await focusHighlightedComment();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "批注无法读取。";
  } finally {
    isLoading.value = false;
  }
}

watch(
  () => props.entry?.id,
  () => {
    newComment.value = "";
    replyText.value = "";
    replyingTo.value = undefined;
    message.value = "";
    void refreshComments();
  },
  { immediate: true },
);

watch(
  () => props.highlightCommentId,
  () => {
    void focusHighlightedComment();
  },
);

async function handleAddComment() {
  if (!props.entry || !canCreateComments.value) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const comment = await addComment(props.entry, newComment.value);

    comments.value = [...comments.value, comment];
    newComment.value = "";
    message.value = "批注已添加。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "批注添加失败。";
  } finally {
    isSaving.value = false;
  }
}

function startReply(comment: Comment) {
  replyingTo.value = comment;
  replyText.value = "";
  message.value = "";
}

function cancelReply() {
  replyingTo.value = undefined;
  replyText.value = "";
}

function collapseEmptyReply() {
  if (replyingTo.value && !replyText.value.trim()) {
    cancelReply();
  }
}

async function handleReplyComment() {
  if (!props.entry || !replyingTo.value || !canReplyComments.value) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const comment = await replyComment(
      props.entry,
      replyingTo.value.id,
      replyText.value,
    );

    comments.value = [...comments.value, comment];
    cancelReply();
    message.value = "回复已添加。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "回复添加失败。";
  } finally {
    isSaving.value = false;
  }
}

async function handleResolveComment(comment: Comment) {
  if (!props.entry || !canResolveComments.value) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const updatedComment = await resolveComment(props.entry, comment.id);

    comments.value = comments.value.map((item) =>
      item.id === updatedComment.id ? updatedComment : item,
    );
    message.value = "批注已解决。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "批注解决失败。";
  } finally {
    isSaving.value = false;
  }
}

async function handleReopenComment(comment: Comment) {
  if (!props.entry || !canReopenComments.value) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const updatedComment = await reopenComment(props.entry, comment.id);

    comments.value = comments.value.map((item) =>
      item.id === updatedComment.id ? updatedComment : item,
    );
    message.value = "批注已重新打开。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "批注重新打开失败。";
  } finally {
    isSaving.value = false;
  }
}

async function handleDeleteComment(comment: Comment) {
  if (!props.entry || !canDeleteComment(currentUser.value, comment)) {
    return;
  }

  const commentsToDelete = getCommentDeletionSet(comments.value, comment.id);
  const unauthorizedReply = commentsToDelete.some(
    (item) => !canDeleteComment(currentUser.value, item),
  );

  if (unauthorizedReply) {
    errorMessage.value =
      "这条批注包含其他成员的回复，当前成员没有删除整组批注的权限。";
    return;
  }

  const replyCount = Math.max(0, commentsToDelete.length - 1);
  const confirmed = window.confirm(
    replyCount > 0
      ? `删除后将同时删除 ${replyCount} 条回复，且只能从备份或修改包恢复。确认继续？`
      : "删除后只能从备份或修改包恢复。确认删除这条批注？",
  );

  if (!confirmed) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    await deleteComment(props.entry, comment.id);
    await refreshComments();
    message.value = "批注已删除。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "批注删除失败。";
  } finally {
    isSaving.value = false;
  }
}

</script>

<template>
  <section class="comment-panel" @click="collapseEmptyReply">
    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="message" class="message">{{ message }}</p>
    <p v-if="!canViewComments" class="empty-text">当前用户不能查看批注。</p>

    <CommentEditor
      v-if="canCreateComments"
      v-model="newComment"
      label="新增批注"
      placeholder="写下批注"
      submit-label="添加批注"
      :disabled="isSaving"
      @submit="handleAddComment"
    />

    <div v-if="canViewComments" class="comment-toolbar">
      <span>{{ comments.length }} 条批注</span>
      <label>
        <span>显示顺序</span>
        <select v-model="commentSortOrder">
          <option value="newest">由新到旧</option>
          <option value="oldest">由旧到新</option>
        </select>
      </label>
    </div>

    <p v-if="isLoading" class="empty-text">正在加载批注...</p>
    <p v-else-if="canViewComments && comments.length === 0" class="empty-text">
      暂无批注
    </p>

    <ul v-else-if="canViewComments" class="comment-list">
      <li v-for="comment in displayedComments" :key="comment.id">
        <CommentListItem
          :comment="comment"
          :entry="entry"
          :parent-comment="
            comment.reply_to ? commentById.get(comment.reply_to) : undefined
          "
          :highlighted="comment.id === highlightCommentId"
          :can-reply="canReplyComments"
          :can-resolve="canResolveComments"
          :can-reopen="canReopenComments"
          :can-delete="canDeleteComment(currentUser, comment)"
          :is-busy="isSaving"
          @view-entry="emit('viewEntryComment', $event)"
          @reply="startReply"
          @resolve="handleResolveComment"
          @reopen="handleReopenComment"
          @delete="handleDeleteComment"
        >
          <template v-if="replyingTo?.id === comment.id" #reply-editor>
            <section class="reply-box" @click.stop>
              <p>回复 {{ replyingTo.user_id }}</p>
              <CommentEditor
                v-model="replyText"
                label="回复"
                placeholder="写下回复"
                submit-label="添加回复"
                :disabled="isSaving"
                @submit="handleReplyComment"
              />
              <button
                class="plain-button"
                type="button"
                :disabled="isSaving"
                @click="cancelReply"
              >
                取消
              </button>
            </section>
          </template>
        </CommentListItem>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.comment-panel {
  display: grid;
  gap: 14px;
}

p {
  margin: 0;
}

.reply-box {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #f8fafb;
}

.comment-toolbar {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.comment-toolbar > span {
  color: #5b6472;
  font-size: 13px;
}

.comment-toolbar label {
  display: grid;
  gap: 6px;
}

.comment-toolbar label span,
.empty-text {
  color: #5b6472;
  font-size: 13px;
}

select {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  font-size: 14px;
}

button {
  justify-self: start;
  min-height: 36px;
  padding: 0 13px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.plain-button {
  color: #4b5563;
}

button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.comment-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.error-message {
  color: #b42318;
}

.message {
  color: #166534;
}
</style>
