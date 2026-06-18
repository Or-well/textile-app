<script setup lang="ts">
import { ref } from "vue";
import { openProject, openProjectFile } from "../services/project";

const projectName = ref("");
const isOpening = ref(false);
const isOpeningFile = ref(false);
const errorMessage = ref("");
const projectFileInput = ref<HTMLInputElement | null>(null);

async function handleOpenProject() {
  isOpening.value = true;
  errorMessage.value = "";

  try {
    const project = await openProject();
    projectName.value = project.config.name;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      errorMessage.value = "没有打开项目文件夹。你可以重新点击按钮选择项目。";
    } else if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = "打开项目失败。请确认选择的是项目根目录。";
    }
  } finally {
    isOpening.value = false;
  }
}

async function handleOpenProjectFile(file: File) {
  isOpeningFile.value = true;
  errorMessage.value = "";

  try {
    const project = await openProjectFile(file);
    projectName.value = project.config.name;
  } catch (error) {
    if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = "打开项目文件失败。请确认选择的是 .hproj 项目文件。";
    }
  } finally {
    isOpeningFile.value = false;
  }
}

function handleSelectProjectFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (file) {
    void handleOpenProjectFile(file);
  }

  input.value = "";
}
</script>

<template>
  <main class="home-page">
    <section class="workspace-panel">
      <p class="eyebrow">本地汉化协作工具</p>
      <h1>打开项目</h1>
      <p class="summary">选择本地项目文件夹后，可以读取项目配置并继续工作。</p>

      <div class="button-row">
        <button
          class="file-button"
          type="button"
          :disabled="isOpeningFile"
          @click="projectFileInput?.click()"
        >
          {{ isOpeningFile ? "正在打开..." : "打开项目文件" }}
        </button>
        <button
          class="open-button"
          type="button"
          :disabled="isOpening"
          @click="handleOpenProject"
        >
          {{ isOpening ? "正在打开..." : "打开项目文件夹" }}
        </button>
        <input
          ref="projectFileInput"
          class="hidden-file-input"
          type="file"
          accept=".hproj,application/zip"
          @change="handleSelectProjectFile"
        />
      </div>

      <a class="back-link" href="/projects">返回项目列表</a>

      <p v-if="projectName" class="project-name">当前项目：{{ projectName }}</p>
      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    </section>
  </main>
</template>

<style scoped>
.home-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
  background: #f6f7f9;
  color: #1f2937;
}

.workspace-panel {
  width: min(100%, 560px);
  padding: 32px;
  border: 1px solid #d7dde5;
  border-radius: 8px;
  background: #ffffff;
}

.eyebrow {
  margin: 0 0 8px;
  color: #5b6472;
  font-size: 14px;
}

h1 {
  margin: 0;
  font-size: 32px;
  line-height: 1.2;
}

.summary {
  margin: 12px 0 24px;
  color: #4b5563;
  line-height: 1.7;
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.open-button,
.file-button {
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 15px;
  cursor: pointer;
}

.open-button {
  border-color: #2563eb;
  background: #2563eb;
  color: #ffffff;
}

.file-button {
  border-color: #c8d0dc;
  background: #ffffff;
  color: #1f2937;
}

.open-button:disabled,
.file-button:disabled {
  cursor: wait;
  opacity: 0.72;
}

.hidden-file-input {
  display: none;
}

.back-link {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  margin-left: 10px;
  color: #2563eb;
  font-size: 14px;
  text-decoration: none;
}

.project-name,
.error-message {
  margin: 18px 0 0;
  line-height: 1.6;
}

.project-name {
  color: #166534;
}

.error-message {
  color: #b42318;
}
</style>
