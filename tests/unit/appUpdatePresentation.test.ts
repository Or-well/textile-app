import { describe, expect, it } from "vitest";
import type { AppUpdateState } from "../../src/services/appUpdateTypes";
import {
  applyPendingUpdatePriority,
  getAppUpdateStatusMessage,
  getDesktopDownloadedMessage,
  getDesktopUpdateActionLabel,
  getPwaRefreshTitle,
} from "../../src/services/appUpdatePresentation";

function createUpdateState(
  overrides: Partial<AppUpdateState> = {},
): AppUpdateState {
  return {
    status: "up-to-date",
    currentVersion: "0.1.0",
    channel: "stable",
    platform: "web",
    sourceUrl: "/version.json",
    latest: {
      version: "0.1.0",
      latest_version: "0.1.0",
      build_id: "build-1",
      assets_hash: "hash-1",
      schema_version: 1,
      release_date: "2026-06-20",
      channel: "stable",
      critical: false,
      download_url: "",
      notes: [],
    },
    checkedAt: "2026-06-20T00:00:00.000Z",
    message: "当前已经是最新版本。",
    pwaRefreshReady: false,
    desktopUpdateDownloaded: false,
    canApplyUpdate: true,
    applyBlockedReason: "",
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    latestDownloadedAt: "",
    dismissedVersion: "",
    errorMessage: "",
    ...overrides,
  };
}

describe("PWA update presentation", () => {
  it("keeps the up-to-date message when no refresh is pending", () => {
    const state = createUpdateState();

    expect(getAppUpdateStatusMessage(state)).toBe("当前已经是最新版本。");
    expect(applyPendingUpdatePriority(state).status).toBe("up-to-date");
  });

  it("prioritizes a same-version pending build over an up-to-date check", () => {
    const state = createUpdateState({
      pwaRefreshReady: true,
      status: "up-to-date",
    });
    const effective = applyPendingUpdatePriority(state);

    expect(effective.status).toBe("ready-to-refresh");
    expect(effective.message).toContain("版本号已是最新");
    expect(effective.message).toContain("新的构建资源已准备好");
    expect(getPwaRefreshTitle(effective)).toBe("Textile 新构建已准备好");
  });

  it("retains the pending refresh when the latest check failed", () => {
    const state = createUpdateState({
      status: "failed",
      message: "检查更新失败。",
      errorMessage: "检查更新失败。",
      pwaRefreshReady: true,
      canApplyUpdate: false,
      applyBlockedReason: "存在未保存的译文，请先保存或放弃修改。",
    });
    const effective = applyPendingUpdatePriority(state);

    expect(effective.status).toBe("ready-to-refresh");
    expect(effective.message).toContain("存在未保存的译文");
    expect(effective.errorMessage).toBe("检查更新失败。");
  });

  it("uses new-version wording when the pending build has a newer version", () => {
    const state = createUpdateState({
      pwaRefreshReady: true,
      latest: {
        ...createUpdateState().latest!,
        version: "0.2.0",
        latest_version: "0.2.0",
      },
    });

    expect(getPwaRefreshTitle(state)).toBe("Textile 新版本已准备好");
    expect(getAppUpdateStatusMessage(state)).toContain("新版本资源已准备好");
  });
});

describe("desktop update presentation", () => {
  it("shows an actionable message when the download can be installed", () => {
    const state = createUpdateState({
      platform: "desktop",
      desktopUpdateDownloaded: true,
      canApplyUpdate: true,
    });
    const effective = applyPendingUpdatePriority(state);

    expect(effective.status).toBe("downloaded");
    expect(getDesktopDownloadedMessage(effective)).toBe(
      "更新已下载，可以安装并重启 Textile。",
    );
    expect(getDesktopUpdateActionLabel(effective)).toBe("安装并重启");
  });

  it("shows the blocking reason when installation must wait", () => {
    const state = createUpdateState({
      platform: "desktop",
      desktopUpdateDownloaded: true,
      canApplyUpdate: false,
      applyBlockedReason: "正在执行项目导出，完成后即可继续。",
    });
    const effective = applyPendingUpdatePriority(state);

    expect(effective.status).toBe("waiting-for-safe-state");
    expect(getDesktopDownloadedMessage(effective)).toBe(
      "正在执行项目导出，完成后即可继续。",
    );
    expect(getDesktopUpdateActionLabel(effective)).toBe("等待当前操作完成");
  });

  it("does not use refresh wording for a blocked desktop update", () => {
    const state = createUpdateState({
      platform: "desktop",
      desktopUpdateDownloaded: true,
      canApplyUpdate: false,
      applyBlockedReason: "存在未保存的项目设置，请先保存或放弃修改。",
    });

    expect(getAppUpdateStatusMessage(state)).not.toContain("刷新");
  });
});
