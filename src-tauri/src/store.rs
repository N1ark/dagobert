//! On-disk project format.
//!
//! A project is a folder. Each note is `notes/<slug>.md` with a YAML
//! frontmatter block holding metadata, followed by the markdown body.
//! Canvas state (viewport) lives in `dagobert.json` at the project root.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

pub const NOTES_DIR: &str = "notes";
const TRASH_DIR: &str = "trash";
pub const META_FILE: &str = "dagobert.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created: String,
    pub modified: String,
    pub opened: String,
    /// Workflow id; `None` means the built-in todo/done workflow.
    #[serde(default)]
    pub workflow: Option<String>,
    /// Current stage name within the workflow.
    #[serde(default = "todo")]
    pub status: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// Card width on the canvas; `None` means the default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    /// IDs of notes this note depends on.
    #[serde(default)]
    pub deps: Vec<String>,
    /// When the note was soft-deleted (only set for notes in `trash/`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted: Option<String>,
    #[serde(default)]
    pub body: String,
    /// File name relative to `notes/` (or `trash/` for deleted notes), assigned by the store.
    #[serde(default)]
    pub file: String,
}

/// The frontmatter subset of a note (everything except body & file).
#[derive(Debug, Serialize, Deserialize)]
struct FrontMatter {
    id: String,
    title: String,
    #[serde(default)]
    tags: Vec<String>,
    created: String,
    modified: String,
    opened: String,
    /// Legacy boolean from before workflows existed; read-only, migrated to `status`.
    #[serde(default, skip_serializing)]
    done: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workflow: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    x: f64,
    #[serde(default)]
    y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    width: Option<f64>,
    #[serde(default)]
    deps: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    deleted: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Viewport {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "one")]
    pub zoom: f64,
}

fn one() -> f64 {
    1.0
}

fn todo() -> String {
    "todo".into()
}

/// A named, ordered set of stages a note can move through.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub id: String,
    pub name: String,
    pub stages: Vec<Stage>,
    /// Default body for new notes on this workflow.
    #[serde(default)]
    pub template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stage {
    pub name: String,
    /// Whether a note at this stage counts as done (for readiness etc).
    #[serde(default)]
    pub done: bool,
}

impl Default for Viewport {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0, zoom: 1.0 }
    }
}

/// Project-wide settings stored in `dagobert.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Meta {
    #[serde(default)]
    pub viewport: Viewport,
    /// Tag name -> CSS colour.
    #[serde(default)]
    pub tag_colors: BTreeMap<String, String>,
    /// User-defined workflows (the default todo/done one is implicit).
    #[serde(default)]
    pub workflows: Vec<Workflow>,
    /// Default body for new notes on the built-in Todo workflow.
    #[serde(default)]
    pub default_template: String,
}

#[derive(Debug, Serialize)]
pub struct Project {
    pub path: String,
    pub notes: Vec<Note>,
    pub meta: Meta,
}

pub fn notes_dir(root: &Path) -> PathBuf {
    root.join(NOTES_DIR)
}

fn trash_dir(root: &Path) -> PathBuf {
    root.join(TRASH_DIR)
}

/// Reads every note in a directory, skipping unparsable files and duplicate ids.
fn read_notes(dir: &Path) -> Result<Vec<Note>, String> {
    let mut notes = Vec::new();
    let mut seen = HashSet::new();
    if !dir.exists() {
        return Ok(notes);
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let file = entry.file_name().to_string_lossy().to_string();
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        match parse_note(&text, &file) {
            Ok(n) if seen.insert(n.id.clone()) => notes.push(n),
            Ok(n) => eprintln!("skipping {file}: duplicate id {}", n.id),
            Err(e) => eprintln!("skipping {e}"),
        }
    }
    Ok(notes)
}

/// A filename in `dir` that doesn't exist yet, based on `wanted`.
fn free_name(dir: &Path, wanted: &str, id: &str) -> String {
    if !dir.join(wanted).exists() {
        return wanted.to_string();
    }
    let stem = wanted.strip_suffix(".md").unwrap_or(wanted);
    let mut n = 0;
    loop {
        let candidate = if n == 0 { format!("{stem}-{id}.md") } else { format!("{stem}-{id}-{n}.md") };
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        n += 1;
    }
}

pub fn parse_note(text: &str, file: &str) -> Result<Note, String> {
    let rest = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
        .ok_or_else(|| format!("{file}: missing frontmatter"))?;
    let end = rest
        .find("\n---")
        .ok_or_else(|| format!("{file}: unterminated frontmatter"))?;
    let (yaml, body) = rest.split_at(end);
    let body = body
        .trim_start_matches("\n---")
        .trim_start_matches('\r')
        .strip_prefix('\n')
        .unwrap_or("")
        .to_string();
    let fm: FrontMatter =
        serde_yaml::from_str(yaml).map_err(|e| format!("{file}: bad frontmatter: {e}"))?;
    Ok(Note {
        id: fm.id,
        title: fm.title,
        tags: fm.tags,
        created: fm.created,
        modified: fm.modified,
        opened: fm.opened,
        workflow: fm.workflow,
        status: fm.status.unwrap_or_else(|| if fm.done { "done".into() } else { todo() }),
        x: fm.x,
        y: fm.y,
        width: fm.width,
        deps: fm.deps,
        deleted: fm.deleted,
        body,
        file: file.to_string(),
    })
}

fn serialize_note(note: &Note) -> Result<String, String> {
    let fm = FrontMatter {
        id: note.id.clone(),
        title: note.title.clone(),
        tags: note.tags.clone(),
        created: note.created.clone(),
        modified: note.modified.clone(),
        opened: note.opened.clone(),
        done: false,
        workflow: note.workflow.clone(),
        status: Some(note.status.clone()),
        x: note.x,
        y: note.y,
        width: note.width,
        deps: note.deps.clone(),
        deleted: note.deleted.clone(),
    };
    let yaml = serde_yaml::to_string(&fm).map_err(|e| e.to_string())?;
    Ok(format!("---\n{yaml}---\n{}", note.body))
}

fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true;
    for c in title.chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "untitled".into()
    } else {
        out.chars().take(80).collect()
    }
}

pub fn open(root: &Path) -> Result<Project, String> {
    let dir = notes_dir(root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut notes = read_notes(&dir)?;
    // Drop dangling dependencies.
    let ids: HashSet<String> = notes.iter().map(|n| n.id.clone()).collect();
    for n in &mut notes {
        n.deps.retain(|d| ids.contains(d));
    }

    let meta = read_meta(root);

    Ok(Project {
        path: root.to_string_lossy().to_string(),
        notes,
        meta,
    })
}

/// Writes a note to disk, renaming its file if the title changed.
/// Returns the note with its (possibly new) `file` set.
pub fn save_note(root: &Path, mut note: Note) -> Result<Note, String> {
    let dir = notes_dir(root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let slug = slugify(&note.title);
    let wanted = if note.file.is_empty() || Path::new(&note.file).file_stem().and_then(|s| s.to_str()) != Some(&slug) {
        // Pick a free filename for the new slug (our own current file doesn't count).
        let candidate = format!("{slug}.md");
        if candidate == note.file { candidate } else { free_name(&dir, &candidate, &note.id) }
    } else {
        note.file.clone()
    };

    if !note.file.is_empty() && note.file != wanted {
        let old = dir.join(&note.file);
        if old.exists() {
            fs::rename(&old, dir.join(&wanted)).map_err(|e| e.to_string())?;
        }
    }
    note.file = wanted;
    let text = serialize_note(&note)?;
    fs::write(dir.join(&note.file), text).map_err(|e| e.to_string())?;
    Ok(note)
}

/// Soft-deletes a note by moving it into `trash/`, stamping `deleted`.
/// Never overwrites: a clashing name in the trash gets a unique suffix.
/// Returns the note as it now sits in the trash.
pub fn delete_note(root: &Path, file: &str, deleted_at: &str) -> Result<Option<Note>, String> {
    let src = notes_dir(root).join(file);
    if !src.exists() {
        return Ok(None);
    }
    let trash = trash_dir(root);
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let text = fs::read_to_string(&src).map_err(|e| e.to_string())?;
    let mut note = parse_note(&text, file)?;
    note.deleted = Some(deleted_at.to_string());
    note.file = free_name(&trash, file, &note.id);
    fs::write(trash.join(&note.file), serialize_note(&note)?).map_err(|e| e.to_string())?;
    fs::remove_file(&src).map_err(|e| e.to_string())?;
    Ok(Some(note))
}

/// Hard-deletes a note file without going through the trash (for empty notes).
pub fn discard_note(root: &Path, file: &str) -> Result<(), String> {
    let p = notes_dir(root).join(file);
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn list_trash(root: &Path) -> Result<Vec<Note>, String> {
    let mut notes = read_notes(&trash_dir(root))?;
    notes.sort_by(|a, b| b.deleted.cmp(&a.deleted));
    Ok(notes)
}

/// Moves a note out of `trash/` back into `notes/`, picking a free filename.
pub fn restore_note(root: &Path, file: &str) -> Result<Note, String> {
    let src = trash_dir(root).join(file);
    let text = fs::read_to_string(&src).map_err(|e| format!("{file}: {e}"))?;
    let mut note = parse_note(&text, file)?;
    note.deleted = None;
    note.file = String::new();
    // Refuse to resurrect an id that's live again (e.g. restored twice from copies).
    if read_notes(&notes_dir(root))?.iter().any(|n| n.id == note.id) {
        return Err("A note with this id already exists.".into());
    }
    let restored = save_note(root, note)?;
    fs::remove_file(&src).map_err(|e| e.to_string())?;
    Ok(restored)
}

/// Permanently deletes one trashed note, or the whole trash when `file` is `None`.
pub fn purge_trash(root: &Path, file: Option<&str>) -> Result<(), String> {
    let trash = trash_dir(root);
    match file {
        Some(f) => {
            let p = trash.join(f);
            if p.exists() {
                fs::remove_file(p).map_err(|e| e.to_string())?;
            }
        }
        None => {
            for n in read_notes(&trash)? {
                fs::remove_file(trash.join(&n.file)).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Partial update of `Meta`; absent fields keep their stored value.
#[derive(Debug, Default, Deserialize)]
pub struct MetaPatch {
    pub viewport: Option<Viewport>,
    pub tag_colors: Option<BTreeMap<String, String>>,
    pub workflows: Option<Vec<Workflow>>,
    pub default_template: Option<String>,
}

pub fn read_meta(root: &Path) -> Meta {
    fs::read_to_string(root.join(META_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_meta(root: &Path, patch: MetaPatch) -> Result<(), String> {
    let mut meta = read_meta(root);
    if let Some(v) = patch.viewport {
        meta.viewport = v;
    }
    if let Some(t) = patch.tag_colors {
        meta.tag_colors = t;
    }
    if let Some(w) = patch.workflows {
        meta.workflows = w;
    }
    if let Some(t) = patch.default_template {
        meta.default_template = t;
    }
    write_meta(root, &meta)
}

fn write_meta(root: &Path, meta: &Meta) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    fs::write(root.join(META_FILE), text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str, title: &str) -> Note {
        Note {
            id: id.into(),
            title: title.into(),
            tags: vec!["a".into(), "b c".into()],
            created: "2026-09-16T10:00:00.000Z".into(),
            modified: "2026-09-16T10:00:00.000Z".into(),
            opened: "2026-09-16T10:00:00.000Z".into(),
            workflow: None,
            status: "todo".into(),
            x: 12.5,
            y: -3.0,
            width: None,
            deps: vec![],
            deleted: None,
            body: "# Hello\n\nworld: yes\n---\nnot frontmatter\n".into(),
            file: String::new(),
        }
    }

    #[test]
    fn roundtrip_and_rename() {
        let dir = std::env::temp_dir().join(format!("dagobert-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let a = save_note(&dir, note("a1", "Design the schema")).unwrap();
        assert_eq!(a.file, "design-the-schema.md");
        let mut b = note("b2", "Migrations");
        b.deps = vec!["a1".into(), "missing".into()];
        let b = save_note(&dir, b).unwrap();

        let p = open(&dir).unwrap();
        assert_eq!(p.notes.len(), 2);
        let ra = p.notes.iter().find(|n| n.id == "a1").unwrap();
        assert_eq!(ra.body, a.body);
        assert_eq!(ra.tags, a.tags);
        assert_eq!(ra.x, 12.5);
        let rb = p.notes.iter().find(|n| n.id == "b2").unwrap();
        assert_eq!(rb.deps, vec!["a1".to_string()], "dangling deps dropped");

        // Rename on title change, collision falls back to id suffix.
        let mut renamed = b.clone();
        renamed.title = "Design the schema".into();
        let renamed = save_note(&dir, renamed).unwrap();
        assert_eq!(renamed.file, "design-the-schema-b2.md");
        assert!(!dir.join("notes/migrations.md").exists());
        assert_eq!(open(&dir).unwrap().notes.len(), 2);

        assert_eq!(p.meta.viewport.zoom, 1.0, "fresh project has a usable zoom");
        let mut tag_colors = BTreeMap::new();
        tag_colors.insert("a".to_string(), "#61afef".to_string());
        save_meta(&dir, MetaPatch { viewport: Some(Viewport { x: 1.0, y: 2.0, zoom: 0.5 }), ..Default::default() }).unwrap();
        let wf = Workflow {
            id: "pr".into(),
            name: "PR".into(),
            stages: vec![Stage { name: "todo".into(), done: false }, Stage { name: "merged".into(), done: true }],
            template: "## Checklist\n- [ ] tests".into(),
        };
        save_meta(&dir, MetaPatch { tag_colors: Some(tag_colors), workflows: Some(vec![wf]), default_template: Some("- [ ] ".into()), ..Default::default() }).unwrap();
        let m = open(&dir).unwrap().meta;
        assert_eq!(m.viewport.zoom, 0.5, "patching tag colours keeps the viewport");
        assert_eq!(m.tag_colors["a"], "#61afef");
        assert_eq!(m.workflows[0].template, "## Checklist\n- [ ] tests");
        assert_eq!(m.default_template, "- [ ] ");
        // Old files without templates still load.
        let legacy: Meta = serde_json::from_str(r#"{"workflows":[{"id":"x","name":"X","stages":[]}]}"#).unwrap();
        assert_eq!(legacy.workflows[0].template, "");
        assert_eq!(legacy.default_template, "");

        // Soft delete: goes to trash/, stamped, and comes back on restore.
        let trashed = delete_note(&dir, &renamed.file, "2026-09-16T11:00:00.000Z").unwrap().unwrap();
        assert_eq!(open(&dir).unwrap().notes.len(), 1);
        assert_eq!(trashed.deleted.as_deref(), Some("2026-09-16T11:00:00.000Z"));
        assert_eq!(list_trash(&dir).unwrap().len(), 1);
        let back = restore_note(&dir, &trashed.file).unwrap();
        assert_eq!(back.deleted, None);
        assert_eq!(back.file, "design-the-schema-b2.md");
        assert_eq!(open(&dir).unwrap().notes.len(), 2);
        assert!(list_trash(&dir).unwrap().is_empty());

        // Two different notes with the same filename never overwrite each other in the trash.
        let c = save_note(&dir, note("c3", "Dup")).unwrap();
        delete_note(&dir, &c.file, "t1").unwrap();
        let d = save_note(&dir, note("d4", "Dup")).unwrap();
        assert_eq!(d.file, "dup.md", "name is free again after the first was trashed");
        delete_note(&dir, &d.file, "t2").unwrap();
        let names: Vec<String> = list_trash(&dir).unwrap().into_iter().map(|n| n.file).collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"dup.md".to_string()) && names.contains(&"dup-d4.md".to_string()), "{names:?}");

        purge_trash(&dir, Some("dup.md")).unwrap();
        assert_eq!(list_trash(&dir).unwrap().len(), 1);
        purge_trash(&dir, None).unwrap();
        assert!(list_trash(&dir).unwrap().is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn legacy_done_migrates_to_status() {
        let n = parse_note("---\nid: x\ntitle: t\ncreated: c\nmodified: m\nopened: o\ndone: true\n---\nbody", "x.md").unwrap();
        assert_eq!(n.status, "done");
        assert_eq!(n.workflow, None);
        let n = parse_note("---\nid: x\ntitle: t\ncreated: c\nmodified: m\nopened: o\nworkflow: pr\nstatus: review\n---\n", "x.md").unwrap();
        assert_eq!(n.status, "review");
        assert_eq!(n.workflow.as_deref(), Some("pr"));
        let out = serialize_note(&n).unwrap();
        assert!(out.contains("workflow: pr\n") && out.contains("status: review\n") && !out.contains("done:"));
    }

    #[test]
    fn slugs() {
        assert_eq!(slugify("  Héllo, World!  "), "héllo-world");
        assert_eq!(slugify(""), "untitled");
        assert_eq!(slugify("///"), "untitled");
    }
}
