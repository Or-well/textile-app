<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAppDraft } from "../composables/useAppDraft";

const props = defineProps<{
  title: string;
  initialValue?: string;
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [context: string];
}>();

const contextText = ref("");
const hasUnsavedContext = computed(
  () => contextText.value !== (props.initialValue ?? ""),
);

useAppDraft("上下文", hasUnsavedContext);

watch(
  () => props.initialValue,
  (value) => {
    contextText.value = value ?? "";
  },
  { immediate: true },
);
</script>

<template>
  <div class="dialog-backdrop" role="presentation" @click.self="emit('cancel')">
    <section class="context-dialog" role="dialog" aria-modal="true" :aria-label="title">
      <header class="dialog-header">
        <h2>{{ title }}</h2>
        <button class="icon-button" type="button" :disabled="isSaving" @click="emit('cancel')">
          ×
        </button>
      </header>

      <textarea
        v-model="contextText"
        :disabled="isSaving"
        placeholder="请输入这个词条的场景、说话对象、语气、前后文说明等。"
      />

      <footer class="dialog-actions">
        <button class="secondary-button" type="button" :disabled="isSaving" @click="emit('cancel')">
          取消
        </button>
        <button
          class="primary-button"
          type="button"
          :disabled="isSaving"
          @click="emit('save', contextText)"
        >
          {{ isSaving ? "保存中..." : "保存" }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: var(--space-7);
  background: rgba(15, 23, 42, 0.38);
}

.context-dialog {
  width: min(560px, 100%);
  display: grid;
  gap: var(--space-4);
  padding: var(--panel-padding);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.22);
}

.dialog-header,
.dialog-actions {
  display: flex;
  align-items: center;
}

.dialog-header {
  justify-content: space-between;
  gap: var(--space-4);
}

h2 {
  margin: 0;
  color: var(--color-heading);
  font-size: 18px;
  line-height: 1.3;
}

textarea {
  width: 100%;
  min-height: 160px;
  padding: var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font: inherit;
  line-height: 1.55;
  resize: vertical;
}

textarea:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

textarea:disabled {
  background: var(--color-surface-muted);
  color: var(--color-muted);
}

.dialog-actions {
  justify-content: flex-end;
  gap: var(--space-3);
}

.primary-button,
.secondary-button,
.icon-button {
  min-height: var(--control-md);
  border-radius: var(--radius-sm);
  font: inherit;
  cursor: pointer;
}

.primary-button,
.secondary-button {
  padding: 0 var(--space-4);
}

.primary-button {
  border: 1px solid var(--color-brand);
  background: var(--color-brand);
  color: #ffffff;
}

.secondary-button,
.icon-button {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
}

.icon-button {
  width: var(--control-md);
  padding: 0;
  font-size: 18px;
  line-height: 1;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}
</style>
