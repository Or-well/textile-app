<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  ProjectDeletionMode,
  ProjectDeletionScan,
} from "../../services/projectDeletion";

const props = defineProps<{
  projectName: string;
  mode: ProjectDeletionMode;
  scan: ProjectDeletionScan | null;
  busy?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

const backupConfirmed = ref(false);
const projectNameInput = ref("");
const deletePhraseInput = ref("");
const isDiskDelete = computed(() => props.mode === "native_project_folder");
const eyebrowText = computed(() =>
  isDiskDelete.value ? "危险操作" : "项目操作",
);
const requiredPhrase = computed(() =>
  isDiskDelete.value ? "删除项目文件夹" : "移除项目",
);
const canSubmit = computed(() => {
  if (!props.scan?.canDelete) {
    return false;
  }

  if (!isDiskDelete.value) {
    return true;
  }

  return (
    backupConfirmed.value &&
    projectNameInput.value === props.projectName &&
    deletePhraseInput.value === requiredPhrase.value
  );
});
const dialogTitle = computed(() =>
  isDiskDelete.value ? "删除本地项目文件夹" : "从启动页移除当前项目",
);
const summaryTitle = computed(() =>
  isDiskDelete.value
    ? props.scan?.canDelete
      ? "将删除本地项目文件夹"
      : "无法删除本地项目文件夹"
    : props.scan?.canDelete
      ? "将移除本机记录"
      : "无法继续",
);
const confirmText = computed(() =>
  isDiskDelete.value
    ? "我理解此操作会删除磁盘上的项目文件夹，Textile 无法恢复。"
    : "我理解此操作只移除本机记录，不删除磁盘文件。",
);
const confirmButtonText = computed(() =>
  props.busy
    ? isDiskDelete.value
      ? "正在删除..."
      : "正在移除..."
    : isDiskDelete.value
      ? "删除项目文件夹"
      : "移除项目记录",
);
</script>

<template>
  <section class="dialog-backdrop" role="presentation">
    <article
      class="dialog-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-project-title"
    >
      <header>
        <p class="eyebrow" :class="{ danger: isDiskDelete }">{{ eyebrowText }}</p>
        <h2 id="delete-project-title">{{ dialogTitle }}</h2>
        <p v-if="!isDiskDelete">
          此操作只会从最近项目移除、清除当前项目会话并返回项目启动页。磁盘文件不会被删除。
        </p>
        <p v-else>
          此操作会删除磁盘上的当前项目文件夹，并清除最近项目记录和当前项目会话。
        </p>
        <p v-if="isDiskDelete">
          请先导出 .hproj 备份。删除完成后，Textile 无法恢复该项目文件夹。
        </p>
      </header>

      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

      <section v-if="isDiskDelete && scan" class="danger-summary">
        <strong>{{ summaryTitle }}</strong>
        <dl>
          <div>
            <dt>处理范围</dt>
            <dd>{{ scan.deleteTarget }}</dd>
          </div>
          <div>
            <dt>项目文件</dt>
            <dd>{{ isDiskDelete ? `${scan.fileCount} 个文件` : "不会删除" }}</dd>
          </div>
          <div>
            <dt>{{ isDiskDelete ? "项目目录" : "返回位置" }}</dt>
            <dd>{{ isDiskDelete ? `${scan.directoryCount} 个目录` : "项目启动页" }}</dd>
          </div>
        </dl>

        <ul class="entry-preview">
          <li v-for="entry in scan.entries" :key="entry">{{ entry }}</li>
        </ul>

        <p v-for="warning in scan.warnings" :key="warning" class="warning-text">
          {{ warning }}
        </p>
      </section>

      <section v-else-if="isDiskDelete" class="danger-summary">
        <strong>正在检查项目目录...</strong>
        <p>检查通过后才能执行删除。</p>
      </section>

      <section v-else-if="!scan" class="pending-summary">
        <strong>正在检查项目记录...</strong>
        <p>检查通过后即可移除。</p>
      </section>

      <label v-if="isDiskDelete" class="confirm-check">
        <input v-model="backupConfirmed" type="checkbox" :disabled="busy || !scan?.canDelete" />
        <span>{{ confirmText }}</span>
      </label>

      <label v-if="isDiskDelete" class="confirm-field">
        <span>请输入项目名称「{{ projectName }}」以确认。</span>
        <input
          v-model="projectNameInput"
          :disabled="busy || !scan?.canDelete"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <label v-if="isDiskDelete" class="confirm-field">
        <span>请输入「{{ requiredPhrase }}」。</span>
        <input
          v-model="deletePhraseInput"
          :disabled="busy || !scan?.canDelete"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

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
          :class="isDiskDelete ? 'danger-button' : 'remove-button'"
          type="button"
          :disabled="busy || !canSubmit"
          @click="emit('confirm')"
        >
          {{ confirmButtonText }}
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
  width: min(100%, 680px);
  max-height: min(92vh, 760px);
  overflow: auto;
  padding: var(--panel-padding);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.26);
}

header,
.confirm-field,
.danger-summary {
  display: grid;
  gap: var(--space-2);
}

.eyebrow,
h2,
p,
ul,
dl,
dd {
  margin: 0;
}

.eyebrow {
  color: #6b7280;
  font-size: var(--font-sm);
  font-weight: 700;
}

.eyebrow.danger {
  color: #b42318;
}

h2 {
  color: var(--color-heading);
  font-size: 18px;
  line-height: 1.3;
}

header p,
.danger-summary p,
.pending-summary p,
.confirm-field span,
.confirm-check span,
dt {
  color: #5b6472;
  line-height: 1.5;
}

.danger-summary {
  padding: var(--space-3);
  border: 1px solid #f0c6bd;
  border-radius: var(--radius-sm);
  background: #fffafa;
}

.danger-summary strong {
  color: var(--color-heading);
}

.pending-summary {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid #d7dee8;
  border-radius: var(--radius-sm);
  background: #f8fafc;
}

.pending-summary strong {
  color: var(--color-heading);
}

dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
}

dl div {
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

dt {
  font-size: 12px;
}

dd {
  color: var(--color-heading);
  font-size: var(--font-sm);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.entry-preview {
  display: grid;
  gap: 4px;
  max-height: 150px;
  overflow: auto;
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-7);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: #374151;
  font-size: var(--font-sm);
  line-height: 1.5;
}

.warning-text {
  color: #9a3412;
}

.confirm-check {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.confirm-check input {
  width: 16px;
  height: 16px;
  margin-top: 3px;
}

.confirm-field input {
  width: 100%;
  min-height: var(--control-md);
  padding: 0 var(--space-3);
  border: 1px solid #c3ccd8;
  border-radius: var(--radius-sm);
  color: var(--color-heading);
  font: inherit;
}

.confirm-field input:focus {
  outline: none;
  border-color: #b42318;
  box-shadow: 0 0 0 3px rgba(180, 35, 24, 0.12);
}

.error-message {
  margin: 0;
  padding: var(--space-3);
  border: 1px solid #f0b8aa;
  border-radius: var(--radius-sm);
  color: #b42318;
  line-height: 1.5;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}

.secondary-button,
.danger-button,
.remove-button {
  min-height: var(--control-md);
  padding: 0 var(--space-4);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--font-sm);
  font-weight: 700;
  cursor: pointer;
}

.secondary-button {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
}

.danger-button {
  border: 1px solid #b42318;
  background: #b42318;
  color: #ffffff;
}

.remove-button {
  border: 1px solid #c2410c;
  background: #c2410c;
  color: #ffffff;
}

button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

@media (max-width: 680px) {
  dl {
    grid-template-columns: 1fr;
  }
}
</style>
