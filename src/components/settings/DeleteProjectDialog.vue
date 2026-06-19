<script setup lang="ts">
import { computed, ref } from "vue";
import type { ProjectDeletionScan } from "../../services/projectDeletion";

const props = defineProps<{
  projectName: string;
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
const requiredPhrase = "移除项目";
const canSubmit = computed(
  () =>
    Boolean(props.scan?.canDelete) &&
    backupConfirmed.value &&
    projectNameInput.value === props.projectName &&
    deletePhraseInput.value === requiredPhrase,
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
        <p class="eyebrow">危险操作</p>
        <h2 id="delete-project-title">从启动页移除当前项目</h2>
        <p>
          此操作只会从最近项目移除、清除当前项目会话并返回项目启动页。磁盘文件不会被删除。
        </p>
        <p>
          当前版本不会自动删除磁盘上的项目文件。如需彻底删除，请确认备份后手动删除项目文件夹。
        </p>
      </header>

      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

      <section v-if="scan" class="danger-summary">
        <strong>{{ scan.canDelete ? "将移除本机记录" : "无法继续" }}</strong>
        <dl>
          <div>
            <dt>处理范围</dt>
            <dd>{{ scan.deleteTarget }}</dd>
          </div>
          <div>
            <dt>项目文件</dt>
            <dd>不会删除</dd>
          </div>
          <div>
            <dt>返回位置</dt>
            <dd>项目启动页</dd>
          </div>
        </dl>

        <ul class="entry-preview">
          <li v-for="entry in scan.entries" :key="entry">{{ entry }}</li>
        </ul>

        <p v-for="warning in scan.warnings" :key="warning" class="warning-text">
          {{ warning }}
        </p>
      </section>

      <section v-else class="danger-summary">
        <strong>正在检查项目目录...</strong>
        <p>检查通过后才能执行删除。</p>
      </section>

      <label class="confirm-check">
        <input v-model="backupConfirmed" type="checkbox" :disabled="busy || !scan?.canDelete" />
        <span>我理解此操作只移除本机记录，不删除磁盘文件。</span>
      </label>

      <label class="confirm-field">
        <span>请输入项目名称「{{ projectName }}」以确认。</span>
        <input
          v-model="projectNameInput"
          :disabled="busy || !scan?.canDelete"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <label class="confirm-field">
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
          class="danger-button"
          type="button"
          :disabled="busy || !canSubmit"
          @click="emit('confirm')"
        >
          {{ busy ? "正在移除..." : "移除项目记录" }}
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
  padding: 18px;
  background: rgba(15, 23, 42, 0.42);
}

.dialog-panel {
  display: grid;
  gap: 16px;
  width: min(100%, 680px);
  max-height: min(92vh, 760px);
  overflow: auto;
  padding: 22px;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.26);
}

header,
.confirm-field,
.danger-summary {
  display: grid;
  gap: 8px;
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
  color: #b42318;
  font-size: 13px;
  font-weight: 700;
}

h2 {
  color: #111827;
  font-size: 20px;
}

header p,
.danger-summary p,
.confirm-field span,
.confirm-check span,
dt {
  color: #5b6472;
  line-height: 1.6;
}

.danger-summary {
  padding: 12px;
  border: 1px solid #f0c6bd;
  border-radius: 8px;
  background: #fffafa;
}

.danger-summary strong {
  color: #111827;
}

dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

dl div {
  padding: 9px;
  border-radius: 6px;
  background: #ffffff;
}

dt {
  font-size: 12px;
}

dd {
  color: #111827;
  font-size: 14px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.entry-preview {
  display: grid;
  gap: 4px;
  max-height: 150px;
  overflow: auto;
  padding: 10px 10px 10px 26px;
  border-radius: 6px;
  background: #ffffff;
  color: #374151;
  font-size: 13px;
  line-height: 1.5;
}

.warning-text {
  color: #9a3412;
}

.confirm-check {
  display: flex;
  align-items: flex-start;
  gap: 9px;
}

.confirm-check input {
  width: 16px;
  height: 16px;
  margin-top: 3px;
}

.confirm-field input {
  width: 100%;
  min-height: 40px;
  padding: 0 11px;
  border: 1px solid #c3ccd8;
  border-radius: 6px;
  color: #111827;
  font: inherit;
}

.confirm-field input:focus {
  outline: none;
  border-color: #b42318;
  box-shadow: 0 0 0 3px rgba(180, 35, 24, 0.12);
}

.error-message {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #f0b8aa;
  border-radius: 6px;
  color: #b42318;
  line-height: 1.6;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}

.secondary-button,
.danger-button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 6px;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.secondary-button {
  border: 1px solid #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

.danger-button {
  border: 1px solid #b42318;
  background: #b42318;
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
