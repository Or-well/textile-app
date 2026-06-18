<script setup lang="ts">
import { ref } from "vue";
import { openProject } from "../services/project";

const projectName = ref("");
const isOpening = ref(false);
const errorMessage = ref("");

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
</script>

<template>
  <main class="home-page">
    <section class="workspace-panel">
      <p class="eyebrow">本地汉化协作工具</p>
      <h1>打开项目</h1>
      <p class="summary">选择本地项目文件夹后，可以读取项目配置并继续工作。</p>

      <button
        class="open-button"
        type="button"
        :disabled="isOpening"
        @click="handleOpenProject"
      >
        {{ isOpening ? "正在打开..." : "打开项目文件夹" }}
      </button>

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

.open-button {
  min-height: 44px;
  padding: 0 18px;
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
