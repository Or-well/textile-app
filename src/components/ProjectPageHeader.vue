<script setup lang="ts">
defineProps<{
  eyebrow: string;
  title: string;
  summary?: string;
}>();
</script>

<template>
  <header class="project-page-header">
    <div class="header-copy">
      <p class="eyebrow">{{ eyebrow }}</p>
      <h1>{{ title }}</h1>
      <p v-if="summary" class="summary">{{ summary }}</p>
    </div>

    <div v-if="$slots.actions" class="header-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.project-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  min-width: 0;
}

.header-copy {
  min-width: 0;
}

.eyebrow,
h1,
.summary {
  margin: 0;
}

.eyebrow {
  margin-bottom: 5px;
  color: #5b6472;
  font-size: 13px;
}

h1 {
  color: #111827;
  font-size: 28px;
  line-height: 1.2;
}

.summary {
  margin-top: 8px;
  color: #5b6472;
  font-size: 13px;
  line-height: 1.6;
}

.header-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

@media (max-width: 840px) {
  .project-page-header {
    display: grid;
  }

  .header-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
</style>
