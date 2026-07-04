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
import {
  getAppUpdateStatusMessage,
  getDesktopUpdateActionLabel,
  getPwaRefreshTitle,
} from "../services/appUpdatePresentation";

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
    updateState.value.status === "update-available" ||
    (updateState.value.platform === "desktop" &&
      [
        "downloading",
        "downloaded",
        "waiting-for-safe-state",
        "installing",
        "restarting",
      ].includes(updateState.value.status))
  );
});

const isDesktop = computed(() => updateState.value.platform === "desktop");
const releaseNotes = computed(() => updateState.value.latest?.notes ?? []);
const latestVersionText = computed(() =>
  updateState.value.latest ? `v${updateState.value.latest.latest_version}` : "",
);
const currentVersionText = computed(() => `v${updateState.value.currentVersion}`);
const downloadUrlConfigured = computed(() =>
  hasConfiguredDownloadUrl(updateState.value.latest?.download_url),
);
const refreshMessage = computed(() =>
  getAppUpdateStatusMessage(updateState.value),
);
const pwaRefreshTitle = computed(() => getPwaRefreshTitle(updateState.value));
const desktopActionLabel = computed(() =>
  getDesktopUpdateActionLabel(updateState.value),
);
const desktopActionDisabled = computed(
  () =>
    ["downloading", "installing", "restarting"].includes(
      updateState.value.status,
    ) ||
    (updateState.value.desktopUpdateDownloaded &&
      !updateState.value.canApplyUpdate),
);
const pwaActionDisabled = computed(
  () =>
    updateState.value.status === "refreshing" ||
    !updateState.value.canApplyUpdate,
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
        <p class="notice-title">{{ pwaRefreshTitle }}</p>
        <p class="notice-text">{{ refreshMessage }}</p>
      </div>

      <div class="notice-actions">
        <button
          class="primary-button"
          type="button"
          :disabled="pwaActionDisabled"
          @click="handleInstallUpdate"
        >
          刷新并应用
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
        <p v-if="!isDesktop && !downloadUrlConfigured" class="notice-source">
          未配置发布地址
        </p>
        <p
          v-if="isDesktop && updateState.desktopUpdateDownloaded"
          class="notice-source"
        >
          {{ refreshMessage }}
        </p>
        <div
          v-if="isDesktop && updateState.status === 'downloading'"
          class="download-progress"
        >
          <div
            class="download-progress__fill"
            :style="{ width: `${updateState.downloadProgress}%` }"
          />
        </div>

        <div v-if="releaseNotes.length" class="release-notes">
          <p>更新内容：</p>
          <ul>
            <li v-for="note in releaseNotes" :key="note">{{ note }}</li>
          </ul>
        </div>
      </div>

      <div class="notice-actions">
        <button
          v-if="isDesktop"
          class="primary-button"
          type="button"
          :disabled="desktopActionDisabled"
          @click="handleInstallUpdate"
        >
          {{ desktopActionLabel }}
        </button>
        <button
          v-else
          class="primary-button"
          type="button"
          :disabled="!downloadUrlConfigured"
          @click="handleOpenDownloadPage"
        >
          {{ downloadUrlConfigured ? "查看下载页" : "未配置发布地址" }}
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="updateState.status === 'installing' || updateState.status === 'restarting'"
          @click="handleDismiss"
        >
          稍后
        </button>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.update-notice {
  position: fixed;
  right: var(--space-6);
  bottom: var(--space-6);
  z-index: 30;
  display: grid;
  gap: var(--space-3);
  width: min(340px, calc(100vw - 32px));
  padding: var(--panel-padding-compact);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.16);
}

.notice-content,
.release-notes {
  display: grid;
  gap: var(--space-2);
}

.notice-title,
.notice-text,
.notice-source,
.release-notes p,
.release-notes ul {
  margin: 0;
}

.notice-title {
  color: var(--color-heading);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
}

.notice-text,
.notice-source,
.release-notes {
  color: var(--color-muted);
  font-size: var(--font-sm);
  line-height: 1.5;
}

.notice-source {
  color: var(--color-muted);
}

.release-notes ul {
  padding-left: var(--space-5);
}

.notice-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.download-progress {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #e5e7eb;
}

.download-progress__fill {
  height: 100%;
  border-radius: inherit;
  background: #2f6f73;
  transition: width 160ms ease;
}

.primary-button,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--control-sm);
  padding: 0 var(--space-3);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--font-sm);
  font-weight: 700;
  cursor: pointer;
}

.primary-button {
  border: 1px solid var(--color-brand);
  background: var(--color-brand);
  color: #ffffff;
}

.secondary-button {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
}

.primary-button:hover {
  background: var(--color-brand-strong);
}

.secondary-button:hover {
  border-color: #9aa8b8;
  background: var(--color-surface-muted);
}

@media (max-width: 680px) {
  .update-notice {
    right: 16px;
    bottom: 16px;
  }
}
</style>
