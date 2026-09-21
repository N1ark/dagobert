//! The git sync cycle and its lifecycle: `sync` = commit if dirty → pull →
//! resolve → push, serialised by a process-wide lock so the timer, ⌘S and quit
//! never overlap. The timer is a plain thread that emits `git-tick`; the
//! frontend answers by flushing its debounced saves and calling `git_sync`.

use crate::git::{self, GitStatus, PullOutcome};
use crate::merge::{self, Conflict};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Network operations give up after this long (10 s when quitting).
pub const TIMEOUT: Duration = Duration::from_secs(60);
pub const QUIT_TIMEOUT: Duration = Duration::from_secs(10);
/// The quit goes through regardless once this has elapsed (connecting and
/// authenticating aren't covered by `QUIT_TIMEOUT`, nor is a frontend that
/// never answers).
pub const QUIT_DEADLINE: Duration = Duration::from_secs(20);

#[derive(Default)]
pub struct GitState {
    /// Held for the whole of a sync cycle.
    pub lock: Arc<Mutex<()>>,
    /// Tracking is on for the open project (set by `git_configure`).
    pub enabled: AtomicBool,
    /// A quit-time sync has been requested; the next close/exit goes through.
    pub quitting: AtomicBool,
    /// The held-back close/exit has been carried out.
    pub finished: AtomicBool,
    /// Bumped whenever the timer is (re)started; stale timer threads exit.
    pub generation: AtomicU64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct SyncReport {
    pub committed: bool,
    pub pulled: Option<PullOutcome>,
    pub pushed: bool,
    pub conflicts: Vec<Conflict>,
    pub error: Option<String>,
    pub status: Option<GitStatus>,
}

/// One full cycle. Errors are reported in the result, after whatever succeeded.
pub fn cycle(root: &Path, stamp: &str, timeout: Duration) -> SyncReport {
    let mut r = SyncReport::default();
    let step = |r: &mut SyncReport| -> Result<(), String> {
        // A merge left half-done by a crash is finished first.
        r.conflicts = merge::resolve(root, &format!("dagobert merge {stamp}"))?;
        r.committed = git::commit_if_dirty(root, &format!("dagobert auto-save {stamp}"))?;
        let pulled = git::pull(root, Some(timeout))?;
        if pulled == PullOutcome::Merging {
            r.conflicts
                .extend(merge::resolve(root, &format!("dagobert merge {stamp}"))?);
        }
        r.pulled = Some(pulled);
        let st = git::status(root)?;
        let unpublished = !st.has_upstream && st.last_commit_at.is_some();
        if st.has_remote && (st.ahead > 0 || unpublished) {
            git::push(root, Some(timeout))?;
            r.pushed = true;
        }
        Ok(())
    };
    if let Err(e) = step(&mut r) {
        r.error = Some(e);
    }
    r.status = git::status(root).ok();
    r
}

/// Runs `f` on a blocking thread with the sync lock held.
pub async fn locked<T: Send + 'static>(
    lock: Arc<Mutex<()>>,
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _g = lock.lock().unwrap_or_else(|e| e.into_inner());
        f()
    })
    .await
    .map_err(|e| e.to_string())
}

/// (Re)starts the tick thread; `interval_min == 0` or `enabled == false` stops it.
pub fn configure(app: AppHandle, state: &GitState, enabled: bool, interval_min: u32) {
    state.enabled.store(enabled, Ordering::SeqCst);
    let gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    if !enabled || interval_min == 0 {
        return;
    }
    let period = Duration::from_secs(u64::from(interval_min) * 60);
    std::thread::spawn(move || loop {
        std::thread::sleep(period);
        let state = app.state::<crate::watch::AppState>();
        if state.git.generation.load(Ordering::SeqCst) != gen {
            return;
        }
        if let Err(e) = app.emit("git-tick", ()) {
            eprintln!("git-tick: {e}");
        }
    });
}

/// Whether a close/exit should be held back for a final sync. The first call
/// with tracking on answers `true` and emits `git-quit` (carrying `reason`);
/// the frontend syncs and then calls `git_quit`, which lets the next one through.
pub fn intercept_quit(app: &AppHandle, state: &GitState, reason: &str) -> bool {
    if !state.enabled.load(Ordering::SeqCst) || state.quitting.swap(true, Ordering::SeqCst) {
        return false;
    }
    if app.emit_to("main", "git-quit", reason).is_err() {
        state.quitting.store(false, Ordering::SeqCst);
        return false;
    }
    let (app, reason) = (app.clone(), reason.to_string());
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_DEADLINE);
        eprintln!("git sync on quit timed out");
        finish_quit(&app, &reason);
    });
    true
}

/// Carries out the close/exit held back by `intercept_quit`, once.
pub fn finish_quit(app: &AppHandle, reason: &str) {
    let state = app.state::<crate::watch::AppState>();
    if state.git.finished.swap(true, Ordering::SeqCst) {
        return;
    }
    if reason == "close" {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.destroy();
        }
    } else {
        app.exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::{pair, tmp, write_note};

    #[test]
    fn cycle_commits_pulls_and_pushes() {
        let (base, a, b) = pair("sync-cycle");
        write_note(&a, "a.md", "a", "A", "from a");
        let r = cycle(&a, "2026-01-01 10:00", TIMEOUT);
        assert!(r.committed && r.pushed && r.error.is_none(), "{r:?}");
        assert_eq!(r.pulled, Some(PullOutcome::NoRemote), "nothing to pull yet");
        // b commits its own .gitignore first, so the two histories merge.
        let r = cycle(&b, "2026-01-01 10:01", TIMEOUT);
        assert!(
            r.committed && r.pulled == Some(PullOutcome::Merging),
            "{r:?}"
        );
        assert!(r.conflicts.is_empty() && r.pushed && r.error.is_none());
        assert!(b.join("notes/a.md").exists());
        // Concurrent edits: b's cycle merges, resolves and pushes.
        write_note(&a, "a.md", "a", "A", "a again");
        assert!(cycle(&a, "t", TIMEOUT).error.is_none());
        write_note(&b, "a.md", "a", "A", "b again");
        let r = cycle(&b, "t", TIMEOUT);
        assert!(r.error.is_none(), "{r:?}");
        assert_eq!(r.conflicts.len(), 1);
        assert!(r.conflicts[0].body_conflict && r.pushed);
        let st = r.status.unwrap();
        assert!(!st.dirty && st.ahead == 0 && st.behind == 0);
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn cycle_without_remote_only_commits() {
        let dir = tmp("sync-local");
        git::init(&dir).unwrap();
        write_note(&dir, "a.md", "a", "A", "x");
        let r = cycle(&dir, "t", TIMEOUT);
        assert!(r.committed && !r.pushed && r.error.is_none(), "{r:?}");
        assert_eq!(r.pulled, Some(PullOutcome::NoRemote));
        assert!(!r.status.unwrap().has_remote);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
