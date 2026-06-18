<script setup lang="ts">
import { computed, ref } from "vue";
import type { Member, Task } from "../model/types";
import { exportChangePackage, setChangesProjectRoot } from "../services/changes";
import { getCurrentUser, setCurrentUser } from "../services/permissions";
import { openProject } from "../services/project";
import { loadTasks, setTasksProjectRoot } from "../services/tasks";

const projectName = ref("");
const members = ref<Member[]>([]);
const tasks = ref<Task[]>([]);
const selectedUserId = ref(getCurrentUser()?.id ?? "");
const selectedTaskId = ref("");
const isLoading = ref(false);
const isExporting = ref(false);
const errorMessage = ref("");
const message = ref("");

const selectedUser = computed(
  () => members.value.find((member) => member.id === selectedUserId.value) ?? null,
);

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function handleOpenProject() {
  isLoading.value = true;
  errorMessage.value = "";
  message.value = "";

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
    }

    setChangesProjectRoot(project.root);
    setTasksProjectRoot(project.root);
    tasks.value = await loadTasks();
    selectedTaskId.value = tasks.value[0]?.id ?? "";
  } catch (error) {
    projectName.value = "";
    members.value = [];
    tasks.value = [];
    selectedTaskId.value = "";

    if (error instanceof DOMException && error.name === "AbortError") {
      errorMessage.value = "没有打开项目文件夹。你可以重新点击按钮选择项目。";
    } else if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = "导出准备失败。请确认选择的是项目根目录。";
    }
  } finally {
    isLoading.value = false;
  }
}

function handleSelectUser() {
  if (selectedUser.value) {
    setCurrentUser(selectedUser.value);
  }
}

async function handleExportChanges() {
  if (!selectedUserId.value || !selectedTaskId.value) {
    errorMessage.value = "请先选择用户和任务。";
    return;
  }

  isExporting.value = true;
  errorMessage.value = "";
  message.value = "";

  try {
    const result = await exportChangePackage(
      selectedUserId.value,
      selectedTaskId.value,
    );

    downloadBlob(result.blob, result.fileName);
    message.value = `已导出修改包：${result.fileName}`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "导出修改包失败。请稍后再试。";
  } finally {
    isExporting.value = false;
  }
}
</script>

<template>
  <main class="import-export-page">
    <section class="export-panel">
      <div class="page-header">
        <div>
          <p class="eyebrow">导入 / 导出</p>
          <h1>{{ projectName || "导出修改包" }}</h1>
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

      <div v-if="projectName" class="form-grid">
        <label>
          <span>当前用户</span>
          <select v-model="selectedUserId" @change="handleSelectUser">
            <option
              v-for="member in members"
              :key="member.id"
              :value="member.id"
            >
              {{ member.name }}
            </option>
          </select>
        </label>

        <label>
          <span>任务</span>
          <select v-model="selectedTaskId">
            <option v-for="task in tasks" :key="task.id" :value="task.id">
              {{ task.title }}
            </option>
          </select>
        </label>

        <button
          class="export-button"
          type="button"
          :disabled="isExporting || !selectedUserId || !selectedTaskId"
          @click="handleExportChanges"
        >
          {{ isExporting ? "正在导出..." : "导出我的修改" }}
        </button>
      </div>

      <p v-else-if="!isLoading && !errorMessage" class="empty-state">
        请打开项目文件夹，选择用户和任务后导出修改。
      </p>
    </section>
  </main>
</template>

<style scoped>
.import-export-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px;
  background: #f6f7f9;
  color: #1f2937;
}

.export-panel {
  width: min(100%, 720px);
  padding: 28px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.page-header {
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

h1,
p {
  margin: 0;
}

h1 {
  font-size: 30px;
  line-height: 1.2;
}

.open-button,
.export-button {
  min-height: 42px;
  padding: 0 16px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: #ffffff;
  font-size: 15px;
  cursor: pointer;
}

button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.error-message,
.message,
.empty-state {
  margin-top: 22px;
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

.form-grid {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}

label {
  display: grid;
  gap: 8px;
}

label span {
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

.export-button {
  justify-self: start;
}

@media (max-width: 680px) {
  .page-header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
