mod git;
mod github;
#[cfg(target_os = "ios")]
mod keyboard;
mod merge;
mod state;
mod store;
mod symbols;
mod sync;
#[cfg(desktop)]
mod watch;

use serde::Serialize;
use state::AppState;
use std::path::{Path, PathBuf};
use store::{Local, Meta, MetaPatch, Note, Project};
use sync::SyncReport;
use tauri::{AppHandle, Manager, State};

/// A project in the app's own data directory, named rather than pathed (see docs/mobile.md).
#[derive(Debug, Clone, Serialize)]
struct ProjectRef {
    name: String,
    path: String,
}

fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn project_ref(dir: &Path) -> ProjectRef {
    ProjectRef {
        name: dir.file_name().unwrap_or_default().to_string_lossy().into(),
        path: dir.to_string_lossy().into(),
    }
}

#[tauri::command]
fn list_projects(app: AppHandle) -> Result<Vec<ProjectRef>, String> {
    let dir = projects_dir(&app)?;
    let mut out: Vec<ProjectRef> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| project_ref(&e.path()))
        .filter(|p| !p.name.starts_with('.'))
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Resolves a stored project name against the current container path.
#[tauri::command]
fn project_path(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let dir = projects_dir(&app)?.join(&name);
    Ok(dir.is_dir().then(|| dir.to_string_lossy().into()))
}

/// Clones `url` into the app's data directory with `name` / `email` as its commit identity.
#[tauri::command]
async fn clone_project(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    token: Option<String>,
    name: String,
    email: String,
) -> Result<ProjectRef, String> {
    let dest = projects_dir(&app)?.join(git::project_name(&url));
    sync::locked(state.git.lock.clone(), move || {
        git::clone(&url, &dest, token.as_deref(), &name, &email)?;
        Ok(project_ref(&dest))
    })
    .await?
}

#[tauri::command]
fn open_project(path: String) -> Result<Project, String> {
    store::open(Path::new(&path))
}

#[tauri::command]
fn save_note(state: State<AppState>, path: String, note: Note) -> Result<Note, String> {
    let root = Path::new(&path);
    // Mark the old and the renamed file both, so the watcher ignores this write.
    if !note.file.is_empty() {
        state.recent.mark(store::notes_dir(root).join(&note.file));
    }
    let saved = store::save_note(root, note)?;
    state.recent.mark(store::notes_dir(root).join(&saved.file));
    Ok(saved)
}

#[tauri::command]
fn delete_note(
    state: State<AppState>,
    path: String,
    file: String,
    deleted_at: String,
) -> Result<Option<Note>, String> {
    let root = Path::new(&path);
    state.recent.mark(store::notes_dir(root).join(&file));
    store::delete_note(root, &file, &deleted_at)
}

#[tauri::command]
fn discard_note(state: State<AppState>, path: String, file: String) -> Result<(), String> {
    let root = Path::new(&path);
    state.recent.mark(store::notes_dir(root).join(&file));
    store::discard_note(root, &file)
}

#[tauri::command]
fn list_trash(path: String) -> Result<Vec<Note>, String> {
    store::list_trash(Path::new(&path))
}

#[tauri::command]
fn restore_note(state: State<AppState>, path: String, file: String) -> Result<Note, String> {
    let root = Path::new(&path);
    let restored = store::restore_note(root, &file)?;
    state
        .recent
        .mark(store::notes_dir(root).join(&restored.file));
    Ok(restored)
}

#[tauri::command]
fn purge_trash(path: String, file: Option<String>) -> Result<(), String> {
    store::purge_trash(Path::new(&path), file.as_deref())
}

#[tauri::command]
fn read_meta(path: String) -> Meta {
    store::read_meta(Path::new(&path))
}

#[tauri::command]
fn save_meta(state: State<AppState>, path: String, meta: MetaPatch) -> Result<(), String> {
    let root = Path::new(&path);
    state.recent.mark(root.join(store::META_FILE));
    store::save_meta(root, meta)
}

#[tauri::command]
fn save_local(path: String, local: Local) -> Result<(), String> {
    store::save_local(Path::new(&path), &local)
}

/// No-op on mobile, which has no watcher; `SyncReport.pulled` drives reloads there.
#[tauri::command]
#[allow(unused_variables)]
fn watch_project(app: AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    #[cfg(desktop)]
    watch::start(app, &state, std::path::PathBuf::from(path))?;
    Ok(())
}

#[tauri::command]
#[allow(unused_variables)]
fn unwatch_project(state: State<AppState>) {
    #[cfg(desktop)]
    watch::stop(&state);
}

// ---- git tracking ------------------------------------------------------------

#[tauri::command]
async fn git_status(state: State<'_, AppState>, path: String) -> Result<git::GitStatus, String> {
    sync::locked(state.git.lock.clone(), move || {
        git::status(Path::new(&path))
    })
    .await?
}

/// `Err("no-repo")` when the folder isn't inside a repository.
#[tauri::command]
fn git_enable(path: String) -> Result<(), String> {
    git::enable(Path::new(&path))
}

#[tauri::command]
fn git_init(path: String) -> Result<(), String> {
    git::init(Path::new(&path))
}

/// Starts or stops the tick timer for the open project.
#[tauri::command]
fn git_configure(app: AppHandle, state: State<AppState>, enabled: bool, interval_min: u32) {
    sync::configure(app, &state.git, enabled, interval_min);
}

/// The full cycle: commit if dirty → pull → resolve → push, with saves already flushed.
#[tauri::command]
async fn git_sync(
    state: State<'_, AppState>,
    path: String,
    token: Option<String>,
    stamp: String,
) -> Result<SyncReport, String> {
    state.recent.clear();
    sync::locked(state.git.lock.clone(), move || {
        sync::cycle(Path::new(&path), token.as_deref(), &stamp, sync::TIMEOUT)
    })
    .await
}

/// The last sync before a close or exit, on a short timeout; failures are logged, not shown.
#[tauri::command]
async fn git_quit(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
    token: Option<String>,
    stamp: String,
    reason: String,
) -> Result<(), String> {
    if let Some(path) = path {
        state.recent.clear();
        let r = sync::locked(state.git.lock.clone(), move || {
            sync::cycle(
                Path::new(&path),
                token.as_deref(),
                &stamp,
                sync::QUIT_TIMEOUT,
            )
        })
        .await?;
        if let Some(e) = r.error {
            eprintln!("git sync on quit failed: {e}");
        }
    }
    sync::finish_quit(&app, &reason);
    Ok(())
}

/// First SF Symbol from `names` that exists, as PNG bytes (macOS only).
#[tauri::command]
fn sf_symbol(names: Vec<String>, point_size: f64) -> Option<Vec<u8>> {
    names
        .iter()
        .find_map(|n| symbols::sf_symbol_png(n, point_size))
}

/// Starts the GitHub App device flow; the frontend shows the code and opens the URL.
#[tauri::command]
async fn github_signin_start() -> Result<github::DeviceStart, String> {
    tauri::async_runtime::spawn_blocking(github::start)
        .await
        .map_err(|e| e.to_string())?
}

/// One poll of the device flow. `pending` / `slow-down` mean keep waiting.
#[tauri::command]
async fn github_signin_poll(device_code: String) -> Result<github::Poll, String> {
    tauri::async_runtime::spawn_blocking(move || github::poll(&device_code))
        .await
        .map_err(|e| e.to_string())?
}

/// Exchanges a refresh token for a fresh one (apps with expiring user tokens).
#[tauri::command]
async fn github_refresh(refresh_token: String) -> Result<github::Refreshed, String> {
    tauri::async_runtime::spawn_blocking(move || github::refresh(&refresh_token))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(AppState::default());
            #[cfg(target_os = "ios")]
            keyboard::watch(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_project,
            list_projects,
            project_path,
            clone_project,
            save_note,
            delete_note,
            discard_note,
            list_trash,
            restore_note,
            purge_trash,
            read_meta,
            save_meta,
            save_local,
            github_signin_start,
            github_signin_poll,
            github_refresh,
            sf_symbol,
            watch_project,
            unwatch_project,
            git_status,
            git_enable,
            git_init,
            git_configure,
            git_sync,
            git_quit
        ])
        .on_window_event(|window, event| {
            let _ = (&window, &event);
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let app = window.app_handle();
                    if sync::intercept_quit(app, &app.state::<AppState>().git, "close") {
                        api.prevent_close();
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            let _ = (app, &event);
            #[cfg(desktop)]
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                if sync::intercept_quit(app, &app.state::<AppState>().git, "exit") {
                    api.prevent_exit();
                }
            }
        });
}
