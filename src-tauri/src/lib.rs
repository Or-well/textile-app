use std::{path::PathBuf, process::Command};

use tauri::{path::BaseDirectory, Manager};

fn candidate_manual_paths(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(path) = app.path().resolve("manual.pdf", BaseDirectory::Resource) {
        paths.push(path);
    }

    paths.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public")
            .join("manual.pdf"),
    );

    paths
}

fn open_path_with_system_viewer(path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", ""]);
        command.arg(path);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开内置用户手册：{error}"))
}

#[tauri::command]
fn open_manual_pdf(app: tauri::AppHandle) -> Result<(), String> {
    let manual_path = candidate_manual_paths(&app)
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "内置用户手册 manual.pdf 不存在。".to_string())?;

    open_path_with_system_viewer(&manual_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open_manual_pdf])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
