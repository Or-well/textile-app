<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  memberName: string;
  busy?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

const riskConfirmed = ref(false);
const memberNameInput = ref("");
const canSubmit = computed(
  () => riskConfirmed.value && memberNameInput.value === props.memberName,
);
</script>

<template>
  <section
    class="dialog-backdrop"
    role="presentation"
    @click.self="!busy && emit('cancel')"
  >
    <article
      class="dialog-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-member-title"
    >
      <header>
        <p class="eyebrow">危险操作</p>
        <h2 id="delete-member-title">永久删除成员“{{ memberName }}”</h2>
        <p>此操作无法从成员管理界面撤销。需要恢复时，只能使用删除前的项目备份。</p>
      </header>

      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

      <section class="danger-summary">
        <strong>将删除</strong>
        <ul>
          <li>该成员在 members.json 中的账户记录。</li>
          <li>members.json 中保存的密码哈希、密码盐、角色、个人权限和公钥。</li>
          <li>当前应用内已加载的该成员私钥。</li>
        </ul>
        <strong>不会删除</strong>
        <ul>
          <li>历史译文、批注、任务和审计日志中的成员 ID。</li>
          <li>成员自行保存在磁盘或其他设备上的私钥文件。</li>
        </ul>
      </section>

      <label class="confirm-check">
        <input v-model="riskConfirmed" type="checkbox" :disabled="busy" />
        <span>我理解此操作无法通过重新启用恢复，并已确认不再需要该成员账户。</span>
      </label>

      <label class="confirm-field">
        <span>请输入成员名「{{ memberName }}」以确认。</span>
        <input
          v-model="memberNameInput"
          :disabled="busy"
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
          {{ busy ? "正在删除..." : "永久删除成员" }}
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

.dialog-panel,
header,
.danger-summary,
.confirm-field {
  display: grid;
  gap: 12px;
}

.dialog-panel {
  width: min(100%, 640px);
  max-height: min(92vh, 760px);
  overflow: auto;
  padding: 22px;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.26);
}

.eyebrow,
h2,
p,
ul {
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
.confirm-field span,
.confirm-check span {
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

.danger-summary ul {
  display: grid;
  gap: 5px;
  padding-left: 22px;
  color: #374151;
  font-size: 13px;
  line-height: 1.6;
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
</style>
