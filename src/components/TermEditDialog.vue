<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Term } from "../model/types";
import type { TermInput } from "../services/terms";

const PART_OF_SPEECH_OPTIONS = [
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

const props = defineProps<{
  open: boolean;
  term?: Term | null;
  initialSource?: string;
  initialTarget?: string;
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [input: TermInput];
}>();

const source = ref("");
const target = ref("");
const partOfSpeech = ref("名词");
const note = ref("");
const caseSensitive = ref(false);
const variants = ref<string[]>([]);
const variantText = ref("");
const localError = ref("");

const dialogTitle = computed(() => (props.term ? "编辑术语" : "创建术语"));

function shortTargetSuggestion(): string {
  const value = props.initialTarget?.trim() ?? "";

  return value.length > 0 && value.length <= 24 ? value : "";
}

function getSelectedSourceText(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.getSelection()?.toString().trim() ?? "";
}

function resetForm() {
  source.value =
    props.term?.source ?? props.initialSource?.trim() ?? getSelectedSourceText();
  target.value = props.term?.target ?? shortTargetSuggestion();
  partOfSpeech.value = props.term?.part_of_speech || "名词";
  note.value = props.term?.note ?? "";
  caseSensitive.value = props.term?.case_sensitive === true;
  variants.value = [...(props.term?.variants ?? [])];
  variantText.value = "";
  localError.value = "";
}

function addVariant() {
  const value = variantText.value.trim();

  if (!value) {
    return;
  }

  if (!variants.value.includes(value)) {
    variants.value = [...variants.value, value];
  }

  variantText.value = "";
}

function removeVariant(value: string) {
  variants.value = variants.value.filter((variant) => variant !== value);
}

function handleSubmit() {
  const nextSource = source.value.trim();
  const nextTarget = target.value.trim();

  if (!nextSource) {
    localError.value = "术语原文不能为空。";
    return;
  }

  if (!nextTarget) {
    localError.value = "术语译文不能为空。";
    return;
  }

  emit("submit", {
    source: nextSource,
    target: nextTarget,
    part_of_speech: partOfSpeech.value,
    note: note.value.trim(),
    variants: variants.value,
    case_sensitive: caseSensitive.value,
  });
}

watch(
  () => [props.open, props.term?.id, props.initialSource, props.initialTarget],
  () => {
    if (props.open) {
      resetForm();
    }
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" role="presentation">
      <section
        class="term-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="dialogTitle"
      >
        <header class="dialog-header">
          <h2>{{ dialogTitle }}</h2>
          <button
            class="icon-button"
            type="button"
            aria-label="关闭"
            :disabled="isSaving"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <form class="dialog-body" @submit.prevent="handleSubmit">
          <label>
            <span>词性</span>
            <select v-model="partOfSpeech">
              <option
                v-for="option in PART_OF_SPEECH_OPTIONS"
                :key="option"
                :value="option"
              >
                {{ option }}
              </option>
            </select>
          </label>

          <label>
            <span>术语原文</span>
            <input
              v-model="source"
              type="text"
              placeholder="术语原文，单词或短语"
              :disabled="isSaving"
            />
          </label>

          <label>
            <span>术语译文</span>
            <input
              v-model="target"
              type="text"
              placeholder="术语译文"
              :disabled="isSaving"
            />
          </label>

          <label class="variant-field">
            <span>术语变体</span>
            <div class="variant-input-row">
              <input
                v-model="variantText"
                type="text"
                placeholder="术语变体，按回车添加"
                :disabled="isSaving"
                @keydown.enter.prevent="addVariant"
              />
              <button type="button" :disabled="isSaving" @click="addVariant">
                +
              </button>
            </div>
          </label>

          <div v-if="variants.length > 0" class="variant-tags">
            <button
              v-for="variant in variants"
              :key="variant"
              type="button"
              :disabled="isSaving"
              @click="removeVariant(variant)"
            >
              {{ variant }} <span aria-hidden="true">×</span>
            </button>
          </div>

          <label>
            <span>额外说明</span>
            <textarea
              v-model="note"
              rows="4"
              placeholder="额外的说明"
              :disabled="isSaving"
            />
          </label>

          <label class="checkbox-field">
            <input
              v-model="caseSensitive"
              type="checkbox"
              :disabled="isSaving"
            />
            <span>大小写敏感</span>
          </label>

          <p v-if="localError" class="error-message">{{ localError }}</p>

          <footer class="dialog-actions">
            <button
              class="secondary-button"
              type="button"
              :disabled="isSaving"
              @click="emit('close')"
            >
              取消
            </button>
            <button class="primary-button" type="submit" :disabled="isSaving">
              {{ isSaving ? "提交中..." : "提交" }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 22px;
  background: rgba(17, 24, 39, 0.42);
}

.term-dialog {
  width: min(100%, 560px);
  max-height: min(760px, calc(100vh - 44px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border-radius: 8px;
  background: #ffffff;
  color: #1f2937;
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.22);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 18px;
  border-bottom: 1px solid #e5e7eb;
}

h2,
p {
  margin: 0;
}

h2 {
  color: #111827;
  font-size: 20px;
}

.dialog-body {
  display: grid;
  gap: 13px;
  overflow: auto;
  padding: 18px;
}

label {
  display: grid;
  gap: 7px;
}

label span {
  color: #5b6472;
  font-size: 13px;
}

input,
select,
textarea {
  width: 100%;
  min-height: 40px;
  padding: 0 10px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
}

textarea {
  min-height: 96px;
  padding: 10px;
  resize: vertical;
  line-height: 1.6;
}

.variant-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px;
  gap: 8px;
}

.variant-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.variant-tags button {
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid #d7dde5;
  border-radius: 999px;
  background: #f8fafb;
  color: #374151;
  font-size: 13px;
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checkbox-field input {
  width: 16px;
  min-height: 16px;
}

.checkbox-field span {
  color: #1f2937;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

button {
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  cursor: pointer;
}

.icon-button {
  width: 34px;
  min-height: 34px;
  padding: 0;
  font-size: 22px;
  line-height: 1;
}

.primary-button {
  border-color: #2f6f73;
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button {
  background: #ffffff;
}

button:disabled,
input:disabled,
select:disabled,
textarea:disabled {
  cursor: wait;
  opacity: 0.68;
}

.error-message {
  color: #b42318;
  line-height: 1.6;
}
</style>
