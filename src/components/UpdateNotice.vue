<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  dismissUpdate,
  getAppUpdateState,
  hasConfiguredDownloadUrl,
  installUpdate,
  openDownloadPage,
  subscribeAppUpdate,
  type AppUpdateState,
} from "../services/appUpdate";

const updateState = ref<AppUpdateState>(getAppUpdateState());
let unsubscribe: (() => void) | null = null;

const hasDismissedCurrentUpdate = computed(() => {
  if (updateState.value.pwaRefreshReady) {
    return updateState.value.dismissedVersion === "pwa-refresh";
  }

  return (
    updateState.value.latest?.latest_version !== undefined &&
    updateState.value.dismissedVersion === updateState.value.latest.latest_version
  );
});

const shouldShow = computed(() => {
  if (hasDismissedCurrentUpdate.value) {
    return false;
  }

  return (
    updateState.value.pwaRefreshReady ||
    updateState.value.status === "update-available"
  );
});

const releaseNotes = computed(() => updateState.value.latest?.notes ?? []);
const latestVersionText = computed(() =>
  updateState.value.latest ? `v${updateState.value.latest.latest_version}` : "",
);
const currentVersionText = computed(() => `v${updateState.value.currentVersion}`);
const downloadUrlConfigured = computed(() =>
  hasConfiguredDownloadUrl(updateState.value.latest?.download_url),
);
const refreshMessage = computed(
  () =>
    updateState.value.refreshBlockedReason ||
    "刷新后即可使用新版 Textile。",
);

function handleOpenDownloadPage(): void {
  openDownloadPage(updateState.value.latest?.download_url);
}

async function handleInstallUpdate(): Promise<void> {
  await installUpdate();
}

function handleDismiss(): void {
  dismissUpdate();
}

onMounted(() => {
  unsubscribe = subscribeAppUpdate((nextState) => {
    updateState.value = nextState;
  });
});

onBeforeUnmount(() => {
  unsubscribe?.();
});
</script>

<template>
  <aside v-if="shouldShow" class="update-notice" aria-live="polite">
    <template v-if="updateState.pwaRefreshReady">
      <div class="notice-content">
        <p class="notice-title">Textile 新版本已准备好</p>
        <p class="notice-text">{{ refreshMessage }}</p>
      </div>

      <div class="notice-actions">
        <button class="primary-button" type="button" @click="handleInstallUpdate">
          立即刷新
        </button>
        <button class="secondary-button" type="button" @click="handleDismiss">
          稍后
        </button>
      </div>
    </template>

    <template v-else>
      <div class="notice-content">
        <p class="notice-title">发现 Textile 新版本 {{ latestVersionText }}</p>
        <p class="notice-text">当前版本：{{ currentVersionText }}</p>
        <p class="notice-source">更新来源：{{ updateState.sourceUrl }}</p>
        <p v-if="!downloadUrlConfigured" class="notice-source">未配置发布地址</p>

        <div v-if="releaseNotes.length" class="release-notes">
          <p>更新内容：</p>
          <ul>
            <li v-for="note in releaseNotes" :key="note">{{ note }}</li>
          </ul>
        </div>
      </div>

      <div class="notice-actions">
        <button
          class="primary-button"
          type="button"
          :disabled="!downloadUrlConfigured"
          @click="handleOpenDownloadPage"
        >
          {{ downloadUrlConfigured ? "查看下载页" : "未配置发布地址" }}
        </button>
        <button class="secondary-button" type="button" @click="handleDismiss">
          稍后
        </button>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.update-notice {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 30;
  display: grid;
  gap: 12px;
  width: min(360px, calc(100vw - 32px));
  padding: 16px;
  border: 1px solid #c8d0dc;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2937;
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.16);
}

.notice-content,
.release-notes {
  display: grid;
  gap: 6px;
}

.notice-title,
.notice-text,
.notice-source,
.release-notes p,
.release-notes ul {
  margin: 0;
}

.notice-title {
  color: #111827;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.35;
}

.notice-text,
.notice-source,
.release-notes {
  color: #4b5563;
  font-size: 13px;
  line-height: 1.55;
}

.notice-source {
  color: #6b7280;
}

.release-notes ul {
  padding-left: 18px;
}

.notice-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.primary-button,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
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

.primary-button:hover {
  background: #255f62;
}

.secondary-button:hover {
  border-color: #9aa8b8;
  background: #f8fafb;
}

@media (max-width: 680px) {
  .update-notice {
    right: 16px;
    bottom: 16px;
  }
}
</style>
