import { isTauriRuntime } from "../utils/tauriRuntime";
import type { OpenedProject } from "./project";

async function invokeTauriCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");

  return invoke<T>(command, args);
}

export async function openProjectLocation(project: OpenedProject): Promise<void> {
  if (project.storageKind === "packed") {
    throw new Error(
      "当前打开的是 Textile 项目文件（.hproj），没有可直接打开的本地项目文件夹。请先导入为本地项目文件夹。",
    );
  }

  const nativePath = project.root.nativePath;

  if (!nativePath) {
    throw new Error(
      isTauriRuntime()
        ? "当前项目没有记录系统路径，请重新用桌面版打开项目文件夹。"
        : "当前 Web/PWA 环境无法获取项目系统路径，请在系统文件管理器中手动打开。",
    );
  }

  if (!isTauriRuntime()) {
    throw new Error("当前运行环境不能打开系统文件管理器。");
  }

  await invokeTauriCommand<void>("open_project_directory_path", {
    rootPath: nativePath,
  });
}
