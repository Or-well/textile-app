<script setup lang="ts">
import { computed, ref } from "vue";
import type { Member } from "../model/types";
import { getCurrentUser, setCurrentUser } from "../services/permissions";
import { openProject } from "../services/project";

const members = ref<Member[]>([]);
const selectedUserId = ref(getCurrentUser()?.id ?? "");
const projectName = ref("");
const isLoading = ref(false);
const message = ref("");
const errorMessage = ref("");

const selectedUser = computed(
  () => members.value.find((member) => member.id === selectedUserId.value) ?? null,
);

async function handleOpenProject() {
  isLoading.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const project = await openProject();
    const currentUser = getCurrentUser();

    projectName.value = project.config.name;
    members.value = project.members.filter((member) => member.active);
    selectedUserId.value =
      members.value.find((member) => member.id === currentUser?.id)?.id ??
      members.value[0]?.id ??
      "";

    if (selectedUser.value) {
      setCurrentUser(selectedUser.value);
      message.value = `当前用户：${selectedUser.value.name}`;
    }
  } catch (error) {
    members.value = [];
    selectedUserId.value = "";
    setCurrentUser(null);

    if (error instanceof DOMException && error.name === "AbortError") {
      errorMessage.value = "没有打开项目文件夹。你可以重新点击按钮选择项目。";
    } else if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = "成员列表加载失败。请确认选择的是项目根目录。";
    }
  } finally {
    isLoading.value = false;
  }
}

function handleSelectUser() {
  if (!selectedUser.value) {
    setCurrentUser(null);
    message.value = "";
    return;
  }

  setCurrentUser(selectedUser.value);
  message.value = `当前用户：${selectedUser.value.name}`;
}
</script>

<template>
  <main class="settings-page">
    <section class="settings-panel">
      <div class="settings-header">
        <div>
          <p class="eyebrow">项目设置</p>
          <h1>{{ projectName || "选择当前用户" }}</h1>
        </div>

        <button
          class="open-button"
          type="button"
          :disabled="isLoading"
          @click="handleOpenProject"
        >
          {{ isLoading ? "正在加载..." : "打开项目文件夹" }}
        </button>
      </div>

      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
      <p v-if="message" class="message">{{ message }}</p>

      <label v-if="members.length > 0" class="user-field">
        <span>当前用户</span>
        <select v-model="selectedUserId" @change="handleSelectUser">
          <option
            v-for="member in members"
            :key="member.id"
            :value="member.id"
          >
            {{ member.name }}（{{ member.roles.join("、") }}）
          </option>
        </select>
      </label>

      <p v-else-if="!isLoading && !errorMessage" class="empty-state">
        请打开项目文件夹，选择当前使用者。
      </p>
    </section>
  </main>
</template>

<style scoped>
.settings-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px;
  background: #f6f7f9;
  color: #1f2937;
}

.settings-panel {
  width: min(100%, 680px);
  padding: 28px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #5b6472;
  font-size: 14px;
}

h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.2;
}

.open-button {
  min-height: 42px;
  padding: 0 16px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: #ffffff;
  font-size: 15px;
  cursor: pointer;
}

.open-button:disabled {
  cursor: wait;
  opacity: 0.72;
}

.error-message,
.message,
.empty-state {
  margin: 22px 0 0;
  line-height: 1.7;
}

.error-message {
  color: #b42318;
}

.message {
  color: #166534;
}

.empty-state {
  color: #4b5563;
}

.user-field {
  display: grid;
  gap: 8px;
  margin-top: 22px;
}

.user-field span {
  color: #5b6472;
  font-size: 14px;
}

select {
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid #c8d0dc;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font: inherit;
}
</style>
