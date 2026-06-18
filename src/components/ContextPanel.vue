<script setup lang="ts">
import { computed, ref } from "vue";
import ContextEditDialog from "./ContextEditDialog.vue";
import type { Entry } from "../model/types";
import { updateEntryContext } from "../services/entries";
import {
  canCreateContext,
  canDeleteContext,
  canUpdateContext,
  canViewContext,
  getCurrentUser,
} from "../services/permissions";

const props = defineProps<{
  entry?: Entry;
}>();

const emit = defineEmits<{
  entryUpdated: [entry: Entry];
}>();

const isDialogOpen = ref(false);
const isSaving = ref(false);
const errorMessage = ref("");

const currentUser = computed(() => getCurrentUser());
const canView = computed(() => canViewContext(currentUser.value));
const hasContext = computed(() => Boolean(props.entry?.context?.trim()));
const canCreate = computed(() => !hasContext.value && canCreateContext(currentUser.value));
const canUpdate = computed(() => hasContext.value && canUpdateContext(currentUser.value));
const canDelete = computed(() => hasContext.value && canDeleteContext(currentUser.value));
const dialogTitle = computed(() => (hasContext.value ? "编辑上下文" : "添加上下文"));

function openDialog() {
  if (!props.entry || (!canCreate.value && !canUpdate.value)) {
    return;
  }

  errorMessage.value = "";
  isDialogOpen.value = true;
}

function closeDialog() {
  if (!isSaving.value) {
    isDialogOpen.value = false;
  }
}

async function saveContext(context: string) {
  if (!props.entry || (!canCreate.value && !canUpdate.value)) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";

  try {
    const updatedEntry = await updateEntryContext(
      props.entry.id,
      context,
      currentUser.value?.id ?? props.entry.updated_by,
    );

    emit("entryUpdated", updatedEntry);
    isDialogOpen.value = false;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "上下文保存失败，请稍后再试。";
  } finally {
    isSaving.value = false;
  }
}

async function deleteContext() {
  if (!props.entry || !canDelete.value) {
    return;
  }

  if (!window.confirm("确定要删除这个上下文吗？")) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";

  try {
    const updatedEntry = await updateEntryContext(
      props.entry.id,
      "",
      currentUser.value?.id ?? props.entry.updated_by,
    );

    emit("entryUpdated", updatedEntry);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "上下文删除失败，请稍后再试。";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <section class="context-panel">
    <p v-if="!entry" class="empty-text">请选择词条</p>

    <template v-else-if="canView">
      <div v-if="hasContext" class="context-card">
        <p>{{ entry.context }}</p>
      </div>
      <p v-else class="empty-text">暂无上下文</p>

      <div class="context-actions">
        <button
          v-if="canCreate"
          class="primary-button"
          type="button"
          :disabled="isSaving"
          @click="openDialog"
        >
          添加上下文
        </button>
        <button
          v-if="canUpdate"
          class="secondary-button"
          type="button"
          :disabled="isSaving"
          @click="openDialog"
        >
          编辑上下文
        </button>
        <button
          v-if="canDelete"
          class="danger-button"
          type="button"
          :disabled="isSaving"
          @click="deleteContext"
        >
          删除上下文
        </button>
      </div>
    </template>

    <p v-else class="empty-text">当前用户不能查看上下文。</p>
    <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

    <ContextEditDialog
      v-if="isDialogOpen"
      :title="dialogTitle"
      :initial-value="entry?.context ?? ''"
      :is-saving="isSaving"
      @cancel="closeDialog"
      @save="saveContext"
    />
  </section>
</template>

<style scoped>
.context-panel {
  display: grid;
  align-content: start;
  gap: 12px;
}

.context-card {
  padding: 12px;
  border: 1px solid #e3e8ef;
  border-radius: 8px;
  background: #f8fafb;
}

p {
  margin: 0;
  line-height: 1.7;
}

.context-card p {
  color: #1f2937;
  white-space: pre-wrap;
}

.empty-text {
  color: #5b6472;
}

.error-message {
  color: #b42318;
}

.context-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.primary-button,
.secondary-button,
.danger-button {
  min-height: 34px;
  padding: 0 11px;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.primary-button {
  border: 1px solid #2f6f73;
  background: #2f6f73;
  color: #ffffff;
}

.secondary-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

.danger-button {
  border: 1px solid #f0b8aa;
  background: #ffffff;
  color: #b42318;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}
</style>
