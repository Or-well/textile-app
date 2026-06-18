<script setup lang="ts">
import type { Term } from "../model/types";

defineProps<{
  term: Term;
  matchedText?: string;
  isRecommendedUsed?: boolean;
  canEdit?: boolean;
}>();

const emit = defineEmits<{
  edit: [term: Term];
}>();
</script>

<template>
  <article class="term-list-item">
    <div class="term-main">
      <div>
        <strong>{{ term.source }}</strong>
        <span v-if="term.part_of_speech">{{ term.part_of_speech }}</span>
      </div>
      <p>{{ term.target }}</p>
    </div>

    <p v-if="matchedText" class="matched-text">命中：{{ matchedText }}</p>
    <p v-if="term.note" class="term-note">{{ term.note }}</p>
    <p v-if="isRecommendedUsed === false" class="term-warning">
      译文中尚未使用推荐译名
    </p>

    <div v-if="term.variants.length > 0" class="variant-list">
      <span v-for="variant in term.variants" :key="variant">{{ variant }}</span>
    </div>

    <button
      v-if="canEdit"
      class="text-button"
      type="button"
      @click="emit('edit', term)"
    >
      编辑术语
    </button>
  </article>
</template>

<style scoped>
.term-list-item {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #e3e8ef;
  border-radius: 8px;
  background: #ffffff;
}

.term-main {
  display: grid;
  gap: 5px;
}

.term-main div {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}

strong,
p {
  margin: 0;
}

strong {
  color: #111827;
  overflow-wrap: anywhere;
}

.term-main p {
  color: #166534;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.term-main span,
.matched-text,
.term-note {
  color: #5b6472;
  font-size: 13px;
}

.term-note,
.term-warning,
.matched-text {
  line-height: 1.6;
}

.term-warning {
  color: #b45309;
  font-size: 13px;
}

.variant-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.variant-list span {
  padding: 3px 7px;
  border-radius: 999px;
  background: #f3f5f7;
  color: #4b5563;
  font-size: 12px;
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
