<script setup lang="ts">
import { computed } from "vue";
import { getMemberDisplayName } from "../model/memberOptions";
import type { Comment, Entry, Member } from "../model/types";
import { formatDateTime } from "../utils/time";

const props = withDefaults(
  defineProps<{
    comment: Comment;
    members?: Member[];
    entry?: Entry;
    fileName?: string;
    parentComment?: Comment;
    highlighted?: boolean;
    canReply?: boolean;
    canResolve?: boolean;
    canReopen?: boolean;
    canDelete?: boolean;
    isBusy?: boolean;
    showViewEntry?: boolean;
  }>(),
  {
    members: () => [],
    fileName: "",
    highlighted: false,
    canReply: false,
    canResolve: false,
    canReopen: false,
    canDelete: false,
    isBusy: false,
    showViewEntry: true,
  },
);

const commentAuthorName = computed(() =>
  getMemberDisplayName(props.members, props.comment.user_id, {
    emptyLabel: "未知成员",
  }),
);
const parentAuthorName = computed(() =>
  getMemberDisplayName(props.members, props.parentComment?.user_id ?? "", {
    emptyLabel: "未知成员",
  }),
);

const emit = defineEmits<{
  reply: [comment: Comment];
  resolve: [comment: Comment];
  reopen: [comment: Comment];
  delete: [comment: Comment];
  viewEntry: [comment: Comment];
}>();
</script>

<template>
  <article
    class="comment-item"
    :class="{ highlighted: props.highlighted, resolved: props.comment.status === 'resolved' }"
    :id="`comment-${props.comment.id}`"
  >
    <header class="comment-header">
      <div class="comment-title">
        <strong :title="props.comment.user_id || undefined">
          {{ commentAuthorName }}
        </strong>
        <span v-if="props.fileName || props.entry">
          {{ props.fileName || props.comment.file_id }}
          <template v-if="props.entry"> #{{ props.entry.index }}</template>
        </span>
      </div>
      <div class="comment-badges">
        <span class="status-badge">
          {{ props.comment.status === "resolved" ? "已解决" : "讨论中" }}
        </span>
        <span v-if="props.comment.disputed" class="dispute-badge">有争议</span>
      </div>
    </header>

    <p v-if="props.parentComment" class="reply-context">
      回复 {{ parentAuthorName }}：{{ props.parentComment.body }}
    </p>

    <p class="comment-body">{{ props.comment.body }}</p>

    <footer class="comment-footer">
      <span>
        {{ formatDateTime(props.comment.updated_at || props.comment.created_at) || "时间无效" }}
      </span>
      <div class="comment-actions">
        <button
          v-if="props.showViewEntry"
          type="button"
          :disabled="props.isBusy"
          @click="emit('viewEntry', props.comment)"
        >
          查看词条
        </button>
        <button
          v-if="props.canReply"
          type="button"
          :disabled="props.isBusy"
          @click.stop="emit('reply', props.comment)"
        >
          回复
        </button>
        <button
          v-if="props.canResolve && props.comment.status !== 'resolved'"
          type="button"
          :disabled="props.isBusy"
          @click="emit('resolve', props.comment)"
        >
          解决
        </button>
        <button
          v-if="props.canReopen && props.comment.status === 'resolved'"
          type="button"
          :disabled="props.isBusy"
          @click="emit('reopen', props.comment)"
        >
          重新打开
        </button>
        <button
          v-if="props.canDelete"
          class="danger-button"
          type="button"
          :disabled="props.isBusy"
          @click="emit('delete', props.comment)"
        >
          删除
        </button>
      </div>
    </footer>

    <slot name="reply-editor" />
  </article>
</template>

<style scoped>
.comment-item {
  display: grid;
  gap: 9px;
  padding: 12px;
  border: 1px solid #e3e8ef;
  border-radius: 8px;
  background: #ffffff;
}

.comment-item.highlighted {
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

.comment-item.resolved {
  background: #f8fafb;
}

.comment-header,
.comment-footer,
.comment-actions,
.comment-badges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.comment-header,
.comment-footer {
  justify-content: space-between;
}

.comment-title {
  display: grid;
  gap: 3px;
}

strong,
p {
  margin: 0;
}

strong {
  color: #111827;
  font-size: 14px;
}

.comment-title span,
.comment-footer,
.reply-context {
  color: #5b6472;
  font-size: 13px;
}

.comment-body {
  color: #1f2937;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.reply-context {
  padding-left: 8px;
  border-left: 3px solid #d7dde5;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge,
.dispute-badge {
  padding: 2px 7px;
  border-radius: 999px;
  background: #e6f0ef;
  color: #174346;
  font-size: 12px;
  font-weight: 700;
}

.dispute-badge {
  background: #fff7ed;
  color: #9a3412;
}

button {
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #2f6f73;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.danger-button {
  color: #b42318;
}

button:disabled {
  cursor: wait;
  opacity: 0.62;
}
</style>
