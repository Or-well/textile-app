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
        <p class="eyebrow">项目登录</p>
        <h1>{{ props.projectName }}</h1>
        <p>请输入项目成员名和密码。</p>
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
  padding: 24px;
  background: #eef2f5;
  color: #1f2937;
}

.login-panel {
  width: min(100%, 440px);
  display: grid;
  gap: 22px;
  padding: 28px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
}

.login-header,
.login-form {
  display: grid;
  gap: 14px;
}

.eyebrow,
h1,
p {
  margin: 0;
}

.eyebrow {
  color: #5b6472;
  font-size: 13px;
  font-weight: 700;
}

h1 {
  color: #111827;
  font-size: 28px;
  line-height: 1.2;
}

.login-header p {
  color: #5b6472;
  line-height: 1.6;
}

label {
  display: grid;
  gap: 7px;
}

label span {
  color: #374151;
  font-size: 14px;
  font-weight: 700;
}

input {
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid #c3ccd8;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
}

input:focus {
  outline: none;
  border-color: #2f6f73;
  box-shadow: 0 0 0 3px rgba(47, 111, 115, 0.14);
}

.error-message {
  padding: 10px 12px;
  border: 1px solid #f0b8aa;
  border-radius: 6px;
  background: #fffafa;
  color: #b42318;
  line-height: 1.6;
}

.login-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.primary-button,
.secondary-button {
  min-height: 40px;
  padding: 0 15px;
  border-radius: 6px;
  font: inherit;
  font-weight: 700;
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

button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.64;
}
</style>
