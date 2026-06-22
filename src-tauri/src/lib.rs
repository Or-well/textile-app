use std::{
    collections::HashMap,
    fs::File,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use tauri::{path::BaseDirectory, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedFileSaveResult {
    saved: bool,
    file_name: String,
    path: Option<String>,
    reason: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedFileSaveSessionResult {
    saved: bool,
    save_id: Option<String>,
    file_name: String,
    path: Option<String>,
    reason: Option<String>,
}

struct PendingGeneratedFileSave {
    file: File,
    file_name: String,
    path: PathBuf,
}

#[derive(Default)]
struct GeneratedFileSaveState {
    next_id: AtomicU64,
    pending: Mutex<HashMap<String, PendingGeneratedFileSave>>,
}

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

fn sanitize_suggested_file_name(file_name: &str) -> String {
    let sanitized = file_name
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>()
        .trim_matches([' ', '.'])
        .to_string();

    if sanitized.is_empty() {
        "textile-export.bin".to_string()
    } else {
        sanitized
    }
}

fn begin_generated_file_save_blocking(
    app: tauri::AppHandle,
    file_name: String,
    save_id: String,
) -> Result<
    (
        GeneratedFileSaveSessionResult,
        Option<PendingGeneratedFileSave>,
    ),
    String,
> {
    let suggested_file_name = sanitize_suggested_file_name(&file_name);
    let selected_path = app
        .dialog()
        .file()
        .set_title("保存 Textile 生成文件")
        .set_file_name(suggested_file_name.clone())
        .blocking_save_file();

    let Some(selected_path) = selected_path else {
        return Ok((
            GeneratedFileSaveSessionResult {
                saved: false,
                save_id: None,
                file_name: suggested_file_name,
                path: None,
                reason: Some("文件保存已取消。".to_string()),
            },
            None,
        ));
    };

    let path = selected_path
        .into_path()
        .map_err(|error| format!("无法确认保存路径：{error}"))?;
    let file = File::create(&path).map_err(|error| format!("文件保存失败：{error}"))?;
    let saved_file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&suggested_file_name)
        .to_string();

    Ok((
        GeneratedFileSaveSessionResult {
            saved: true,
            save_id: Some(save_id),
            file_name: saved_file_name.clone(),
            path: Some(path.to_string_lossy().to_string()),
            reason: None,
        },
        Some(PendingGeneratedFileSave {
            file,
            file_name: saved_file_name,
            path,
        }),
    ))
}

fn lock_pending_saves(
    state: &GeneratedFileSaveState,
) -> Result<std::sync::MutexGuard<'_, HashMap<String, PendingGeneratedFileSave>>, String> {
    state
        .pending
        .lock()
        .map_err(|_| "保存任务状态不可用。".to_string())
}

#[tauri::command]
fn open_manual_pdf(app: tauri::AppHandle) -> Result<(), String> {
    let manual_path = candidate_manual_paths(&app)
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "内置用户手册 manual.pdf 不存在。".to_string())?;

    app.opener()
        .open_path(manual_path.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("无法打开内置用户手册：{error}"))
}

#[tauri::command]
async fn begin_generated_file_save(
    app: tauri::AppHandle,
    state: State<'_, GeneratedFileSaveState>,
    file_name: String,
) -> Result<GeneratedFileSaveSessionResult, String> {
    let save_id = state.next_id.fetch_add(1, Ordering::Relaxed).to_string();
    let save_id_for_task = save_id.clone();
    let (result, pending_save) = tauri::async_runtime::spawn_blocking(move || {
        begin_generated_file_save_blocking(app, file_name, save_id_for_task)
    })
    .await
    .map_err(|error| format!("文件保存任务失败：{error}"))??;

    if let Some(pending_save) = pending_save {
        lock_pending_saves(&state)?.insert(save_id, pending_save);
    }

    Ok(result)
}

#[tauri::command]
fn append_generated_file_chunk(
    state: State<'_, GeneratedFileSaveState>,
    save_id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let mut pending_saves = lock_pending_saves(&state)?;
    let pending_save = pending_saves
        .get_mut(&save_id)
        .ok_or_else(|| "文件保存任务不存在或已结束。".to_string())?;

    pending_save
        .file
        .write_all(&bytes)
        .map_err(|error| format!("文件保存失败：{error}"))
}

#[tauri::command]
fn finish_generated_file_save(
    state: State<'_, GeneratedFileSaveState>,
    save_id: String,
) -> Result<GeneratedFileSaveResult, String> {
    let mut pending_save = lock_pending_saves(&state)?
        .remove(&save_id)
        .ok_or_else(|| "文件保存任务不存在或已结束。".to_string())?;

    pending_save
        .file
        .flush()
        .map_err(|error| format!("文件保存失败：{error}"))?;
    pending_save
        .file
        .sync_all()
        .map_err(|error| format!("文件保存失败：{error}"))?;

    Ok(GeneratedFileSaveResult {
        saved: true,
        file_name: pending_save.file_name,
        path: Some(pending_save.path.to_string_lossy().to_string()),
        reason: None,
    })
}

#[tauri::command]
fn abort_generated_file_save(
    state: State<'_, GeneratedFileSaveState>,
    save_id: String,
) -> Result<(), String> {
    let pending_save = lock_pending_saves(&state)?.remove(&save_id);

    if let Some(pending_save) = pending_save {
        drop(pending_save.file);
        let _ = std::fs::remove_file(pending_save.path);
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(GeneratedFileSaveState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
        .invoke_handler(tauri::generate_handler![
            open_manual_pdf,
            begin_generated_file_save,
            append_generated_file_chunk,
            finish_generated_file_save,
            abort_generated_file_save
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
