<script setup lang="ts">
import type { Term } from "../model/types";

defineProps<{
  term: Term;
  canEdit?: boolean;
  canDelete?: boolean;
  showWarning?: boolean;
  compact?: boolean;
}>();

const emit = defineEmits<{
  edit: [term: Term];
  delete: [term: Term];
}>();
</script>

<template>
  <article class="term-list-item" :class="{ compact }">
    <div class="term-main">
      <strong class="term-source">{{ term.source }}</strong>
      <strong class="term-target">{{ term.target }}</strong>
    </div>

    <div class="term-meta-line">
      <span>{{ term.part_of_speech || "未填写词性" }}</span>
      <span v-if="term.case_sensitive">大小写敏感</span>
      <span v-if="term.created_at">创建于 {{ term.created_at }}</span>
      <span v-if="term.updated_at">更新于 {{ term.updated_at }}</span>
    </div>

    <p v-if="term.note" class="term-note">说明：{{ term.note }}</p>

    <div v-if="term.variants.length > 0" class="variant-list">
      <span class="variant-label">变体：</span>
      <span v-for="variant in term.variants" :key="variant" class="variant-tag">
        {{ variant }}
      </span>
    </div>

    <p v-if="showWarning" class="term-warning">
      译文中未使用推荐译名
    </p>

    <footer v-if="canEdit || canDelete" class="item-actions">
      <button
        v-if="canEdit"
        type="button"
        @click="emit('edit', term)"
      >
        编辑
      </button>
      <button
        v-if="canDelete"
        class="danger-button"
        type="button"
        @click="emit('delete', term)"
      >
        删除
      </button>
    </footer>
  </article>
</template>

<style scoped>
.term-list-item {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #d7dde5;
  border-radius: 6px;
  background: #ffffff;
}

.term-list-item.compact {
  padding: 10px;
}

.term-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  align-items: baseline;
}

.term-source,
.term-target {
  overflow-wrap: anywhere;
  color: #111827;
  font-size: 16px;
  line-height: 1.35;
}

.term-target {
  color: #166534;
}

.term-meta-line,
.variant-list,
.item-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
}

.term-meta-line {
  color: #5b6472;
  font-size: 13px;
}

.term-note,
.term-warning {
  margin: 0;
  line-height: 1.6;
  font-size: 13px;
}

.term-note {
  color: #4b5563;
}

.term-warning {
  color: #b45309;
}

.variant-label {
  color: #5b6472;
  font-size: 13px;
}

.variant-tag {
  padding: 2px 7px;
  border-radius: 999px;
  background: #f3f5f7;
  color: #4b5563;
  font-size: 12px;
}

.item-actions {
  padding-top: 2px;
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
  border-color: #f0b8aa;
  color: #b42318;
}

@media (max-width: 560px) {
  .term-main {
    grid-template-columns: 1fr;
  }
}
</style>
