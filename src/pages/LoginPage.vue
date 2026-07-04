<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  projectName: string;
  errorMessage?: string;
  isSubmitting?: boolean;
}>();

const emit = defineEmits<{
  login: [memberName: string, password: string];
  backToProjects: [];
}>();

const memberName = ref("");
const password = ref("");

function handleSubmit() {
  emit("login", memberName.value, password.value);
}
</script>

<template>
  <main class="login-page">
    <section class="login-panel">
      <header class="login-header">
        <p class="eyebrow">Textile 项目登录</p>
        <h1>{{ props.projectName }}</h1>
        <p>请输入 Textile 项目成员名和密码。</p>
      </header>

      <form class="login-form" @submit.prevent="handleSubmit">
        <label>
          <span>成员名</span>
          <input
            v-model="memberName"
            autocomplete="username"
            autofocus
            :disabled="props.isSubmitting"
          />
        </label>

        <label>
          <span>密码</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            :disabled="props.isSubmitting"
          />
        </label>

        <p v-if="props.errorMessage" class="error-message">
          {{ props.errorMessage }}
        </p>

        <div class="login-actions">
          <button
            class="primary-button"
            type="submit"
            :disabled="props.isSubmitting"
          >
            {{ props.isSubmitting ? "正在登录..." : "登录" }}
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="props.isSubmitting"
            @click="emit('backToProjects')"
          >
            返回项目列表
          </button>
        </div>
      </form>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--space-8);
  background: var(--color-shell);
  color: var(--color-text);
}

.login-panel {
  width: min(100%, 440px);
  display: grid;
  gap: var(--space-7);
  padding: var(--space-8);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
}

.login-header,
.login-form {
  display: grid;
  gap: var(--space-4);
}

.eyebrow,
h1,
p {
  margin: 0;
}

.eyebrow {
  color: var(--color-muted);
  font-size: var(--font-sm);
  font-weight: 700;
}

h1 {
  color: var(--color-heading);
  font-size: 24px;
  line-height: 1.2;
}

.login-header p {
  color: var(--color-muted);
  line-height: 1.5;
}

label {
  display: grid;
  gap: var(--space-2);
}

label span {
  color: #374151;
  font-size: 14px;
  font-weight: 700;
}

input {
  min-height: var(--control-lg);
  padding: 0 var(--space-4);
  border: 1px solid #c3ccd8;
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}

input:focus {
  outline: none;
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

.error-message {
  padding: var(--space-3) var(--space-4);
  border: 1px solid #f0b8aa;
  border-radius: var(--radius-sm);
  background: #fffafa;
  color: #b42318;
  line-height: 1.5;
}

.login-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.primary-button,
.secondary-button {
  min-height: var(--control-md);
  padding: 0 var(--space-5);
  border-radius: var(--radius-sm);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.primary-button {
  border: 1px solid var(--color-brand);
  background: var(--color-brand);
  color: var(--color-surface);
}

.secondary-button {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
}

button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.64;
}
</style>
