<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    placeholder?: string;
    submitLabel: string;
    disabled?: boolean;
  }>(),
  {
    placeholder: "",
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  submit: [];
}>();
</script>

<template>
  <form class="comment-editor" @submit.prevent="emit('submit')">
    <label>
      <span>{{ props.label }}</span>
      <textarea
        :value="props.modelValue"
        rows="3"
        :placeholder="props.placeholder"
        :disabled="props.disabled"
        @input="
          emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)
        "
      />
    </label>
    <button type="submit" :disabled="props.disabled || !props.modelValue.trim()">
      {{ props.submitLabel }}
    </button>
  </form>
</template>

<style scoped>
.comment-editor {
  display: grid;
  gap: var(--space-3);
}

label {
  display: grid;
  gap: var(--space-2);
}

label span {
  color: var(--color-muted);
  font-size: var(--font-sm);
}

textarea {
  width: 100%;
  resize: vertical;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font: inherit;
  line-height: 1.5;
}

textarea:focus {
  outline: none;
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

button {
  justify-self: start;
  min-height: var(--control-md);
  padding: 0 var(--space-5);
  border: 1px solid var(--color-brand);
  border-radius: var(--radius-sm);
  background: var(--color-brand);
  color: var(--color-surface);
  font: inherit;
  font-size: var(--font-sm);
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}
</style>
