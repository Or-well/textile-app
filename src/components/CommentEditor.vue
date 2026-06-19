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
  gap: 8px;
}

label {
  display: grid;
  gap: 6px;
}

label span {
  color: #5b6472;
  font-size: 13px;
}

textarea {
  width: 100%;
  resize: vertical;
  padding: 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  color: #1f2937;
  font: inherit;
  line-height: 1.6;
}

textarea:focus {
  outline: none;
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

button {
  justify-self: start;
  min-height: 36px;
  padding: 0 13px;
  border: 1px solid #2f6f73;
  border-radius: 6px;
  background: #2f6f73;
  color: #ffffff;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}
</style>
