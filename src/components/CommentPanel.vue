<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import CommentEditor from "./CommentEditor.vue";
import CommentListItem from "./CommentListItem.vue";
import type { Comment, Entry } from "../model/types";
import {
  addComment,
  deleteComment,
  loadComments,
  markDisputed,
  reopenComment,
  replyComment,
  resolveComment,
} from "../services/comments";
import {
  canCreateComment,
  canDeleteComment,
  canMarkDisputed,
  canReopenComment,
  canReplyComment,
  canResolveComment,
  canViewComment,
  getCurrentUser,
} from "../services/permissions";

const props = defineProps<{
  entry?: Entry;
  highlightCommentId?: string;
}>();

const emit = defineEmits<{
  entryUpdated: [entry: Entry];
  viewEntryComment: [comment: Comment];
}>();

const comments = ref<Comment[]>([]);
const newComment = ref("");
const replyText = ref("");
const replyingTo = ref<Comment>();
const disputeReason = ref("");
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
const canMarkEntryDisputed = computed(() =>
  canMarkDisputed(currentUser.value, props.entry),
);
const commentById = computed(
  () => new Map(comments.value.map((comment) => [comment.id, comment])),
);

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
      error instanceof Error ? error.message : "评论无法读取。";
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
    disputeReason.value = "";
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
    message.value = "评论已添加。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "评论添加失败。";
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
    message.value = "评论已解决。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "评论解决失败。";
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
    message.value = "评论已重新打开。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "评论重新打开失败。";
  } finally {
    isSaving.value = false;
  }
}

async function handleDeleteComment(comment: Comment) {
  if (!props.entry || !canDeleteComment(currentUser.value, comment)) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    await deleteComment(props.entry, comment.id);
    await refreshComments();
    message.value = "评论已删除。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "评论删除失败。";
  } finally {
    isSaving.value = false;
  }
}

async function handleMarkDisputed() {
  if (!props.entry) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const updatedEntry = await markDisputed(props.entry, disputeReason.value);

    disputeReason.value = "";
    await refreshComments();
    emit("entryUpdated", updatedEntry);
    message.value = "已标记为争议。";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "标记争议失败。";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <section class="comment-panel">
    <h3>当前词条评论</h3>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="message" class="message">{{ message }}</p>
    <p v-if="!canViewComments" class="empty-text">当前用户不能查看评论。</p>

    <CommentEditor
      v-if="canCreateComments"
      v-model="newComment"
      label="新增评论"
      placeholder="写下评论"
      submit-label="添加评论"
      :disabled="isSaving"
      @submit="handleAddComment"
    />

    <section v-if="replyingTo" class="reply-box">
      <p>回复 {{ replyingTo.user_id }}</p>
      <CommentEditor
        v-model="replyText"
        label="回复"
        placeholder="写下回复"
        submit-label="添加回复"
        :disabled="isSaving"
        @submit="handleReplyComment"
      />
      <button class="plain-button" type="button" :disabled="isSaving" @click="cancelReply">
        取消
      </button>
    </section>

    <div v-if="canMarkEntryDisputed" class="comment-form">
      <label>
        <span>争议原因</span>
        <textarea
          v-model="disputeReason"
          rows="3"
          placeholder="说明为什么需要讨论"
          :disabled="isSaving"
        />
      </label>
      <button type="button" :disabled="isSaving" @click="handleMarkDisputed">
        标记争议
      </button>
    </div>

    <p v-if="isLoading" class="empty-text">正在加载评论...</p>
    <p v-else-if="canViewComments && comments.length === 0" class="empty-text">
      暂无评论
    </p>

    <ul v-else-if="canViewComments" class="comment-list">
      <li v-for="comment in comments" :key="comment.id">
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
        />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.comment-panel {
  display: grid;
  gap: 14px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid #e5e7eb;
}

h3,
p {
  margin: 0;
}

h3 {
  font-size: 16px;
}

.comment-form,
.reply-box {
  display: grid;
  gap: 8px;
}

.reply-box {
  padding: 12px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #f8fafb;
}

label {
  display: grid;
  gap: 6px;
}

label span,
.empty-text {
  color: #5b6472;
  font-size: 13px;
}

textarea {
  width: 100%;
  resize: vertical;
  padding: 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  color: #1f2937;
  font: inherit;
  line-height: 1.6;
}

textarea:focus {
  outline: none;
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
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
