//! Managed state: [`Recent`] holds paths we just wrote, so the watcher doesn't echo our saves.

use std::collections::HashMap;
#[cfg(any(desktop, test))]
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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

    pub fn clear(&self) {
        self.map.lock().unwrap().clear();
    }

    fn mark_at(&self, path: impl Into<PathBuf>, at: Instant) {
        let mut m = self.map.lock().unwrap();
        m.insert(path.into(), at);
        // Keep the map from growing on long sessions.
        if m.len() > 256 {
            m.retain(|_, t| at.duration_since(*t) < SUPPRESS_FOR);
        }
    }

    /// True when `path` was written within the suppression window; expired entries are dropped.
    #[cfg(desktop)]
    pub fn is_recent(&self, path: &Path) -> bool {
        self.is_recent_at(path, Instant::now())
    }

    #[cfg(any(desktop, test))]
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

pub struct AppState {
    pub recent: Arc<Recent>,
    #[cfg(desktop)]
    pub watch: Mutex<crate::watch::WatchState>,
    pub git: crate::sync::GitState,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            recent: Arc::new(Recent::default()),
            #[cfg(desktop)]
            watch: Mutex::new(crate::watch::WatchState::default()),
            git: crate::sync::GitState::default(),
        }
    }
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
}
