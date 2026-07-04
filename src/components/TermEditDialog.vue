<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAppDraft } from "../composables/useAppDraft";
import type { Term } from "../model/types";
import type { TermInput } from "../services/terms";

const props = defineProps<{
  term?: Term;
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [input: TermInput];
}>();

const partOfSpeechOptions = [
  "名词",
  "动词",
  "形容词",
  "副词",
  "人名",
  "地名",
  "组织名",
  "专有名词",
  "短语",
  "其他",
];

const source = ref("");
const target = ref("");
const partOfSpeech = ref("名词");
const note = ref("");
const variants = ref<string[]>([]);
const variantInput = ref("");
const caseSensitive = ref(false);
const errorMessage = ref("");

const dialogTitle = ref("创建术语");
const hasUnsavedTerm = computed(() => {
  const term = props.term;

  return (
    source.value !== (term?.source ?? "") ||
    target.value !== (term?.target ?? "") ||
    partOfSpeech.value !== (term?.part_of_speech || "名词") ||
    note.value !== (term?.note ?? "") ||
    Boolean(variantInput.value.trim()) ||
    caseSensitive.value !== (term?.case_sensitive === true) ||
    variants.value.length !== (term?.variants.length ?? 0) ||
    variants.value.some((variant, index) => variant !== term?.variants[index])
  );
});

useAppDraft("术语", hasUnsavedTerm);

watch(
  () => props.term,
  (term) => {
    dialogTitle.value = term ? "编辑术语" : "创建术语";
    source.value = term?.source ?? "";
    target.value = term?.target ?? "";
    partOfSpeech.value = term?.part_of_speech || "名词";
    note.value = term?.note ?? "";
    variants.value = [...(term?.variants ?? [])];
    variantInput.value = "";
    caseSensitive.value = term?.case_sensitive === true;
    errorMessage.value = "";
  },
  { immediate: true },
);

function addVariant() {
  const value = variantInput.value.trim();

  if (!value) {
    return;
  }

  if (!variants.value.includes(value)) {
    variants.value = [...variants.value, value];
  }

  variantInput.value = "";
}

function handleVariantKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  addVariant();
}

function removeVariant(value: string) {
  variants.value = variants.value.filter((variant) => variant !== value);
}

function handleSave() {
  if (!source.value.trim()) {
    errorMessage.value = "术语原文不能为空。";
    return;
  }

  if (!target.value.trim()) {
    errorMessage.value = "术语译文不能为空。";
    return;
  }

  emit("save", {
    source: source.value,
    target: target.value,
    part_of_speech: partOfSpeech.value,
    note: note.value,
    variants: variants.value,
    case_sensitive: caseSensitive.value,
  });
}
</script>

<template>
  <div class="dialog-backdrop" role="presentation" @click.self="emit('cancel')">
    <section class="term-dialog" role="dialog" aria-modal="true" :aria-label="dialogTitle">
      <header class="dialog-header">
        <h2>{{ dialogTitle }}</h2>
        <button class="icon-button" type="button" :disabled="isSaving" @click="emit('cancel')">
          ×
        </button>
      </header>

      <div class="form-stack">
        <label class="form-row">
          <span>词性</span>
          <select v-model="partOfSpeech" :disabled="isSaving">
            <option v-for="option in partOfSpeechOptions" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
        </label>

        <label class="form-row">
          <span>术语原文</span>
          <input v-model="source" type="text" :disabled="isSaving" />
        </label>

        <label class="form-row">
          <span>术语译文</span>
          <input v-model="target" type="text" :disabled="isSaving" />
        </label>

        <div class="form-row">
          <span>术语变体</span>
          <div class="variant-editor">
            <div class="variant-input-row">
              <input
                v-model="variantInput"
                type="text"
                :disabled="isSaving"
                placeholder="输入后按回车添加"
                @keydown="handleVariantKeydown"
              />
              <button class="secondary-button" type="button" :disabled="isSaving" @click="addVariant">
                +
              </button>
            </div>
            <div v-if="variants.length > 0" class="variant-tags">
              <button
                v-for="variant in variants"
                :key="variant"
                type="button"
                :disabled="isSaving"
                @click="removeVariant(variant)"
              >
                {{ variant }} <span>×</span>
              </button>
            </div>
          </div>
        </div>

        <label class="form-row">
          <span>额外说明</span>
          <textarea v-model="note" :disabled="isSaving" rows="4" />
        </label>

        <label class="checkbox-row">
          <input v-model="caseSensitive" type="checkbox" :disabled="isSaving" />
          <span>大小写敏感</span>
        </label>
      </div>

      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

      <footer class="dialog-actions">
        <button class="secondary-button" type="button" :disabled="isSaving" @click="emit('cancel')">
          取消
        </button>
        <button class="primary-button" type="button" :disabled="isSaving" @click="handleSave">
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

.term-dialog {
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
.dialog-actions,
.variant-input-row,
.checkbox-row {
  display: flex;
  align-items: center;
}

.dialog-header {
  justify-content: space-between;
  gap: var(--space-4);
}

h2,
p {
  margin: 0;
}

h2 {
  color: var(--color-heading);
  font-size: 18px;
}

.form-stack {
  display: grid;
  gap: var(--space-4);
}

.form-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}

.form-row > span,
.checkbox-row span {
  color: #374151;
  font-size: 14px;
  font-weight: 700;
}

input,
select,
textarea {
  width: 100%;
  min-height: var(--control-md);
  padding: 0 var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-sm);
}

textarea {
  min-height: 90px;
  padding: var(--space-3) var(--space-4);
  resize: vertical;
  line-height: 1.5;
}

input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

input:disabled,
select:disabled,
textarea:disabled {
  background: #f3f4f6;
  color: #6b7280;
}

.variant-editor {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.variant-input-row {
  gap: var(--space-3);
}

.variant-input-row .secondary-button {
  width: var(--control-md);
  padding: 0;
}

.variant-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.variant-tags button {
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid #d6dde7;
  border-radius: 999px;
  background: #f8fafb;
  color: #374151;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.variant-tags span {
  color: #6b7280;
}

.checkbox-row {
  gap: var(--space-3);
  padding-left: 108px;
}

.checkbox-row input {
  width: 16px;
  min-height: 16px;
}

.error-message {
  color: #b42318;
  line-height: 1.5;
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
  padding: 0 var(--space-5);
}

.primary-button {
  border: 1px solid var(--color-brand);
  background: var(--color-brand);
  color: var(--color-surface);
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

@media (max-width: 560px) {
  .form-row {
    grid-template-columns: 1fr;
  }

  .checkbox-row {
    padding-left: 0;
  }
}
</style>
