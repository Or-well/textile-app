<script setup lang="ts">
import type { TermUsageResult } from "../services/terms";

defineProps<{
  terms: TermUsageResult[];
}>();
</script>

<template>
  <section class="term-hint">
    <h3>术语提示</h3>

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
  margin: 0 0 12px;
  font-size: 16px;
  line-height: 1.3;
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
</style>
