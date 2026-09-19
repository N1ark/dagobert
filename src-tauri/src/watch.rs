//! Watches the open project folder so external edits show up in the app.
//!
//! Events are emitted as `project-changed` to every window. Files the app
//! itself wrote in the last second are suppressed via [`Recent`] so we don't
//! echo our own saves back.

use crate::store::{self, Note};
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEvent, DebouncedEventKind, Debouncer};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const DEBOUNCE: Duration = Duration::from_millis(300);
const SUPPRESS_FOR: Duration = Duration::from_millis(1000);

/// Paths the app wrote recently; events for them are ignored.
#[derive(Default)]
pub struct Recent {
    map: Mutex<HashMap<PathBuf, Instant>>,
}

impl Recent {
    pub fn mark(&self, path: impl Into<PathBuf>) {
        self.mark_at(path, Instant::now());
    }

    fn mark_at(&self, path: impl Into<PathBuf>, at: Instant) {
        let mut m = self.map.lock().unwrap();
        m.insert(path.into(), at);
        // Keep the map from growing on long sessions.
        if m.len() > 256 {
            m.retain(|_, t| at.duration_since(*t) < SUPPRESS_FOR);
        }
    }

    /// True when `path` was written within the suppression window.
    /// Expired entries are forgotten.
    pub fn is_recent(&self, path: &Path) -> bool {
        self.is_recent_at(path, Instant::now())
    }

    fn is_recent_at(&self, path: &Path, now: Instant) -> bool {
        let mut m = self.map.lock().unwrap();
        match m.get(path) {
            Some(t) if now.duration_since(*t) < SUPPRESS_FOR => true,
            Some(_) => {
                m.remove(path);
                false
            }
            None => false,
        }
    }
}

/// What changed on disk, as sent to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Change {
    Note { note: Box<Note> },
    NoteRemoved { file: String },
    Meta,
}

#[derive(Default)]
pub struct WatchState {
    debouncer: Option<Debouncer<notify::RecommendedWatcher>>,
}

pub struct AppState {
    pub recent: Arc<Recent>,
    pub watch: Mutex<WatchState>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            recent: Arc::new(Recent::default()),
            watch: Mutex::new(WatchState::default()),
        }
    }
}

/// Classify a changed path relative to the project root.
fn classify(root: &Path, path: &Path) -> Option<Change> {
    if path == root.join(store::META_FILE) {
        return Some(Change::Meta);
    }
    let rel = path.strip_prefix(store::notes_dir(root)).ok()?;
    // Only top-level `notes/*.md`.
    if rel.components().count() != 1 || path.extension().and_then(|e| e.to_str()) != Some("md") {
        return None;
    }
    let file = rel.to_string_lossy().to_string();
    if path.exists() {
        let text = std::fs::read_to_string(path).ok()?;
        match store::parse_note(&text, &file) {
            Ok(note) => Some(Change::Note {
                note: Box::new(note),
            }),
            Err(e) => {
                eprintln!("watch: {e}");
                None
            }
        }
    } else {
        Some(Change::NoteRemoved { file })
    }
}

/// Start watching `root`, replacing any previous watcher.
pub fn start(app: AppHandle, state: &AppState, root: PathBuf) -> Result<(), String> {
    let recent = state.recent.clone();
    let cb_root = root.clone();
    let handler = move |res: Result<Vec<DebouncedEvent>, notify::Error>| {
        let events = match res {
            Ok(ev) => ev,
            Err(e) => {
                eprintln!("watch error: {e}");
                return;
            }
        };
        let mut seen = HashSet::new();
        for ev in events {
            if ev.kind != DebouncedEventKind::Any
                || !seen.insert(ev.path.clone())
                || recent.is_recent(&ev.path)
            {
                continue;
            }
            if let Some(change) = classify(&cb_root, &ev.path) {
                if let Err(e) = app.emit("project-changed", &change) {
                    eprintln!("emit failed: {e}");
                }
            }
        }
    };
    let mut debouncer = new_debouncer(DEBOUNCE, handler).map_err(|e| e.to_string())?;
    // Notes live under notes/; dagobert.json sits at the root. Watching the
    // root recursively covers both (other paths are filtered in `classify`).
    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    // Assigning drops (and stops) any previous watcher.
    state.watch.lock().unwrap().debouncer = Some(debouncer);
    Ok(())
}

pub fn stop(state: &AppState) {
    state.watch.lock().unwrap().debouncer = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_suppresses_then_expires() {
        let r = Recent::default();
        let p = PathBuf::from("/x/notes/a.md");
        let t0 = Instant::now();
        r.mark_at(&p, t0);
        assert!(r.is_recent_at(&p, t0 + Duration::from_millis(500)));
        assert!(!r.is_recent_at(&p, t0 + Duration::from_millis(1500)));
        assert!(!r.is_recent_at(&p, t0), "expired entries are forgotten");
        assert!(!r.is_recent_at(Path::new("/x/notes/b.md"), t0));
    }

    #[test]
    fn classify_paths() {
        let dir = std::env::temp_dir().join(format!("dagobert-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("notes")).unwrap();
        assert!(matches!(
            classify(&dir, &dir.join("dagobert.json")),
            Some(Change::Meta)
        ));
        assert!(matches!(
            classify(&dir, &dir.join("notes/gone.md")),
            Some(Change::NoteRemoved { .. })
        ));
        assert!(classify(&dir, &dir.join("trash/x.md")).is_none());
        assert!(classify(&dir, &dir.join("notes/sub/x.md")).is_none());
        assert!(classify(&dir, &dir.join("notes/x.txt")).is_none());
        std::fs::write(
            dir.join("notes/a.md"),
            "---\nid: a\ntitle: A\ncreated: c\nmodified: m\nopened: o\n---\nhi",
        )
        .unwrap();
        match classify(&dir, &dir.join("notes/a.md")) {
            Some(Change::Note { note }) => {
                assert_eq!(note.id, "a");
                assert_eq!(note.file, "a.md");
                assert_eq!(note.body, "hi");
            }
            other => panic!("{other:?}"),
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
