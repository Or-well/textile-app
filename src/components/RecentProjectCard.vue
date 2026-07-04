<script setup lang="ts">
import type { RecentProjectRecord } from "../services/recentProjects";

defineProps<{
  project: RecentProjectRecord;
  sourceLabel: string;
  lastOpenedText: string;
  isOpening?: boolean;
}>();

const emit = defineEmits<{
  open: [project: RecentProjectRecord];
  remove: [recordId: string];
}>();
</script>

<template>
  <article class="recent-project-card">
    <div class="project-main">
      <div class="title-row">
        <h3>{{ project.name }}</h3>
        <span>{{ sourceLabel }}</span>
      </div>
      <p>{{ project.displayPath }}</p>

    </div>

    <dl>
      <div>
        <dt>上次打开</dt>
        <dd>{{ lastOpenedText }}</dd>
      </div>
    </dl>

    <div class="card-actions">
      <button
        class="primary-button"
        type="button"
        :disabled="isOpening"
        @click="emit('open', project)"
      >
        快速打开
      </button>
      <button
        class="secondary-button"
        type="button"
        @click="emit('remove', project.recordId)"
      >
        从列表移除
      </button>
    </div>
  </article>
</template>

<style scoped>
.recent-project-card {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(190px, 0.52fr) auto;
  gap: var(--space-4);
  align-items: center;
  min-height: 68px;
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.recent-project-card:hover {
  border-color: var(--color-brand);
  background: #f8fcfb;
}

.project-main {
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}

h3,
p,
dl,
dd {
  margin: 0;
}

h3 {
  color: var(--color-heading);
  font-size: 16px;
  line-height: 1.25;
}

.title-row span {
  padding: 3px 8px;
  border-radius: 999px;
  background: #e8f3f1;
  color: #194b4f;
  font-size: 12px;
  font-weight: 700;
}

p {
  color: var(--color-muted);
  font-size: var(--font-sm);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

dl {
  display: grid;
  gap: 8px;
  margin-top: 0;
}

dl div {
  padding: 0;
  border-radius: 6px;
  background: transparent;
}

dt {
  color: #6b7280;
  font-size: 12px;
}

dd {
  margin-top: 3px;
  color: #111827;
  font-size: 13px;
  font-weight: 700;
}

.card-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.primary-button,
.secondary-button {
  min-height: var(--control-md);
  padding: 0 var(--space-5);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.primary-button {
  border-color: var(--color-brand);
  background: var(--color-brand);
  color: var(--color-surface);
}

.secondary-button {
  border-color: var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

@media (max-width: 760px) {
  .recent-project-card {
    grid-template-columns: 1fr;
  }

  .card-actions {
    display: flex;
    flex-wrap: wrap;
  }
}
</style>
