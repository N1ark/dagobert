//! Self-update from the latest GitHub release's `latest.json` (desktop only).

use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// An update downloaded and verified, waiting for the user to restart.
#[derive(Default)]
pub struct Pending(Mutex<Option<(Update, Vec<u8>)>>);

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
    if let Some((ready, _)) = &*pending.0.lock().unwrap() {
        if ready.version == version {
            return Ok(Some(version));
        }
    }
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    *pending.0.lock().unwrap() = Some((update, bytes));
    Ok(Some(version))
}

/// Replaces the app with the downloaded update and relaunches it.
pub fn install(app: &AppHandle) -> Result<(), String> {
    let Some((update, bytes)) = app.state::<Pending>().0.lock().unwrap().take() else {
        return Err("no update downloaded".into());
    };
    update.install(bytes).map_err(|e| e.to_string())?;
    app.request_restart();
    Ok(())
}
