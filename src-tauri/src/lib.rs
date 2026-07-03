use std::{
    collections::HashMap,
    fs::{self, File},
    io::Write,
    path::{Component, Path, PathBuf},
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDirectorySelectionResult {
    selected: bool,
    path: Option<String>,
    name: Option<String>,
    reason: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectEntryStatus {
    exists: bool,
    kind: Option<String>,
}

#[derive(serde::Deserialize)]
struct ProjectIdentityFile {
    project_id: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDirectoryDeletionResult {
    deleted_path: String,
    file_count: usize,
    directory_count: usize,
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

fn safe_relative_project_path(relative_path: &str) -> Result<PathBuf, String> {
    let mut safe_path = PathBuf::new();

    for component in Path::new(relative_path).components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => safe_path.push(part),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("项目文件路径不正确，已阻止访问。".to_string());
            }
        }
    }

    Ok(safe_path)
}

fn canonical_project_root(root_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(root_path);

    if !root.is_dir() {
        return Err("项目文件夹不存在或不可访问。".to_string());
    }

    root.canonicalize()
        .map_err(|error| format!("无法确认项目文件夹路径：{error}"))
}

fn ensure_inside_project(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        Ok(())
    } else {
        Err("项目文件路径越界，已阻止访问。".to_string())
    }
}

fn ensure_existing_project_ancestor_inside(root: &Path, path: &Path) -> Result<(), String> {
    let mut current = Some(path);

    while let Some(candidate) = current {
        if candidate.exists() {
            let canonical_candidate = candidate
                .canonicalize()
                .map_err(|error| format!("无法确认项目目录路径：{error}"))?;

            return ensure_inside_project(root, &canonical_candidate);
        }

        current = candidate.parent();
    }

    Err("无法确认项目目录路径。".to_string())
}

fn resolve_existing_project_path(
    root_path: &str,
    relative_path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let root = canonical_project_root(root_path)?;
    let relative = safe_relative_project_path(relative_path)?;
    let path = root.join(relative);
    let canonical_path = path
        .canonicalize()
        .map_err(|_| "项目文件不存在。".to_string())?;

    ensure_inside_project(&root, &canonical_path)?;

    Ok((root, canonical_path))
}

fn resolve_project_write_file_path(
    root_path: &str,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let root = canonical_project_root(root_path)?;
    let relative = safe_relative_project_path(relative_path)?;

    if relative.as_os_str().is_empty() {
        return Err("项目文件路径不正确，无法写入。".to_string());
    }

    let path = root.join(relative);

    if path.exists() {
        let canonical_path = path
            .canonicalize()
            .map_err(|error| format!("无法确认项目文件路径：{error}"))?;

        ensure_inside_project(&root, &canonical_path)?;

        if canonical_path.is_dir() {
            return Err("目标路径是目录，无法写入文件。".to_string());
        }

        return Ok(canonical_path);
    }

    let parent = path
        .parent()
        .ok_or_else(|| "项目文件路径不正确，无法写入。".to_string())?;

    ensure_existing_project_ancestor_inside(&root, parent)?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建项目目录：{error}"))?;

    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("无法确认项目目录路径：{error}"))?;

    ensure_inside_project(&root, &canonical_parent)?;

    Ok(path)
}

fn resolve_project_directory_path(
    root_path: &str,
    relative_path: &str,
    create: bool,
) -> Result<PathBuf, String> {
    let root = canonical_project_root(root_path)?;
    let relative = safe_relative_project_path(relative_path)?;
    let path = root.join(relative);

    if create {
        ensure_existing_project_ancestor_inside(&root, &path)?;
        fs::create_dir_all(&path).map_err(|error| format!("无法创建项目目录：{error}"))?;
    }

    let canonical_path = path
        .canonicalize()
        .map_err(|_| "项目目录不存在。".to_string())?;

    ensure_inside_project(&root, &canonical_path)?;

    if !canonical_path.is_dir() {
        return Err("目标路径不是项目目录。".to_string());
    }

    Ok(canonical_path)
}

fn file_name_for_path(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Textile 项目")
        .to_string()
}

fn assert_native_project_directory(root_path: &str, project_id: &str) -> Result<PathBuf, String> {
    let root = canonical_project_root(root_path)?;
    let project_json_path = root.join("project.json");
    let members_json_path = root.join("members.json");
    let entries_path = root.join("entries");

    if !project_json_path.is_file() || !members_json_path.is_file() || !entries_path.is_dir() {
        return Err("目标目录不像 Textile 项目文件夹，已阻止删除。".to_string());
    }

    let project_text = fs::read_to_string(&project_json_path)
        .map_err(|error| format!("无法读取项目配置，已阻止删除：{error}"))?;
    let project_identity: ProjectIdentityFile = serde_json::from_str(&project_text)
        .map_err(|error| format!("项目配置格式不正确，已阻止删除：{error}"))?;

    if project_identity.project_id != project_id {
        return Err("目标目录中的项目 ID 与当前项目不一致，已阻止删除。".to_string());
    }

    Ok(root)
}

fn count_directory_entries(path: &Path) -> Result<(usize, usize), String> {
    let mut file_count = 0;
    let mut directory_count = 0;

    for entry in fs::read_dir(path).map_err(|error| format!("项目目录读取失败：{error}"))?
    {
        let entry = entry.map_err(|error| format!("项目目录读取失败：{error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("项目目录读取失败：{error}"))?;

        if file_type.is_dir() {
            directory_count += 1;
            let (child_files, child_directories) = count_directory_entries(&entry.path())?;
            file_count += child_files;
            directory_count += child_directories;
        } else {
            file_count += 1;
        }
    }

    Ok((file_count, directory_count))
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

#[tauri::command]
async fn pick_project_directory(
    app: tauri::AppHandle,
) -> Result<ProjectDirectorySelectionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected_path = app
            .dialog()
            .file()
            .set_title("选择 Textile 项目文件夹")
            .blocking_pick_folder();

        let Some(selected_path) = selected_path else {
            return Ok(ProjectDirectorySelectionResult {
                selected: false,
                path: None,
                name: None,
                reason: Some("文件夹选择已取消。".to_string()),
            });
        };

        let path = selected_path
            .into_path()
            .map_err(|error| format!("无法确认项目文件夹路径：{error}"))?;
        let canonical_path = path
            .canonicalize()
            .map_err(|error| format!("无法确认项目文件夹路径：{error}"))?;

        if !canonical_path.is_dir() {
            return Err("选择的位置不是文件夹。".to_string());
        }

        Ok(ProjectDirectorySelectionResult {
            selected: true,
            path: Some(canonical_path.to_string_lossy().to_string()),
            name: Some(file_name_for_path(&canonical_path)),
            reason: None,
        })
    })
    .await
    .map_err(|error| format!("项目文件夹选择任务失败：{error}"))?
}

#[tauri::command]
fn native_project_entry_status(
    root_path: String,
    relative_path: String,
) -> Result<ProjectEntryStatus, String> {
    let root = canonical_project_root(&root_path)?;
    let relative = safe_relative_project_path(&relative_path)?;
    let path = root.join(relative);

    if !path.exists() {
        return Ok(ProjectEntryStatus {
            exists: false,
            kind: None,
        });
    }

    let canonical_path = path
        .canonicalize()
        .map_err(|error| format!("无法确认项目文件路径：{error}"))?;

    ensure_inside_project(&root, &canonical_path)?;

    let kind = if canonical_path.is_file() {
        "file"
    } else if canonical_path.is_dir() {
        "directory"
    } else {
        "other"
    };

    Ok(ProjectEntryStatus {
        exists: true,
        kind: Some(kind.to_string()),
    })
}

#[tauri::command]
fn read_project_text_file(root_path: String, relative_path: String) -> Result<String, String> {
    let (_, path) = resolve_existing_project_path(&root_path, &relative_path)?;

    if !path.is_file() {
        return Err("目标路径不是项目文件。".to_string());
    }

    fs::read_to_string(path).map_err(|error| format!("项目文件读取失败：{error}"))
}

#[tauri::command]
fn write_project_text_file(
    root_path: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let path = resolve_project_write_file_path(&root_path, &relative_path)?;

    fs::write(path, content).map_err(|error| format!("项目文件写入失败：{error}"))
}

#[tauri::command]
fn read_project_binary_file(root_path: String, relative_path: String) -> Result<Vec<u8>, String> {
    let (_, path) = resolve_existing_project_path(&root_path, &relative_path)?;

    if !path.is_file() {
        return Err("目标路径不是项目文件。".to_string());
    }

    fs::read(path).map_err(|error| format!("项目文件读取失败：{error}"))
}

#[tauri::command]
fn write_project_binary_file(
    root_path: String,
    relative_path: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let path = resolve_project_write_file_path(&root_path, &relative_path)?;

    fs::write(path, bytes).map_err(|error| format!("项目文件写入失败：{error}"))
}

#[tauri::command]
fn list_project_directory(root_path: String, relative_path: String) -> Result<Vec<String>, String> {
    let path = resolve_project_directory_path(&root_path, &relative_path, false)?;
    let mut names = Vec::new();

    for entry in fs::read_dir(path).map_err(|error| format!("项目目录读取失败：{error}"))?
    {
        let entry = entry.map_err(|error| format!("项目目录读取失败：{error}"))?;

        names.push(entry.file_name().to_string_lossy().to_string());
    }

    names.sort();

    Ok(names)
}

#[tauri::command]
fn ensure_project_directory(root_path: String, relative_path: String) -> Result<(), String> {
    resolve_project_directory_path(&root_path, &relative_path, true)?;

    Ok(())
}

#[tauri::command]
fn delete_project_entry(
    root_path: String,
    relative_path: String,
    recursive: bool,
) -> Result<(), String> {
    let relative = safe_relative_project_path(&relative_path)?;

    if relative.as_os_str().is_empty() {
        return Err("不能删除项目根目录。".to_string());
    }

    let (_, path) = resolve_existing_project_path(&root_path, &relative_path)?;

    if path.is_dir() {
        if recursive {
            fs::remove_dir_all(path).map_err(|error| format!("项目目录删除失败：{error}"))
        } else {
            fs::remove_dir(path).map_err(|error| format!("项目目录删除失败：{error}"))
        }
    } else {
        fs::remove_file(path).map_err(|error| format!("项目文件删除失败：{error}"))
    }
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
fn open_project_directory_path(app: tauri::AppHandle, root_path: String) -> Result<(), String> {
    let project_path = canonical_project_root(&root_path)?;

    app.opener()
        .open_path(project_path.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("无法打开项目文件夹：{error}"))
}

fn delete_native_project_directory(
    root_path: &str,
    project_id: &str,
) -> Result<ProjectDirectoryDeletionResult, String> {
    let project_path = assert_native_project_directory(root_path, project_id)?;
    let (file_count, directory_count) = count_directory_entries(&project_path)?;
    let deleted_path = project_path.to_string_lossy().to_string();

    fs::remove_dir_all(&project_path).map_err(|error| format!("项目文件夹删除失败：{error}"))?;

    Ok(ProjectDirectoryDeletionResult {
        deleted_path,
        file_count,
        directory_count,
    })
}

#[tauri::command]
fn delete_project_directory_path(
    root_path: String,
    project_id: String,
) -> Result<ProjectDirectoryDeletionResult, String> {
    delete_native_project_directory(&root_path, &project_id)
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
            open_project_directory_path,
            delete_project_directory_path,
            pick_project_directory,
            native_project_entry_status,
            read_project_text_file,
            write_project_text_file,
            read_project_binary_file,
            write_project_binary_file,
            list_project_directory,
            ensure_project_directory,
            delete_project_entry,
            begin_generated_file_save,
            append_generated_file_chunk,
            finish_generated_file_save,
            abort_generated_file_save
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempProjectDirectory {
        path: PathBuf,
    }

    impl TempProjectDirectory {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "textile-native-delete-{label}-{}-{nonce}",
                std::process::id()
            ));

            fs::create_dir_all(&path).expect("test project directory should be created");

            Self { path }
        }

        fn path_string(&self) -> String {
            self.path.to_string_lossy().to_string()
        }

        fn write_file(&self, relative_path: &str, content: &str) {
            let path = self.path.join(relative_path);

            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("test parent directory should be created");
            }

            fs::write(path, content).expect("test file should be written");
        }

        fn create_dir(&self, relative_path: &str) {
            fs::create_dir_all(self.path.join(relative_path))
                .expect("test directory should be created");
        }

        fn write_project_identity(&self, project_id: &str) {
            self.write_file(
                "project.json",
                &format!(r#"{{"project_id":"{project_id}"}}"#),
            );
        }

        fn write_members(&self) {
            self.write_file("members.json", r#"{"members":[]}"#);
        }
    }

    impl Drop for TempProjectDirectory {
        fn drop(&mut self) {
            if !self.path.exists() {
                return;
            }

            let temp_root = std::env::temp_dir()
                .canonicalize()
                .expect("system temp directory should exist");
            let Ok(canonical_path) = self.path.canonicalize() else {
                return;
            };

            if canonical_path.starts_with(temp_root) {
                let _ = fs::remove_dir_all(&self.path);
            }
        }
    }

    fn create_valid_project(project_id: &str) -> TempProjectDirectory {
        let directory = TempProjectDirectory::new("valid-project");

        directory.write_project_identity(project_id);
        directory.write_members();
        directory.write_file("entries/000001.jsonl", "{}\n");
        directory.write_file("notes/readme.txt", "note");

        directory
    }

    #[test]
    fn native_project_delete_rejects_missing_project_json() {
        let directory = TempProjectDirectory::new("missing-project-json");

        directory.write_members();
        directory.create_dir("entries");

        let error = delete_native_project_directory(&directory.path_string(), "project-1")
            .expect_err("missing project.json should block deletion");

        assert!(error.contains("不像 Textile 项目文件夹"));
        assert!(directory.path.exists());
    }

    #[test]
    fn native_project_delete_rejects_missing_members_json() {
        let directory = TempProjectDirectory::new("missing-members-json");

        directory.write_project_identity("project-1");
        directory.create_dir("entries");

        let error = delete_native_project_directory(&directory.path_string(), "project-1")
            .expect_err("missing members.json should block deletion");

        assert!(error.contains("不像 Textile 项目文件夹"));
        assert!(directory.path.exists());
    }

    #[test]
    fn native_project_delete_rejects_missing_entries_directory() {
        let directory = TempProjectDirectory::new("missing-entries");

        directory.write_project_identity("project-1");
        directory.write_members();

        let error = delete_native_project_directory(&directory.path_string(), "project-1")
            .expect_err("missing entries directory should block deletion");

        assert!(error.contains("不像 Textile 项目文件夹"));
        assert!(directory.path.exists());
    }

    #[test]
    fn native_project_delete_rejects_project_id_mismatch() {
        let directory = create_valid_project("other-project");

        let error = delete_native_project_directory(&directory.path_string(), "project-1")
            .expect_err("project id mismatch should block deletion");

        assert!(error.contains("项目 ID 与当前项目不一致"));
        assert!(directory.path.exists());
    }

    #[test]
    fn native_project_delete_rejects_file_targets() {
        let directory = TempProjectDirectory::new("file-target");

        directory.write_file("not-a-project", "x");
        let file_path = directory.path.join("not-a-project");

        let error = delete_native_project_directory(&file_path.to_string_lossy(), "project-1")
            .expect_err("file target should block deletion");

        assert!(error.contains("项目文件夹不存在或不可访问"));
        assert!(file_path.exists());
    }

    #[test]
    fn native_project_delete_removes_matching_project_directory() {
        let directory = create_valid_project("project-1");
        let path = directory.path.clone();
        let canonical_path = path
            .canonicalize()
            .expect("test project path should be canonicalized before deletion");

        let result = delete_native_project_directory(&directory.path_string(), "project-1")
            .expect("matching project should be deleted");

        assert_eq!(PathBuf::from(&result.deleted_path), canonical_path,);
        assert_eq!(result.file_count, 4);
        assert_eq!(result.directory_count, 2);
        assert!(!path.exists());
    }
}
