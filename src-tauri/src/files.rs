//! Links from notes to local files and folders: `[name](path)` (see docs/editor.md).

use serde::Serialize;
use std::path::{Component, Path, PathBuf};

/// Where a link points, and whether it's a `file`, a `dir` or out of reach (`None`).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Target {
    pub path: String,
    pub kind: Option<&'static str>,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Drops `.` and folds `..`, without touching the disk.
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            c => out.push(c),
        }
    }
    out
}

/// A link's path on disk: a `file://` URL, `~/…`, absolute, or relative to the note (in `notes/`).
pub fn resolve(project: &Path, raw: &str, home: Option<&Path>) -> PathBuf {
    let raw = match raw.get(..7) {
        Some(s) if s.eq_ignore_ascii_case("file://") => {
            let rest = &raw[7..];
            rest.strip_prefix("localhost").unwrap_or(rest)
        }
        _ => raw,
    };
    let raw = crate::percent_decode(raw);
    let p = match (raw.strip_prefix('~'), home) {
        (Some(rest), Some(h)) if rest.is_empty() || rest.starts_with('/') => {
            h.join(rest.trim_start_matches('/'))
        }
        _ => PathBuf::from(&raw),
    };
    normalize(&if p.is_absolute() {
        p
    } else {
        project.join("notes").join(p)
    })
}

fn kind_of(p: &Path) -> Option<&'static str> {
    // Opening it too tells a folder or file we may not read from one that's merely there.
    if std::fs::metadata(p).ok()?.is_dir() {
        std::fs::read_dir(p).ok().map(|_| "dir")
    } else {
        std::fs::File::open(p).ok().map(|_| "file")
    }
}

/// Each link resolved and checked; on a phone only what's inside the project is reachable.
pub fn stat(project: &Path, links: &[String]) -> Vec<Target> {
    let home = home();
    links
        .iter()
        .map(|raw| {
            let p = resolve(project, raw, home.as_deref());
            let reachable = cfg!(desktop) || p.starts_with(project);
            Target {
                kind: if reachable { kind_of(&p) } else { None },
                path: p.to_string_lossy().into(),
            }
        })
        .collect()
}

fn joined(rel: &Path) -> String {
    let parts: Vec<_> = rel.iter().map(|s| s.to_string_lossy()).collect();
    parts.join("/")
}

/// How a link to `file` is written: relative to the note inside the project, `~/…` under home.
pub fn link_target(project: &Path, file: &Path, home: Option<&Path>) -> String {
    if let Ok(rel) = file.strip_prefix(project.join("notes")) {
        return format!("./{}", joined(rel));
    }
    if let Ok(rel) = file.strip_prefix(project) {
        return format!("../{}", joined(rel));
    }
    if let Some(rel) = home.and_then(|h| file.strip_prefix(h).ok()) {
        return format!("~/{}", joined(rel));
    }
    file.to_string_lossy().into()
}

pub fn link_targets(project: &Path, files: &[String]) -> Vec<String> {
    let home = home();
    files
        .iter()
        .map(|f| link_target(project, Path::new(f), home.as_deref()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_every_form() {
        let proj = Path::new("/p/proj");
        let home = Some(Path::new("/Users/me"));
        let r = |s: &str| resolve(proj, s, home).to_string_lossy().into_owned();
        assert_eq!(r("/a/b.pdf"), "/a/b.pdf");
        assert_eq!(r("~/code/foo"), "/Users/me/code/foo");
        assert_eq!(r("~"), "/Users/me");
        assert_eq!(r("file:///a/My%20Doc.pdf"), "/a/My Doc.pdf");
        assert_eq!(r("FILE://localhost/a/x"), "/a/x");
        assert_eq!(r("../docs/spec.md"), "/p/proj/docs/spec.md");
        assert_eq!(r("./assets/x.png"), "/p/proj/notes/assets/x.png");
        assert_eq!(r("a.md"), "/p/proj/notes/a.md");
        assert!(!resolve(proj, "../../../etc", home).starts_with(proj));
    }

    #[test]
    fn writes_targets_relative_when_it_can() {
        let proj = Path::new("/Users/me/proj");
        let home = Some(Path::new("/Users/me"));
        let w = |s: &str| link_target(proj, Path::new(s), home);
        assert_eq!(w("/Users/me/proj/notes/a.md"), "./a.md");
        assert_eq!(w("/Users/me/proj/docs/spec.pdf"), "../docs/spec.pdf");
        assert_eq!(w("/Users/me/code/foo"), "~/code/foo");
        assert_eq!(w("/Volumes/x/y"), "/Volumes/x/y");
    }

    #[test]
    fn stats_files_and_folders() {
        let dir = std::env::temp_dir().join(format!("dagobert-files-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("notes")).unwrap();
        std::fs::write(dir.join("notes/a.md"), "x").unwrap();
        let links = ["./a.md", "../notes", "./missing.pdf"].map(String::from);
        let kinds: Vec<_> = stat(&dir, &links).into_iter().map(|t| t.kind).collect();
        assert_eq!(kinds, [Some("file"), Some("dir"), None]);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
