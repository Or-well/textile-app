<script setup lang="ts">
import { ref, watch } from "vue";

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
  padding: 24px;
  background: rgba(15, 23, 42, 0.38);
}

.context-dialog {
  width: min(560px, 100%);
  display: grid;
  gap: 14px;
  padding: 20px;
  border: 1px solid #d7dde5;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.22);
}

.dialog-header,
.dialog-actions {
  display: flex;
  align-items: center;
}

.dialog-header {
  justify-content: space-between;
  gap: 12px;
}

h2 {
  margin: 0;
  color: #111827;
  font-size: 20px;
}

textarea {
  width: 100%;
  min-height: 180px;
  padding: 12px;
  border: 1px solid #c8d0dc;
  border-radius: 8px;
  color: #1f2937;
  font: inherit;
  line-height: 1.7;
  resize: vertical;
}

textarea:focus {
  outline: none;
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

textarea:disabled {
  background: #f3f4f6;
  color: #6b7280;
}

.dialog-actions {
  justify-content: flex-end;
  gap: 8px;
}

.primary-button,
.secondary-button,
.icon-button {
  min-height: 36px;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.primary-button,
.secondary-button {
  padding: 0 13px;
}

.primary-button {
  border: 1px solid #2f6f73;
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button,
.icon-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

.icon-button {
  width: 34px;
  padding: 0;
  font-size: 20px;
  line-height: 1;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}
</style>
