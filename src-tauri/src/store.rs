//! On-disk project format: a folder of `notes/<slug>.md` (see docs/storage-and-sync.md).

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

pub const NOTES_DIR: &str = "notes";
pub const TRASH_DIR: &str = "trash";
pub const META_FILE: &str = "dagobert.json";
pub const LOCAL_FILE: &str = "dagobert.local.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created: String,
    pub modified: String,
    /// Workflow id; `None` means the built-in todo/done workflow.
    #[serde(default)]
    pub workflow: Option<String>,
    /// Current stage name within the workflow.
    #[serde(default = "todo")]
    pub status: String,
    /// A tracking issue: done when all its dependencies are done; no own status.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub tracking: bool,
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
    /// Legacy boolean from before workflows existed; read-only, migrated to `status`.
    #[serde(default, skip_serializing)]
    done: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workflow: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    tracking: bool,
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
    /// Optional CSS colour for the status pill; `None` = automatic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

impl Default for Viewport {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        }
    }
}

/// Per-machine state stored in `dagobert.local.json` (never synced).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Local {
    #[serde(default)]
    pub viewport: Viewport,
}

/// Git tracking settings (shared, so every machine behaves the same).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "five")]
    pub interval_min: u32,
}

fn five() -> u32 {
    5
}

impl Default for GitSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_min: five(),
        }
    }
}

/// Project-wide settings stored in `dagobert.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Meta {
    /// Legacy location of the viewport; migrated to `Local` on read, never written back.
    #[serde(default, skip_serializing)]
    viewport: Option<Viewport>,
    /// Tag name -> CSS colour.
    #[serde(default)]
    pub tag_colors: BTreeMap<String, String>,
    /// User-defined workflows (the default todo/done one is implicit).
    #[serde(default)]
    pub workflows: Vec<Workflow>,
    /// GitHub repo aliases: alias -> "owner/name".
    #[serde(default)]
    pub repos: BTreeMap<String, String>,
    /// Default body for new notes on the built-in Todo workflow.
    #[serde(default)]
    pub default_template: String,
    /// Template for new tracking issues.
    #[serde(default)]
    pub tracking_template: String,
    /// User-added swatches shown in colour pickers after the built-in palette.
    #[serde(default)]
    pub palette: Vec<String>,
    #[serde(default)]
    pub git: GitSettings,
}

#[derive(Debug, Serialize)]
pub struct Project {
    pub path: String,
    pub notes: Vec<Note>,
    pub meta: Meta,
    pub local: Local,
}

pub fn notes_dir(root: &Path) -> PathBuf {
    root.join(NOTES_DIR)
}

pub fn trash_dir(root: &Path) -> PathBuf {
    root.join(TRASH_DIR)
}

pub fn note_path(root: &Path, file: &str) -> PathBuf {
    notes_dir(root).join(file)
}

/// Every note in a directory by file name, skipping unparsable files; ids may repeat.
pub fn read_all_notes(dir: &Path) -> Result<Vec<Note>, String> {
    let mut notes = Vec::new();
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
            Ok(n) => notes.push(n),
            Err(e) => eprintln!("skipping {e}"),
        }
    }
    notes.sort_by(|a, b| a.file.cmp(&b.file));
    Ok(notes)
}

/// Reads every note in a directory, skipping unparsable files and duplicate ids.
pub fn read_notes(dir: &Path) -> Result<Vec<Note>, String> {
    let mut seen = HashSet::new();
    let mut notes = read_all_notes(dir)?;
    notes.retain(|n| {
        let fresh = seen.insert(n.id.clone());
        if !fresh {
            eprintln!("skipping {}: duplicate id {}", n.file, n.id);
        }
        fresh
    });
    Ok(notes)
}

/// A filename in `dir` based on `wanted` that doesn't exist yet or is `own` (the note's current file).
pub fn free_name(dir: &Path, wanted: &str, id: &str, own: &str) -> String {
    let free = |name: &str| name == own || !dir.join(name).exists();
    if free(wanted) {
        return wanted.to_string();
    }
    let stem = wanted.strip_suffix(".md").unwrap_or(wanted);
    let mut n = 0;
    loop {
        let candidate = if n == 0 {
            format!("{stem}-{id}.md")
        } else {
            format!("{stem}-{id}-{n}.md")
        };
        if free(&candidate) {
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
        workflow: fm.workflow,
        status: fm
            .status
            .unwrap_or_else(|| if fm.done { "done".into() } else { todo() }),
        tracking: fm.tracking,
        x: fm.x,
        y: fm.y,
        width: fm.width,
        deps: fm.deps,
        deleted: fm.deleted,
        body,
        file: file.to_string(),
    })
}

pub fn serialize_note(note: &Note) -> Result<String, String> {
    let fm = FrontMatter {
        id: note.id.clone(),
        title: note.title.clone(),
        tags: note.tags.clone(),
        created: note.created.clone(),
        modified: note.modified.clone(),
        done: false,
        workflow: note.workflow.clone(),
        status: Some(note.status.clone()),
        tracking: note.tracking,
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

    let mut meta = read_meta(root);
    let local = match read_local(root) {
        Some(l) => l,
        None => {
            // A viewport still in dagobert.json moves to the local file.
            let l = Local {
                viewport: meta.viewport.take().unwrap_or_default(),
            };
            let _ = save_local(root, &l);
            l
        }
    };
    meta.viewport = None;

    Ok(Project {
        path: root.to_string_lossy().to_string(),
        notes,
        meta,
        local,
    })
}

/// Writes a note, renaming its file if the title changed, and returns it with `file` set.
pub fn save_note(root: &Path, mut note: Note) -> Result<Note, String> {
    let dir = notes_dir(root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let wanted = free_name(
        &dir,
        &format!("{}.md", slugify(&note.title)),
        &note.id,
        &note.file,
    );
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

/// Moves a note into `trash/` with a `deleted` stamp, suffixing a name already taken there.
pub fn delete_note(root: &Path, file: &str, deleted_at: &str) -> Result<Option<Note>, String> {
    let src = note_path(root, file);
    if !src.exists() {
        return Ok(None);
    }
    let trash = trash_dir(root);
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let text = fs::read_to_string(&src).map_err(|e| e.to_string())?;
    let mut note = parse_note(&text, file)?;
    note.deleted = Some(deleted_at.to_string());
    note.file = free_name(&trash, file, &note.id, "");
    fs::write(trash.join(&note.file), serialize_note(&note)?).map_err(|e| e.to_string())?;
    fs::remove_file(&src).map_err(|e| e.to_string())?;
    Ok(Some(note))
}

/// Hard-deletes a note file without going through the trash (for empty notes).
pub fn discard_note(root: &Path, file: &str) -> Result<(), String> {
    remove_file(&note_path(root, file))
}

/// Deletes a file; one that's already gone is not an error.
pub fn remove_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
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
    if read_notes(&notes_dir(root))?
        .iter()
        .any(|n| n.id == note.id)
    {
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
        Some(f) => remove_file(&trash.join(f)),
        None => read_notes(&trash)?
            .iter()
            .try_for_each(|n| remove_file(&trash.join(&n.file))),
    }
}

/// Partial update of `Meta`; absent fields keep their stored value.
#[derive(Debug, Default, Deserialize)]
pub struct MetaPatch {
    pub tag_colors: Option<BTreeMap<String, String>>,
    pub workflows: Option<Vec<Workflow>>,
    pub repos: Option<BTreeMap<String, String>>,
    pub default_template: Option<String>,
    pub tracking_template: Option<String>,
    pub palette: Option<Vec<String>>,
    pub git: Option<GitSettings>,
}

pub fn read_meta(root: &Path) -> Meta {
    try_read_meta(root).ok().flatten().unwrap_or_default()
}

/// `None` when there is no file; an unparseable one is an error.
fn try_read_meta(root: &Path) -> Result<Option<Meta>, String> {
    match fs::read_to_string(root.join(META_FILE)) {
        Ok(s) => serde_json::from_str(&s)
            .map(Some)
            .map_err(|e| format!("{META_FILE} is not valid: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Refuses to write over a `dagobert.json` it can't parse, rather than replace it with defaults.
pub fn save_meta(root: &Path, patch: MetaPatch) -> Result<(), String> {
    let mut meta = try_read_meta(root)?.unwrap_or_default();
    if let Some(t) = patch.tag_colors {
        meta.tag_colors = t;
    }
    if let Some(w) = patch.workflows {
        meta.workflows = w;
    }
    if let Some(r) = patch.repos {
        meta.repos = r;
    }
    if let Some(t) = patch.default_template {
        meta.default_template = t;
    }
    if let Some(t) = patch.tracking_template {
        meta.tracking_template = t;
    }
    if let Some(p) = patch.palette {
        meta.palette = p;
    }
    if let Some(g) = patch.git {
        meta.git = g;
    }
    write_json(&root.join(META_FILE), &meta)
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

fn read_local(root: &Path) -> Option<Local> {
    fs::read_to_string(root.join(LOCAL_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

pub fn save_local(root: &Path, local: &Local) -> Result<(), String> {
    write_json(&root.join(LOCAL_FILE), local)
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
            workflow: None,
            status: "todo".into(),
            tracking: false,
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

        assert_eq!(
            p.local.viewport.zoom, 1.0,
            "fresh project has a usable zoom"
        );
        let mut tag_colors = BTreeMap::new();
        tag_colors.insert("a".to_string(), "#61afef".to_string());
        save_local(
            &dir,
            &Local {
                viewport: Viewport {
                    x: 1.0,
                    y: 2.0,
                    zoom: 0.5,
                },
            },
        )
        .unwrap();
        let wf = Workflow {
            id: "pr".into(),
            name: "PR".into(),
            stages: vec![
                Stage {
                    name: "todo".into(),
                    done: false,
                    color: None,
                },
                Stage {
                    name: "merged".into(),
                    done: true,
                    color: Some("#61afef".into()),
                },
            ],
            template: "## Checklist\n- [ ] tests".into(),
        };
        save_meta(
            &dir,
            MetaPatch {
                tag_colors: Some(tag_colors),
                workflows: Some(vec![wf]),
                default_template: Some("- [ ] ".into()),
                palette: Some(vec!["#ff8800".into()]),
                ..Default::default()
            },
        )
        .unwrap();
        let p = open(&dir).unwrap();
        let m = p.meta;
        assert_eq!(m.palette, vec!["#ff8800".to_string()]);
        assert_eq!(
            p.local.viewport.zoom, 0.5,
            "patching tag colours keeps the viewport"
        );
        assert_eq!(m.tag_colors["a"], "#61afef");
        assert_eq!(m.workflows[0].template, "## Checklist\n- [ ] tests");
        assert_eq!(m.default_template, "- [ ] ");
        // Old files without templates still load.
        let legacy: Meta =
            serde_json::from_str(r#"{"workflows":[{"id":"x","name":"X","stages":[]}]}"#).unwrap();
        assert_eq!(legacy.workflows[0].template, "");
        assert_eq!(legacy.default_template, "");
        assert!(legacy.palette.is_empty());
        assert!(!legacy.git.enabled && legacy.git.interval_min == 5);

        // Soft delete: goes to trash/, stamped, and comes back on restore.
        let trashed = delete_note(&dir, &renamed.file, "2026-09-16T11:00:00.000Z")
            .unwrap()
            .unwrap();
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
        assert_eq!(
            d.file, "dup.md",
            "name is free again after the first was trashed"
        );
        delete_note(&dir, &d.file, "t2").unwrap();
        let names: Vec<String> = list_trash(&dir)
            .unwrap()
            .into_iter()
            .map(|n| n.file)
            .collect();
        assert_eq!(names.len(), 2);
        assert!(
            names.contains(&"dup.md".to_string()) && names.contains(&"dup-d4.md".to_string()),
            "{names:?}"
        );

        purge_trash(&dir, Some("dup.md")).unwrap();
        assert_eq!(list_trash(&dir).unwrap().len(), 1);
        purge_trash(&dir, None).unwrap();
        assert!(list_trash(&dir).unwrap().is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn corrupt_meta_is_never_overwritten() {
        let dir = std::env::temp_dir().join(format!("dagobert-badmeta-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(META_FILE), "{ not json").unwrap();
        assert!(save_meta(&dir, MetaPatch::default()).is_err());
        assert_eq!(
            fs::read_to_string(dir.join(META_FILE)).unwrap(),
            "{ not json"
        );
        assert!(
            read_meta(&dir).palette.is_empty(),
            "reads fall back to defaults"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn legacy_viewport_moves_to_local_file() {
        let dir = std::env::temp_dir().join(format!("dagobert-local-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(META_FILE),
            r##"{"viewport":{"x":3.0,"y":4.0,"zoom":2.0},"palette":["#123456"]}"##,
        )
        .unwrap();
        let p = open(&dir).unwrap();
        assert_eq!(p.local.viewport.zoom, 2.0);
        assert_eq!(p.meta.palette, vec!["#123456".to_string()]);
        assert!(dir.join(LOCAL_FILE).exists());
        // The local file now wins, and the next meta write drops the legacy field.
        save_local(
            &dir,
            &Local {
                viewport: Viewport {
                    x: 0.0,
                    y: 0.0,
                    zoom: 0.25,
                },
            },
        )
        .unwrap();
        save_meta(&dir, MetaPatch::default()).unwrap();
        assert!(!fs::read_to_string(dir.join(META_FILE))
            .unwrap()
            .contains("viewport"));
        assert_eq!(open(&dir).unwrap().local.viewport.zoom, 0.25);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn legacy_done_migrates_to_status() {
        let n = parse_note(
            "---\nid: x\ntitle: t\ncreated: c\nmodified: m\ndone: true\n---\nbody",
            "x.md",
        )
        .unwrap();
        assert_eq!(n.status, "done");
        assert_eq!(n.workflow, None);
        let n = parse_note(
            "---\nid: x\ntitle: t\ncreated: c\nmodified: m\nworkflow: pr\nstatus: review\n---\n",
            "x.md",
        )
        .unwrap();
        assert_eq!(n.status, "review");
        assert_eq!(n.workflow.as_deref(), Some("pr"));
        let out = serialize_note(&n).unwrap();
        assert!(
            out.contains("workflow: pr\n")
                && out.contains("status: review\n")
                && !out.contains("done:")
        );
    }

    #[test]
    fn suffixed_name_is_stable() {
        let dir = std::env::temp_dir().join(format!("dagobert-suffix-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        save_note(&dir, note("a", "Same")).unwrap();
        let b = save_note(&dir, note("b", "Same")).unwrap();
        let b2 = save_note(&dir, b.clone()).unwrap();
        let b3 = save_note(&dir, b2.clone()).unwrap();
        fs::remove_dir_all(&dir).unwrap();
        assert_eq!([b.file, b2.file, b3.file], ["same-b.md"; 3]);
    }

    #[test]
    fn slugs() {
        assert_eq!(slugify("  Héllo, World!  "), "héllo-world");
        assert_eq!(slugify(""), "untitled");
        assert_eq!(slugify("///"), "untitled");
    }
}
