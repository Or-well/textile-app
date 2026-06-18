<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { Term } from "../model/types";
import { loadTerms } from "../services/terms";

const terms = ref<Term[]>([]);
const searchText = ref("");
const isLoading = ref(false);
const errorMessage = ref("");

const filteredTerms = computed(() => {
  const keyword = searchText.value.trim().toLowerCase();

  if (!keyword) {
    return terms.value;
  }

  return terms.value.filter((term) => {
    const values = [
      term.source,
      term.target,
      term.note,
      ...term.variants,
    ].map((value) => value.toLowerCase());

    return values.some((value) => value.includes(keyword));
  });
});

async function loadTermRows() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    terms.value = await loadTerms();
  } catch (error) {
    terms.value = [];
    errorMessage.value =
      error instanceof Error ? error.message : "术语表无法读取。";
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadTermRows);
</script>

<template>
  <section class="terms-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">术语</p>
        <h1>术语</h1>
        <p class="summary">查看和检索当前项目的术语表。</p>
      </div>

      <span class="count-badge">{{ filteredTerms.length }} / {{ terms.length }} 条</span>
    </header>

    <section class="toolbar">
      <label>
        <span>搜索</span>
        <input
          v-model="searchText"
          type="search"
          placeholder="搜索原文、译名、备注或变体"
        />
      </label>
    </section>

    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    <p v-else-if="isLoading" class="empty-state">正在加载术语...</p>

    <div v-else-if="filteredTerms.length > 0" class="term-list">
      <article v-for="term in filteredTerms" :key="term.id" class="term-card">
        <div class="term-main">
          <div>
            <span class="field-label">原文</span>
            <strong>{{ term.source }}</strong>
          </div>
          <div>
            <span class="field-label">推荐译名</span>
            <strong class="target-text">{{ term.target }}</strong>
          </div>
        </div>

        <dl class="term-meta">
          <div>
            <dt>词性</dt>
            <dd>{{ term.part_of_speech || "未填写" }}</dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd>{{ term.updated_at || "暂无记录" }}</dd>
          </div>
        </dl>

        <p v-if="term.note" class="term-note">{{ term.note }}</p>

        <div v-if="term.variants.length > 0" class="variant-list">
          <span v-for="variant in term.variants" :key="variant">
            {{ variant }}
          </span>
        </div>
      </article>
    </div>

    <p v-else class="empty-state">
      {{ terms.length === 0 ? "暂无术语。" : "没有找到匹配的术语。" }}
    </p>
  </section>
</template>

<style scoped>
.terms-page {
  display: grid;
  gap: 16px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.eyebrow,
.summary,
.field-label,
dt {
  color: #5b6472;
}

.eyebrow,
h1,
.summary,
p,
dl,
dd {
  margin: 0;
}

.eyebrow {
  margin-bottom: 6px;
  font-size: 14px;
}

h1 {
  color: #111827;
  font-size: 28px;
  line-height: 1.2;
}

.summary {
  margin-top: 8px;
  line-height: 1.7;
}

.count-badge {
  flex: 0 0 auto;
  padding: 5px 10px;
  border-radius: 999px;
  background: #e6f0ef;
  color: #174346;
  font-size: 13px;
  font-weight: 700;
}

.toolbar {
  padding: 12px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

label {
  display: grid;
  gap: 6px;
}

label span,
.field-label,
dt {
  font-size: 13px;
}

input {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
}

.error-message {
  color: #b42318;
  line-height: 1.7;
}

.empty-state {
  padding: 18px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #4b5563;
  line-height: 1.7;
}

.term-list {
  display: grid;
  gap: 12px;
}

.term-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.term-main {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.term-main div,
.term-meta div {
  display: grid;
  gap: 5px;
  min-width: 0;
}

strong,
dd {
  overflow-wrap: anywhere;
  color: #111827;
}

.target-text {
  color: #166534;
}

.term-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

dd {
  font-size: 14px;
}

.term-note {
  color: #4b5563;
  line-height: 1.7;
}

.variant-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.variant-list span {
  padding: 3px 8px;
  border-radius: 999px;
  background: #f3f5f7;
  color: #4b5563;
  font-size: 13px;
}

@media (max-width: 760px) {
  .page-header,
  .term-main,
  .term-meta {
    grid-template-columns: 1fr;
  }

  .page-header {
    display: grid;
  }
}
</style>
