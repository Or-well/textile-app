<script setup lang="ts">
import type { SigningKeyReadiness } from "../services/keyManager";

const props = defineProps<{
  readiness: Exclude<SigningKeyReadiness, "ready">;
  signingReason: string;
  canImportPrivateKey: boolean;
  canGenerateKey: boolean;
  isBusy: boolean;
  errorMessage: string;
}>();

const emit = defineEmits<{
  importKey: [file: File];
  generateKey: [];
  cancel: [];
}>();

const titleByReadiness: Record<Exclude<SigningKeyReadiness, "ready">, string> = {
  missing_public_key: "需要签名密钥",
  private_key_not_loaded: "需要导入私钥",
  revoked_key: "当前密钥已撤销",
};

function handleImportKey(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (file) {
    emit("importKey", file);
  }

  input.value = "";
}
</script>

<template>
  <section
    class="dialog-backdrop"
    role="presentation"
    @click.self="!props.isBusy && emit('cancel')"
  >
    <article
      class="signing-key-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="titleByReadiness[props.readiness]"
    >
      <header class="dialog-header">
        <div>
          <p class="eyebrow">导出修改包</p>
          <h2>{{ titleByReadiness[props.readiness] }}</h2>
        </div>
        <button
          class="secondary-button"
          type="button"
          :disabled="props.isBusy"
          @click="emit('cancel')"
        >
          取消
        </button>
      </header>

      <div class="dialog-body">
        <p>{{ props.signingReason }}，但当前成员还不能完成签名。</p>

        <p v-if="props.readiness === 'private_key_not_loaded'">
          项目里已经登记了你的公钥，但这台设备没有加载对应私钥。请优先导入负责人交给你的
          <code>member-key.json</code>，或你之前自己导出的私钥文件。
        </p>

        <p v-else-if="props.readiness === 'missing_public_key'">
          如果负责人已经把私钥文件交给你，可以直接导入；如果还没有密钥文件，可以现在生成新的签名密钥。
        </p>

        <p v-else>
          当前项目中你的公钥已被撤销，不能再使用同一把私钥签名。请导入负责人提供的新私钥文件，或生成新的签名密钥。
        </p>

        <p class="warning-text">
          私钥可以代表你签名修改包，只应保存在你自己的设备或私钥文件中，不会写入项目备份或修改包。
        </p>

        <p v-if="props.errorMessage" class="error-message">
          {{ props.errorMessage }}
        </p>

        <div class="action-list">
          <label
            :class="[
              'file-action',
              { disabled: props.isBusy || !props.canImportPrivateKey },
            ]"
          >
            <span>导入已有私钥文件</span>
            <input
              type="file"
              accept=".json,application/json"
              :disabled="props.isBusy || !props.canImportPrivateKey"
              @change="handleImportKey"
            />
          </label>
          <p v-if="!props.canImportPrivateKey" class="field-help">
            当前成员没有导入私钥文件的权限，请联系负责人处理。
          </p>

          <button
            class="secondary-button"
            type="button"
            :disabled="props.isBusy || !props.canGenerateKey"
            @click="emit('generateKey')"
          >
            {{
              props.readiness === "private_key_not_loaded"
                ? "生成新密钥并替换公钥"
                : "生成新的签名密钥"
            }}
          </button>
          <p v-if="props.readiness === 'private_key_not_loaded'" class="field-help">
            只有确认旧私钥无法取得时才使用这一项；生成后项目会登记新的公钥。
          </p>
          <p v-if="!props.canGenerateKey" class="field-help">
            当前成员没有生成签名密钥的权限。
          </p>
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

.signing-key-dialog {
  width: min(560px, 100%);
  display: grid;
  gap: 0;
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

.action-list {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px 12px;
}

.eyebrow,
.dialog-body p,
.field-help {
  margin: 0;
}

.eyebrow {
  color: #5b6472;
  font-size: 12px;
  font-weight: 700;
}

h2 {
  margin: 0;
  color: #111827;
  font-size: 20px;
  line-height: 1.25;
}

.dialog-body {
  padding: 18px 20px 20px;
  line-height: 1.65;
}

.warning-text {
  padding: 10px 12px;
  border: 1px solid #f3d5a7;
  border-radius: 6px;
  background: #fffbeb;
  color: #92400e;
}

.error-message {
  padding: 10px 12px;
  border: 1px solid #f0b8aa;
  border-radius: 6px;
  background: #fffafa;
  color: #b42318;
}

.file-action,
.secondary-button {
  justify-self: start;
}

.file-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 196px;
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid #2f6f73;
  border-radius: 6px;
  background: #2f6f73;
  color: #ffffff;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.file-action input {
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
}

.file-action.disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.secondary-button {
  box-sizing: border-box;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.action-list > .secondary-button {
  width: 196px;
  min-height: 44px;
  padding: 0 16px;
}

.secondary-button:hover:not(:disabled) {
  border-color: #9aa8b8;
  background: #f8fafb;
}

.secondary-button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.field-help {
  flex-basis: 100%;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}

code {
  padding: 2px 5px;
  border-radius: 5px;
  background: #eef2f7;
  color: #374151;
  font-size: 12px;
}

@media (max-width: 520px) {
  .action-list {
    display: grid;
  }

  .file-action,
  .action-list > .secondary-button {
    width: 100%;
  }
}
</style>
