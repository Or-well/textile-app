import type { AppUpdateState } from "./appUpdateTypes";

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function isSameVersion(state: AppUpdateState): boolean {
  return Boolean(
    state.latest &&
      normalizeVersion(state.latest.latest_version) ===
        normalizeVersion(state.currentVersion),
  );
}

export function hasPendingAppUpdate(state: AppUpdateState): boolean {
  return (
    state.pwaRefreshReady ||
    state.desktopUpdateDownloaded ||
    state.status === "waiting-for-safe-state"
  );
}

export function getPwaRefreshTitle(state: AppUpdateState): string {
  return isSameVersion(state)
    ? "Textile 新构建已准备好"
    : "Textile 新版本已准备好";
}

export function getDesktopDownloadedMessage(state: AppUpdateState): string {
  if (!state.desktopUpdateDownloaded) {
    return "";
  }

  return state.canApplyUpdate
    ? "更新已下载，可以安装并重启 Textile。"
    : state.applyBlockedReason || "更新已下载，等待当前操作完成。";
}

export function getDesktopUpdateActionLabel(state: AppUpdateState): string {
  if (state.status === "downloading") {
    return `下载中 ${state.downloadProgress}%`;
  }

  if (state.status === "installing") {
    return "正在安装...";
  }

  if (state.status === "restarting") {
    return "正在重启...";
  }

  if (state.desktopUpdateDownloaded) {
    return state.canApplyUpdate ? "安装并重启" : "等待当前操作完成";
  }

  return "下载更新";
}

export function getAppUpdateStatusMessage(state: AppUpdateState): string {
  if (state.status === "refreshing") {
    return "正在刷新到新版 Textile...";
  }

  if (state.status === "installing") {
    return "正在安装桌面更新，请勿关闭 Textile...";
  }

  if (state.status === "restarting") {
    return "更新安装完成，正在重新启动 Textile...";
  }

  if (state.pwaRefreshReady) {
    const readyMessage = isSameVersion(state)
      ? "版本号已是最新，新的构建资源已准备好。"
      : "Textile 新版本资源已准备好。";

    return state.canApplyUpdate
      ? `${readyMessage} 可以刷新应用。`
      : `${readyMessage} ${
          state.applyBlockedReason || "完成当前操作后即可刷新应用。"
        }`;
  }

  if (state.desktopUpdateDownloaded) {
    return getDesktopDownloadedMessage(state);
  }

  return state.message;
}

export function applyPendingUpdatePriority(
  state: AppUpdateState,
): AppUpdateState {
  if (
    state.status === "refreshing" ||
    state.status === "installing" ||
    state.status === "restarting"
  ) {
    return {
      ...state,
      message: getAppUpdateStatusMessage(state),
    };
  }

  if (state.pwaRefreshReady) {
    const nextState: AppUpdateState = {
      ...state,
      status: "ready-to-refresh",
    };

    return {
      ...nextState,
      message: getAppUpdateStatusMessage(nextState),
    };
  }

  if (state.desktopUpdateDownloaded) {
    const nextState: AppUpdateState = {
      ...state,
      status: state.canApplyUpdate ? "downloaded" : "waiting-for-safe-state",
    };

    return {
      ...nextState,
      message: getAppUpdateStatusMessage(nextState),
    };
  }

  return state;
}
