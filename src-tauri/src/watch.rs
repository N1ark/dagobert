//! Watches the project folder and emits `project-changed`; desktop only, and [`Recent`] is skipped.

use crate::state::AppState;
use crate::store::{self, Note};
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEvent, DebouncedEventKind, Debouncer};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const DEBOUNCE: Duration = Duration::from_millis(300);

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
    // The root recursively covers notes/ and dagobert.json both; `classify` filters the rest.
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
            "---\nid: a\ntitle: A\ncreated: c\nmodified: m\n---\nhi",
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
