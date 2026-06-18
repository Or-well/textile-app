<script setup lang="ts">
import TermListItem from "./TermListItem.vue";
import type { Term } from "../model/types";

export interface TermHintItem {
  term: Term;
  matchedText?: string;
  isRecommendedUsed?: boolean;
}

defineProps<{
  items: TermHintItem[];
  emptyText: string;
  canEdit?: boolean;
}>();

const emit = defineEmits<{
  requestEditTerm: [term: Term];
}>();
</script>

<template>
  <section class="term-hint">
    <p v-if="items.length === 0" class="empty-text">{{ emptyText }}</p>

    <div v-else class="term-list">
      <TermListItem
        v-for="item in items"
        :key="item.term.id"
        :term="item.term"
        :matched-text="item.matchedText"
        :is-recommended-used="item.isRecommendedUsed"
        :can-edit="canEdit"
        @edit="emit('requestEditTerm', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.term-hint {
  min-height: 0;
}

.empty-text {
  margin: 0;
  color: #5b6472;
  line-height: 1.7;
}

.term-list {
  display: grid;
  gap: 10px;
}
</style>
