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
mod update;
#[cfg(desktop)]
mod watch;

use serde::Serialize;
use state::AppState;
use std::path::{Path, PathBuf};
use std::time::Duration;
use store::{Local, Meta, MetaPatch, Note, Project};
use sync::SyncReport;
use tauri::{AppHandle, Manager, State};

/// A project in the app's own data directory, named rather than pathed (see docs/mobile.md).
#[derive(Debug, Clone, Serialize)]
struct ProjectRef {
    name: String,
    path: String,
}

/// Runs `f` on a blocking thread.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())
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
async fn list_projects(app: AppHandle) -> Result<Vec<ProjectRef>, String> {
    let dir = projects_dir(&app)?;
    blocking(move || list_dir(&dir)).await?
}

fn list_dir(dir: &Path) -> Result<Vec<ProjectRef>, String> {
    let mut out: Vec<ProjectRef> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| project_ref(&e.path()))
        .filter(|p| !p.name.starts_with('.'))
        .collect();
    out.sort_by_key(|a| a.name.to_lowercase());
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

// Reads, parses and git walks run off the main thread, so the window never stalls on them.
#[tauri::command]
async fn open_project(app: AppHandle, path: String) -> Result<Project, String> {
    allow_assets(&app, Path::new(&path));
    blocking(move || store::open(Path::new(&path))).await?
}

/// Lets the webview load the project's media through the asset protocol. Requests are
/// canonicalised before matching, so the allowed directory must be too.
fn allow_assets(app: &AppHandle, root: &Path) {
    let dir = std::fs::canonicalize(root).map(|r| store::assets_dir(&r));
    if let Err(e) = dir.map(|d| app.asset_protocol_scope().allow_directory(d, false)) {
        eprintln!("asset scope: {e}");
    }
}

/// Undoes `encodeURIComponent`, for values sent in headers (which must be ASCII).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = b
            .get(i + 1..i + 3)
            .and_then(|h| std::str::from_utf8(h).ok());
        match hex
            .filter(|_| b[i] == b'%')
            .map(|h| u8::from_str_radix(h, 16))
        {
            Some(Ok(v)) => {
                out.push(v);
                i += 3;
            }
            _ => {
                out.push(b[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A pasted file as the raw request body (no base64); `path` and `ext` ride in headers.
#[tauri::command]
async fn save_asset(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    let header = |k: &str| {
        let v = request.headers().get(k).and_then(|v| v.to_str().ok());
        v.map(percent_decode).ok_or(format!("missing {k}"))
    };
    let (root, ext, bytes) = (
        PathBuf::from(header("path")?),
        header("ext")?,
        bytes.clone(),
    );
    let recent = state.recent.clone();
    blocking(move || {
        let link = store::save_asset(&root, &bytes, &ext)?;
        recent.mark(store::notes_dir(&root).join(&link));
        Ok(link)
    })
    .await?
}

#[tauri::command]
fn save_note(state: State<AppState>, path: String, note: Note) -> Result<Note, String> {
    let root = Path::new(&path);
    // Mark the old and the renamed file both, so the watcher ignores this write.
    if !note.file.is_empty() {
        state.recent.mark(store::note_path(root, &note.file));
    }
    let saved = store::save_note(root, note)?;
    state.recent.mark(store::note_path(root, &saved.file));
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
    state.recent.mark(store::note_path(root, &file));
    store::delete_note(root, &file, &deleted_at)
}

#[tauri::command]
fn discard_note(state: State<AppState>, path: String, file: String) -> Result<(), String> {
    let root = Path::new(&path);
    state.recent.mark(store::note_path(root, &file));
    store::discard_note(root, &file)
}

#[tauri::command]
async fn list_trash(path: String) -> Result<Vec<Note>, String> {
    blocking(move || store::list_trash(Path::new(&path))).await?
}

#[tauri::command]
async fn restore_note(
    state: State<'_, AppState>,
    path: String,
    file: String,
) -> Result<Note, String> {
    let recent = state.recent.clone();
    blocking(move || {
        let root = Path::new(&path);
        let restored = store::restore_note(root, &file)?;
        recent.mark(store::note_path(root, &restored.file));
        Ok(restored)
    })
    .await?
}

/// Copies a dropped or picked file into the project's assets; `file` may be a `file://` URL (iOS).
#[tauri::command]
async fn import_asset(
    state: State<'_, AppState>,
    path: String,
    file: String,
) -> Result<store::Imported, String> {
    let recent = state.recent.clone();
    blocking(move || {
        let root = Path::new(&path);
        let src = match file.strip_prefix("file://") {
            Some(url) => PathBuf::from(percent_decode(url)),
            None => PathBuf::from(file),
        };
        let imported = store::import_asset(root, &src)?;
        recent.mark(store::notes_dir(root).join(&imported.link));
        Ok(imported)
    })
    .await?
}

/// `keep`: asset names the app still refers to (unsaved edits, undo history).
#[tauri::command]
async fn purge_trash(path: String, file: Option<String>, keep: Vec<String>) -> Result<(), String> {
    blocking(move || store::purge_trash(Path::new(&path), file.as_deref(), &keep)).await?
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
    watch::start(app, &state, PathBuf::from(path))?;
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
async fn git_enable(state: State<'_, AppState>, path: String) -> Result<(), String> {
    sync::locked(state.git.lock.clone(), move || {
        git::enable(Path::new(&path))
    })
    .await?
}

#[tauri::command]
async fn git_init(state: State<'_, AppState>, path: String) -> Result<(), String> {
    sync::locked(state.git.lock.clone(), move || git::init(Path::new(&path))).await?
}

/// Starts or stops the tick timer for the open project.
#[tauri::command]
fn git_configure(app: AppHandle, state: State<AppState>, enabled: bool, interval_min: u32) {
    sync::configure(app, &state.git, enabled, interval_min);
}

/// A cycle under the sync lock; the frontend has awaited its writes, so none are ours to hide.
async fn run_cycle(
    state: &AppState,
    path: String,
    token: Option<String>,
    stamp: String,
    timeout: Duration,
) -> Result<SyncReport, String> {
    state.recent.clear();
    sync::locked(state.git.lock.clone(), move || {
        sync::cycle(Path::new(&path), token.as_deref(), &stamp, timeout)
    })
    .await
}

/// The full cycle: commit if dirty → pull → resolve → push, with saves already flushed.
#[tauri::command]
async fn git_sync(
    state: State<'_, AppState>,
    path: String,
    token: Option<String>,
    stamp: String,
) -> Result<SyncReport, String> {
    run_cycle(&state, path, token, stamp, sync::TIMEOUT).await
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
        let r = run_cycle(&state, path, token, stamp, sync::QUIT_TIMEOUT).await?;
        if let Some(e) = r.error {
            eprintln!("git sync on quit failed: {e}");
        }
    }
    sync::finish_quit(&app, &reason);
    Ok(())
}

/// First SF Symbol from `names` that exists, as raw PNG bytes; empty when none does (macOS only).
#[tauri::command]
fn sf_symbol(names: Vec<String>, point_size: f64) -> tauri::ipc::Response {
    tauri::ipc::Response::new(
        names
            .iter()
            .find_map(|n| symbols::sf_symbol_png(n, point_size))
            .unwrap_or_default(),
    )
}

/// Starts the GitHub App device flow; the frontend shows the code and opens the URL.
#[tauri::command]
async fn github_signin_start() -> Result<github::DeviceStart, String> {
    blocking(github::start).await?
}

/// One poll of the device flow. `pending` / `slow-down` mean keep waiting.
#[tauri::command]
async fn github_signin_poll(device_code: String) -> Result<github::Poll, String> {
    blocking(move || github::poll(&device_code)).await?
}

/// Exchanges a refresh token for a fresh one (apps with expiring user tokens).
#[tauri::command]
async fn github_refresh(refresh_token: String) -> Result<github::Refreshed, String> {
    blocking(move || github::refresh(&refresh_token)).await?
}

/// Checks for and downloads a newer release; `None` when up to date (always on mobile).
#[tauri::command]
#[allow(unused_variables)]
async fn update_check(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(desktop)]
    return update::check(&app).await;
    #[cfg(not(desktop))]
    Ok(None)
}

/// Installs the downloaded update and relaunches; saves and syncs must be done by then.
#[tauri::command]
#[allow(unused_variables)]
async fn update_install(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    return blocking(move || update::install(&app)).await?;
    #[cfg(not(desktop))]
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .setup(|app| {
            app.manage(AppState::default());
            #[cfg(desktop)]
            app.manage(update::Pending::default());
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
            save_asset,
            import_asset,
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
            git_quit,
            update_check,
            update_install
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
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                // An update's restart can't be held back; the frontend synced before asking for it.
                if *code != Some(tauri::RESTART_EXIT_CODE)
                    && sync::intercept_quit(app, &app.state::<AppState>().git, "exit")
                {
                    api.prevent_exit();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn decodes_uri_components() {
        assert_eq!(
            percent_decode("%2FUsers%2Fme%2FNotes%20%C3%A9"),
            "/Users/me/Notes é"
        );
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("a%zz"), "a%zz");
    }
}
