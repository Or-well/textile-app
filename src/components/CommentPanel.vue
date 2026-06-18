<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Comment, Entry } from "../model/types";
import {
  addComment,
  deleteComment,
  loadComments,
  markDisputed,
} from "../services/comments";
import { canMarkDisputed, getCurrentUser } from "../services/permissions";

const props = defineProps<{
  entry?: Entry;
}>();

const emit = defineEmits<{
  entryUpdated: [entry: Entry];
}>();

const comments = ref<Comment[]>([]);
const newComment = ref("");
const disputeReason = ref("");
const isLoading = ref(false);
const isSaving = ref(false);
const errorMessage = ref("");
const message = ref("");

const currentUser = computed(() => getCurrentUser());
const canMarkEntryDisputed = computed(() =>
  canMarkDisputed(currentUser.value, props.entry),
);

async function refreshComments() {
  if (!props.entry) {
    comments.value = [];
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    comments.value = await loadComments(props.entry);
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
    disputeReason.value = "";
    message.value = "";
    void refreshComments();
  },
  { immediate: true },
);

async function handleAddComment() {
  if (!props.entry) {
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

async function handleDeleteComment(commentId: string) {
  if (!props.entry) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    await deleteComment(props.entry, commentId);
    comments.value = comments.value.filter((comment) => comment.id !== commentId);
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
    <h3>评论与争议</h3>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-if="message" class="message">{{ message }}</p>

    <div class="comment-form">
      <label>
        <span>新增评论</span>
        <textarea
          v-model="newComment"
          rows="3"
          placeholder="写下评论"
          :disabled="isSaving"
        />
      </label>
      <button type="button" :disabled="isSaving" @click="handleAddComment">
        添加评论
      </button>
    </div>

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
    <p v-else-if="comments.length === 0" class="empty-text">暂无评论</p>

    <ul v-else class="comment-list">
      <li v-for="comment in comments" :key="comment.id" class="comment-item">
        <p class="comment-body">{{ comment.body }}</p>
        <div class="comment-meta">
          <span>{{ comment.user_id }}</span>
          <span>{{ comment.created_at }}</span>
          <button
            type="button"
            :disabled="isSaving"
            @click="handleDeleteComment(comment.id)"
          >
            删除
          </button>
        </div>
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

.comment-form {
  display: grid;
  gap: 8px;
}

label {
  display: grid;
  gap: 6px;
}

label span,
.comment-meta,
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

button {
  justify-self: start;
  min-height: 36px;
  padding: 0 13px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font-size: 14px;
  cursor: pointer;
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

.comment-item {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #eef1f5;
  border-radius: 6px;
  background: #f9fafb;
}

.comment-body {
  line-height: 1.6;
}

.comment-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
}

.error-message {
  color: #b42318;
}

.message {
  color: #166534;
}
</style>
