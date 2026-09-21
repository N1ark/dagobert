mod git;
mod merge;
mod store;
mod symbols;
mod sync;
mod watch;

use std::path::{Path, PathBuf};
use store::{Local, Meta, MetaPatch, Note, Project};
use sync::SyncReport;
use tauri::{AppHandle, Manager, State, WindowEvent};
use watch::AppState;

#[tauri::command]
fn open_project(path: String) -> Result<Project, String> {
    store::open(Path::new(&path))
}

#[tauri::command]
fn save_note(state: State<AppState>, path: String, note: Note) -> Result<Note, String> {
    let root = Path::new(&path);
    // Mark both the old and the (possibly renamed) new file so the watcher
    // ignores this write.
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

#[tauri::command]
fn watch_project(app: AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    watch::start(app, &state, PathBuf::from(path))
}

#[tauri::command]
fn unwatch_project(state: State<AppState>) {
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

/// Checks the folder is inside a repository (`Err("no-repo")` otherwise) and
/// writes the `.gitignore` entries tracking needs.
#[tauri::command]
fn git_enable(path: String) -> Result<(), String> {
    let root = Path::new(&path);
    if git::open(root)?.is_none() {
        return Err("no-repo".into());
    }
    git::ensure_ignore(root)
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

/// The full cycle: commit if dirty → pull → resolve → push. `stamp` is the
/// local time the frontend puts in commit messages.
#[tauri::command]
async fn git_sync(
    state: State<'_, AppState>,
    path: String,
    stamp: String,
) -> Result<SyncReport, String> {
    sync::locked(state.git.lock.clone(), move || {
        sync::cycle(Path::new(&path), &stamp, sync::TIMEOUT)
    })
    .await
}

/// The final sync before the window closes or the app exits (`reason`), with a
/// short timeout; failures are logged, not shown.
#[tauri::command]
async fn git_quit(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    stamp: String,
    reason: String,
) -> Result<(), String> {
    let r = sync::locked(state.git.lock.clone(), move || {
        sync::cycle(Path::new(&path), &stamp, sync::QUIT_TIMEOUT)
    })
    .await?;
    if let Some(e) = r.error {
        eprintln!("git sync on quit failed: {e}");
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

/// Token from the GitHub CLI (`gh auth token`), if the user is logged in there.
#[tauri::command]
fn github_cli_token() -> Option<String> {
    let out = std::process::Command::new("gh")
        .args(["auth", "token"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let t = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(AppState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_project,
            save_note,
            delete_note,
            discard_note,
            list_trash,
            restore_note,
            purge_trash,
            read_meta,
            save_meta,
            save_local,
            github_cli_token,
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
            if let WindowEvent::CloseRequested { api, .. } = event {
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
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                if sync::intercept_quit(app, &app.state::<AppState>().git, "exit") {
                    api.prevent_exit();
                }
            }
        });
}
