import { isTauriRuntime } from "./tauriUpdateAdapter";

const MANUAL_PDF_URL = "/manual.pdf";

function openManualInBrowser(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const manualWindow = window.open(MANUAL_PDF_URL, "_blank");
  if (!manualWindow) {
    return false;
  }

  manualWindow.opener = null;
  return true;
}

export async function openUserManual(): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");

      await invoke("open_manual_pdf");
      return;
    } catch {
      if (openManualInBrowser()) {
        return;
      }

      throw new Error("无法打开内置用户手册。请确认 manual.pdf 已随程序打包。");
    }
  }

  if (!openManualInBrowser()) {
    throw new Error("浏览器阻止打开用户手册，请允许 Textile 打开新标签页。");
  }
}
