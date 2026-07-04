<script setup lang="ts">
import { computed, ref } from "vue";
import {
  CACHE_CLEANUP_OPTIONS,
  type CacheCleanupItemId,
} from "../../services/cacheMaintenance";

defineProps<{
  busy?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [items: CacheCleanupItemId[]];
}>();

const selectedItems = ref<CacheCleanupItemId[]>(
  CACHE_CLEANUP_OPTIONS.filter((option) => option.defaultSelected).map(
    (option) => option.id,
  ),
);
const forbiddenItems = [
  "项目文件",
  "成员信息",
  "词条",
  "译文",
  "任务",
  "批注",
  "术语",
  "签名私钥",
];
const canSubmit = computed(() => selectedItems.value.length > 0);

function toggleItem(itemId: CacheCleanupItemId, checked: boolean): void {
  if (checked) {
    selectedItems.value = Array.from(new Set([...selectedItems.value, itemId]));
    return;
  }

  selectedItems.value = selectedItems.value.filter((id) => id !== itemId);
}
</script>

<template>
  <section class="dialog-backdrop" role="presentation">
    <article
      class="dialog-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-cache-title"
    >
      <header>
        <h2 id="clear-cache-title">清理缓存</h2>
        <p>
          可以清理程序运行产生的临时数据，不会删除项目词条、译文、术语、任务和批注。
        </p>
      </header>

      <div class="option-list">
        <label
          v-for="option in CACHE_CLEANUP_OPTIONS"
          :key="option.id"
          class="cleanup-option"
        >
          <input
            type="checkbox"
            :checked="selectedItems.includes(option.id)"
            :disabled="busy"
            @change="toggleItem(option.id, ($event.target as HTMLInputElement).checked)"
          />
          <span>
            <strong>{{ option.label }}</strong>
            <small>{{ option.description }}</small>
          </span>
        </label>
      </div>

      <section class="forbidden-panel">
        <strong>不会清理</strong>
        <p>{{ forbiddenItems.join("、") }}</p>
      </section>

      <footer>
        <button
          class="secondary-button"
          type="button"
          :disabled="busy"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          class="primary-button"
          type="button"
          :disabled="busy || !canSubmit"
          @click="emit('confirm', selectedItems)"
        >
          {{ busy ? "正在清理..." : "清理缓存" }}
        </button>
      </footer>
    </article>
  </section>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: var(--space-6);
  background: rgba(15, 23, 42, 0.42);
}

.dialog-panel {
  display: grid;
  gap: var(--space-4);
  width: min(100%, 620px);
  max-height: min(92vh, 720px);
  overflow: auto;
  padding: var(--panel-padding);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.26);
}

header {
  display: grid;
  gap: var(--space-2);
}

h2,
p {
  margin: 0;
}

h2 {
  color: var(--color-heading);
  font-size: 18px;
  line-height: 1.3;
}

header p,
.forbidden-panel p,
small {
  color: #5b6472;
  line-height: 1.5;
}

.option-list {
  display: grid;
  gap: var(--space-2);
}

.cleanup-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-3);
  align-items: start;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
}

input {
  width: 16px;
  height: 16px;
  margin-top: 3px;
}

.cleanup-option span {
  display: grid;
  gap: var(--space-1);
}

.cleanup-option strong,
.forbidden-panel strong {
  color: var(--color-heading);
}

small {
  font-size: var(--font-sm);
}

.forbidden-panel {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  border: 1px solid #f0c6bd;
  border-radius: var(--radius-sm);
  background: #fffafa;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}

.primary-button,
.secondary-button {
  min-height: var(--control-md);
  padding: 0 var(--space-4);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--font-sm);
  font-weight: 700;
  cursor: pointer;
}

.primary-button {
  border: 1px solid var(--color-brand);
  background: var(--color-brand);
  color: #ffffff;
}

.secondary-button {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}
</style>
