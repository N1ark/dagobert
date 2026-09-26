//! Self-update from the latest GitHub release's `latest.json` (desktop only).

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// An update downloaded and verified, waiting on disk (not in memory) for the user to restart.
#[derive(Default)]
pub struct Pending(Mutex<Option<(Update, PathBuf)>>);

/// Checks for a newer release and downloads it; returns its version.
pub async fn check(app: &AppHandle) -> Result<Option<String>, String> {
    // A dev build would replace itself with the release.
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    let pending = app.state::<Pending>();
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let version = update.version.clone();
    if let Some((ready, file)) = &*pending.0.lock().unwrap() {
        if ready.version == version && file.exists() {
            return Ok(Some(version));
        }
    }
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("update.bin");
    std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
    *pending.0.lock().unwrap() = Some((update, file));
    Ok(Some(version))
}

/// Replaces the app with the downloaded update and relaunches it.
pub fn install(app: &AppHandle) -> Result<(), String> {
    let Some((update, file)) = app.state::<Pending>().0.lock().unwrap().take() else {
        return Err("no update downloaded".into());
    };
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&file);
    update.install(bytes).map_err(|e| e.to_string())?;
    app.request_restart();
    Ok(())
}
