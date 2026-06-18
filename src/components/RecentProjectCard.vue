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
  remove: [projectId: string];
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
        @click="emit('remove', project.projectId)"
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
  gap: 14px;
  align-items: center;
  min-height: 76px;
  padding: 13px 14px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.recent-project-card:hover {
  border-color: #2f6f73;
  background: #f8fcfb;
}

.project-main {
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 7px;
}

h3,
p,
dl,
dd {
  margin: 0;
}

h3 {
  color: #111827;
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
  color: #5b6472;
  font-size: 14px;
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
  gap: 8px;
}

.primary-button,
.secondary-button {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.primary-button {
  border-color: #2f6f73;
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button {
  border-color: #c8d0dc;
  background: #ffffff;
  color: #1f2937;
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
