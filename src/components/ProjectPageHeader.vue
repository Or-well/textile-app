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
  gap: var(--space-7);
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
  margin-bottom: var(--space-1);
  color: var(--color-muted);
  font-size: var(--font-xs);
}

h1 {
  color: var(--color-heading);
  font-size: 24px;
  line-height: 1.2;
}

.summary {
  margin-top: var(--space-2);
  color: var(--color-muted);
  font-size: var(--font-sm);
  line-height: 1.5;
}

.header-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
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
