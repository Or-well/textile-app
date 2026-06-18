<script setup lang="ts">
import { computed } from "vue";
import type { Term } from "../model/types";
import { canManageTerm, getCurrentUser } from "../services/permissions";
import type { TermUsageResult } from "../services/terms";

const props = defineProps<{
  terms: TermUsageResult[];
  sourceText: string;
}>();

const emit = defineEmits<{
  requestAddTerm: [sourceText: string];
  requestEditTerm: [term: Term];
}>();

const currentUser = computed(() => getCurrentUser());
const canManageTerms = computed(() => canManageTerm(currentUser.value));
</script>

<template>
  <section class="term-hint">
    <div class="hint-header">
      <h3>术语提示</h3>
      <button
        v-if="canManageTerms && terms.length === 0 && sourceText"
        class="text-button"
        type="button"
        @click="emit('requestAddTerm', sourceText)"
      >
        添加为术语
      </button>
    </div>

    <p v-if="terms.length === 0" class="empty-text">无命中术语</p>

    <ul v-else class="term-list">
      <li v-for="item in terms" :key="item.term.id" class="term-item">
        <div class="term-header">
          <span class="term-source">{{ item.term.source }}</span>
          <span class="term-target">{{ item.term.target }}</span>
        </div>
        <p v-if="item.term.note" class="term-note">{{ item.term.note }}</p>
        <p v-if="!item.isRecommendedUsed" class="term-warning">
          译文中尚未使用推荐译名
        </p>
        <button
          v-if="canManageTerms"
          class="text-button"
          type="button"
          @click="emit('requestEditTerm', item.term)"
        >
          编辑术语
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.term-hint {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid #e5e7eb;
}

h3 {
  margin: 0;
  font-size: 16px;
  line-height: 1.3;
}

.hint-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.empty-text,
.term-note,
.term-warning {
  margin: 0;
  line-height: 1.6;
}

.empty-text {
  color: #5b6472;
}

.term-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.term-item {
  padding: 12px 0;
  border-top: 1px solid #eef1f5;
}

.term-item:first-child {
  border-top: 0;
  padding-top: 0;
}

.term-header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 6px;
}

.term-source {
  font-weight: 700;
}

.term-target {
  color: #166534;
}

.term-note {
  color: #4b5563;
  font-size: 14px;
}

.term-warning {
  margin-top: 6px;
  color: #b45309;
  font-size: 14px;
}

.text-button {
  justify-self: start;
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
</style>
