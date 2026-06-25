<script setup lang="ts">
const props = defineProps<{
  canCreateKey: boolean;
  isCreatingKey: boolean;
  errorMessage: string;
}>();

const emit = defineEmits<{
  createKey: [];
  continueExport: [];
  cancel: [];
}>();
</script>

<template>
  <section
    class="dialog-backdrop"
    role="presentation"
    @click.self="!props.isCreatingKey && emit('cancel')"
  >
    <article
      class="reminder-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="建议先登记负责人公钥"
    >
      <header class="dialog-header">
        <div>
          <p class="eyebrow">项目备份</p>
          <h2>建议先登记负责人公钥</h2>
        </div>
        <button
          class="secondary-button"
          type="button"
          :disabled="props.isCreatingKey"
          @click="emit('cancel')"
        >
          取消
        </button>
      </header>

      <div class="dialog-body">
        <p>当前项目要求协作包签名，但当前发布负责人还没有登记有效身份公钥。</p>
        <p>
          如果这份 .hproj 会分发给成员，建议先创建负责人身份密钥，让项目包包含后续项目更新可验证的公钥。
        </p>
        <p>如果只是本机备份，可以继续导出。</p>

        <p v-if="props.errorMessage" class="error-message">
          {{ props.errorMessage }}
        </p>
        <p v-if="!props.canCreateKey" class="field-help">
          当前成员没有生成身份密钥的权限，可以继续导出备份，或联系负责人处理。
        </p>

        <div class="dialog-actions">
          <button
            class="primary-button"
            type="button"
            :disabled="props.isCreatingKey || !props.canCreateKey"
            @click="emit('createKey')"
          >
            {{ props.isCreatingKey ? "正在创建..." : "先创建负责人身份密钥" }}
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="props.isCreatingKey"
            @click="emit('continueExport')"
          >
            仍然导出备份
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="props.isCreatingKey"
            @click="emit('cancel')"
          >
            取消
          </button>
        </div>
      </div>
    </article>
  </section>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(15 23 42 / 0.46);
}

.reminder-dialog {
  width: min(560px, 100%);
  display: grid;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2937;
  box-shadow: 0 22px 55px rgb(15 23 42 / 0.22);
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid #e5e7eb;
}

.dialog-header div,
.dialog-body {
  display: grid;
  gap: 10px;
}

.eyebrow {
  margin: 0;
  color: #2f6f73;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
}

h2,
p {
  margin: 0;
}

h2 {
  font-size: 20px;
}

.dialog-body {
  padding: 18px 20px 20px;
  color: #4b5563;
  line-height: 1.7;
}

.dialog-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 6px;
}

.primary-button,
.secondary-button {
  min-height: 40px;
  padding: 0 14px;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.primary-button {
  border: 0;
  background: #2563eb;
  color: #ffffff;
  font-weight: 700;
}

.secondary-button {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #1f2937;
}

button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.error-message {
  color: #b42318;
}

.field-help {
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}
</style>
