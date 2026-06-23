<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  title: string;
  description: string;
  initialValue?: string;
  suggestions?: string[];
  confirmLabel?: string;
  allowClear?: boolean;
  isSubmitting?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [value: string];
}>();

const value = ref("");

watch(
  () => [props.open, props.initialValue] as const,
  ([open, initialValue]) => {
    if (open) {
      value.value = initialValue ?? "";
    }
  },
  { immediate: true },
);

function submit() {
  const nextValue = value.value.trim();

  if (nextValue) {
    emit("confirm", nextValue);
  }
}
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop"
    role="presentation"
    @click.self="!isSubmitting && emit('cancel')"
  >
    <form
      class="group-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-group-dialog-title"
      @submit.prevent="submit"
    >
      <header>
        <div>
          <p class="eyebrow">文件分组</p>
          <h2 id="file-group-dialog-title">{{ title }}</h2>
        </div>
        <button
          type="button"
          class="close-button"
          aria-label="关闭"
          :disabled="isSubmitting"
          @click="emit('cancel')"
        >
          ×
        </button>
      </header>

      <div class="dialog-body">
        <p>{{ description }}</p>
        <label for="file-group-name">分组名称</label>
        <input
          id="file-group-name"
          v-model="value"
          type="text"
          maxlength="120"
          list="existing-file-groups"
          autocomplete="off"
          placeholder="输入现有分组或新的分组名称"
          autofocus
        />
        <datalist id="existing-file-groups">
          <option
            v-for="suggestion in suggestions"
            :key="suggestion"
            :value="suggestion"
          />
        </datalist>
      </div>

      <footer>
        <button
          v-if="allowClear"
          type="button"
          class="clear-button"
          :disabled="isSubmitting"
          @click="emit('confirm', '')"
        >
          移出分组
        </button>
        <span class="footer-spacer"></span>
        <button
          type="button"
          class="secondary-button"
          :disabled="isSubmitting"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          type="submit"
          class="primary-button"
          :disabled="!value.trim() || isSubmitting"
        >
          {{ isSubmitting ? "正在处理..." : confirmLabel || "确认" }}
        </button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.46);
}

.group-dialog {
  width: min(520px, 100%);
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.24);
}

header,
footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px;
}

header {
  justify-content: space-between;
  border-bottom: 1px solid #e5e7eb;
}

footer {
  border-top: 1px solid #e5e7eb;
}

h2,
p {
  margin: 0;
}

h2 {
  font-size: 22px;
}

.eyebrow {
  color: #5b6472;
  font-size: 13px;
}

.dialog-body {
  display: grid;
  gap: 10px;
  padding: 18px;
}

.dialog-body p {
  color: #5b6472;
  line-height: 1.65;
}

label {
  color: #374151;
  font-size: 14px;
  font-weight: 700;
}

input {
  width: 100%;
  min-height: 42px;
  box-sizing: border-box;
  padding: 0 11px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  color: #1f2937;
  font: inherit;
}

.footer-spacer {
  flex: 1;
}

.close-button {
  width: 36px;
  min-height: 36px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 24px;
  cursor: pointer;
}

.primary-button,
.secondary-button,
.clear-button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.primary-button {
  border: 0;
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button,
.clear-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

.clear-button {
  color: #9f2d24;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}
</style>
