//! Resolves the conflicts a pull leaves behind so the repository is never left
//! mid-merge. Notes are merged by rule (see `CLAUDE.md`): the side with the
//! later `modified` wins the frontmatter, tags and deps are merged three-way, and the
//! body is three-way merged, keeping git's conflict markers when it can't be.

use crate::git::{self, Result};
use crate::store::{self, Note};
use git2::{IndexEntry, MergeFileOptions, Repository};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct Conflict {
    pub id: String,
    pub title: String,
    pub file: String,
    /// The body still holds `<<<<<<<` markers the user has to clean up.
    pub body_conflict: bool,
}

/// One side of a conflicted note, parsed.
struct Side {
    note: Option<Note>,
}

type Blob = Option<Vec<u8>>;

fn blob(repo: &Repository, e: &Option<IndexEntry>) -> Result<Blob> {
    match e {
        Some(e) => Ok(Some(
            repo.find_blob(e.id)
                .map_err(|e| e.message().to_string())?
                .content()
                .to_vec(),
        )),
        None => Ok(None),
    }
}

fn side(bytes: &Blob, file: &str) -> Side {
    Side {
        note: bytes
            .as_ref()
            .and_then(|b| String::from_utf8(b.clone()).ok())
            .and_then(|t| store::parse_note(&t, file).ok()),
    }
}

/// Three-way list merge: ours first, then theirs' additions; an item one side
/// removed (it was in the ancestor) stays removed.
fn merge_list(anc: &[String], a: &[String], b: &[String]) -> Vec<String> {
    let removed = |x: &String| anc.contains(x) && (!a.contains(x) || !b.contains(x));
    let mut out: Vec<String> = a.iter().filter(|x| !removed(x)).cloned().collect();
    for x in b {
        if !out.contains(x) && !removed(x) {
            out.push(x.clone());
        }
    }
    out
}

/// Merged frontmatter, whether ours won, and the deps added on one side only
/// (each with the `modified` of the side that has it, for the cycle check).
fn merge_frontmatter(
    ours: &Note,
    theirs: &Note,
    ancestor: Option<&Note>,
) -> (Note, bool, Vec<(String, String)>) {
    let ours_win = ours.modified >= theirs.modified;
    let winner = if ours_win { ours } else { theirs };
    let mut out = winner.clone();
    let (anc_tags, anc_deps) = ancestor.map_or((&[][..], &[][..]), |a| (&a.tags[..], &a.deps[..]));
    out.tags = merge_list(anc_tags, &ours.tags, &theirs.tags);
    out.deps = merge_list(anc_deps, &ours.deps, &theirs.deps);
    out.created = std::cmp::min(&ours.created, &theirs.created).clone();
    out.modified = std::cmp::max(&ours.modified, &theirs.modified).clone();
    let candidates = out
        .deps
        .iter()
        .filter_map(|d| match (ours.deps.contains(d), theirs.deps.contains(d)) {
            (true, true) => None,
            (true, false) => Some((d.clone(), ours.modified.clone())),
            _ => Some((d.clone(), theirs.modified.clone())),
        })
        .collect();
    (out, ours_win, candidates)
}

/// Three-way merge of the bodies; `true` when the result carries markers.
fn merge_body(
    repo: &Repository,
    anc: Option<&str>,
    ours: &str,
    theirs: &str,
) -> Result<(String, bool)> {
    let anc = anc.unwrap_or("");
    if ours == theirs || theirs == anc {
        return Ok((ours.to_string(), false));
    }
    if ours == anc {
        return Ok((theirs.to_string(), false));
    }
    let entry = |text: &str| -> Result<IndexEntry> {
        let id = repo
            .blob(text.as_bytes())
            .map_err(|e| e.message().to_string())?;
        Ok(IndexEntry {
            ctime: git2::IndexTime::new(0, 0),
            mtime: git2::IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode: 0o100644,
            uid: 0,
            gid: 0,
            file_size: text.len() as u32,
            id,
            flags: 0,
            flags_extended: 0,
            path: b"body.md".to_vec(),
        })
    };
    let mut opts = MergeFileOptions::new();
    opts.our_label("mine").their_label("theirs");
    let r = repo
        .merge_file_from_index(
            &entry(anc)?,
            &entry(ours)?,
            &entry(theirs)?,
            Some(&mut opts),
        )
        .map_err(|e| e.message().to_string())?;
    let text = String::from_utf8_lossy(r.content()).to_string();
    Ok((text, !r.is_automergeable()))
}

/// Rule 6: maps are unioned (ours wins per key), workflows merged by id, scalars ours.
fn merge_meta(ours: &Value, theirs: &Value) -> Value {
    let (o, t) = match (ours.as_object(), theirs.as_object()) {
        (Some(o), Some(t)) => (o, t),
        (Some(_), None) => return ours.clone(),
        _ => return theirs.clone(),
    };
    let mut out = o.clone();
    for key in ["tag_colors", "repos"] {
        let mut m: Map<String, Value> = t
            .get(key)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        for (k, v) in o.get(key).and_then(Value::as_object).into_iter().flatten() {
            m.insert(k.clone(), v.clone());
        }
        if !m.is_empty() {
            out.insert(key.into(), Value::Object(m));
        }
    }
    let mut palette: Vec<Value> = o
        .get("palette")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for v in t
        .get("palette")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if !palette.contains(v) {
            palette.push(v.clone());
        }
    }
    if !palette.is_empty() {
        out.insert("palette".into(), Value::Array(palette));
    }
    let mut workflows: Vec<Value> = o
        .get("workflows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let ids: HashSet<String> = workflows
        .iter()
        .filter_map(|w| w.get("id").and_then(Value::as_str).map(str::to_string))
        .collect();
    for w in t
        .get("workflows")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if !w
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| ids.contains(id))
        {
            workflows.push(w.clone());
        }
    }
    if !workflows.is_empty() {
        out.insert("workflows".into(), Value::Array(workflows));
    }
    for (k, v) in t {
        out.entry(k.clone()).or_insert_with(|| v.clone());
    }
    Value::Object(out)
}

const NOTE_DIRS: [&str; 2] = ["notes", "trash"];

/// Where a conflicted index path sits, relative to the project root.
enum Kind {
    Note { dir: &'static str, file: String },
    Meta,
    Other,
}

fn classify(rel: &Path) -> Kind {
    let s = rel.to_string_lossy();
    if s == "dagobert.json" {
        return Kind::Meta;
    }
    for dir in NOTE_DIRS {
        if let Some(file) = s.strip_prefix(&format!("{dir}/")) {
            if !file.contains('/') && file.ends_with(".md") {
                return Kind::Note {
                    dir,
                    file: file.to_string(),
                };
            }
        }
    }
    Kind::Other
}

/// One note as one side of the merge saw it: its file name and content.
type Versions = HashMap<String, (String, Note)>;

#[derive(Default)]
struct Sides {
    ours: Versions,
    theirs: Versions,
    ancestor: HashMap<String, Note>,
    /// Every conflicted path in this directory (file names).
    paths: Vec<String>,
    /// Ids whose other side existed but didn't parse: report them anyway.
    broken: HashSet<String>,
}

struct Ctx<'a> {
    repo: &'a Repository,
    /// Project root relative to the work tree.
    prefix: PathBuf,
    root: &'a Path,
    /// Every note in the merge base, by id (a rename on both sides leaves the
    /// conflicted paths without an ancestor).
    base: HashMap<String, Note>,
    report: Vec<Conflict>,
    /// (dependent id, dep id, stamp of the side that has the edge).
    candidates: Vec<(String, String, String)>,
}

impl Ctx<'_> {
    fn stage(&self, index: &mut git2::Index, rel: &Path, text: &str) -> Result<()> {
        let abs = self.root.join(rel);
        if let Some(p) = abs.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        fs::write(&abs, text).map_err(|e| e.to_string())?;
        index
            .add_path(&self.prefix.join(rel))
            .map_err(|e| e.message().to_string())
    }

    fn unstage(&self, index: &mut git2::Index, rel: &Path) -> Result<()> {
        let abs = self.root.join(rel);
        if abs.exists() {
            fs::remove_file(&abs).map_err(|e| e.to_string())?;
        }
        index
            .remove_path(&self.prefix.join(rel))
            .map_err(|e| e.message().to_string())
    }

    fn write_note(&self, index: &mut git2::Index, dir: &str, note: &Note) -> Result<()> {
        self.stage(
            index,
            &Path::new(dir).join(&note.file),
            &store::serialize_note(note)?,
        )
    }

    fn note_in(&self, tree: Option<&git2::Tree>, dir: &str, file: &str) -> Option<Note> {
        let entry = tree?.get_path(&self.prefix.join(dir).join(file)).ok()?;
        let blob = self.repo.find_blob(entry.id()).ok()?;
        let text = String::from_utf8(blob.content().to_vec()).ok()?;
        store::parse_note(&text, file).ok()
    }

    /// Every note under `notes/` and `trash/` in `tree`, by id (`notes/` wins).
    fn notes_in(&self, tree: Option<&git2::Tree>) -> HashMap<String, Note> {
        let mut out = HashMap::new();
        for dir in NOTE_DIRS.iter().rev() {
            let Some(t) = tree else { break };
            let Ok(entry) = t.get_path(&self.prefix.join(dir)) else {
                continue;
            };
            let Ok(sub) = entry.to_object(self.repo).and_then(|o| o.peel_to_tree()) else {
                continue;
            };
            for e in sub.iter() {
                let Some(file) = e.name().filter(|n| n.ends_with(".md")) else {
                    continue;
                };
                if let Some(n) = self.note_in(tree, dir, file) {
                    out.insert(n.id.clone(), n);
                }
            }
        }
        out
    }

    /// Merges two versions of one note and writes the result at the winner's
    /// file name, dropping the loser's file when it differs.
    fn merge_pair(
        &mut self,
        index: &mut git2::Index,
        dir: &str,
        ours: &Note,
        theirs: &Note,
        ancestor: Option<&Note>,
    ) -> Result<Note> {
        let (mut merged, ours_won, candidates) = merge_frontmatter(ours, theirs, ancestor);
        let (body, marked) = merge_body(
            self.repo,
            ancestor.map(|n| n.body.as_str()),
            &ours.body,
            &theirs.body,
        )?;
        merged.body = body;
        let (winner, loser) = if ours_won {
            (ours, theirs)
        } else {
            (theirs, ours)
        };
        merged.file = winner.file.clone();
        self.write_note(index, dir, &merged)?;
        if loser.file != winner.file {
            self.unstage(index, &Path::new(dir).join(&loser.file))?;
        }
        if dir == "notes" {
            self.candidates.extend(
                candidates
                    .into_iter()
                    .map(|(d, stamp)| (merged.id.clone(), d, stamp)),
            );
            self.report(&merged, marked);
        }
        Ok(merged)
    }

    fn report(&mut self, note: &Note, body_conflict: bool) {
        if let Some(c) = self.report.iter_mut().find(|c| c.id == note.id) {
            c.body_conflict |= body_conflict;
            c.title = note.title.clone();
            c.file = note.file.clone();
        } else {
            self.report.push(Conflict {
                id: note.id.clone(),
                title: note.title.clone(),
                file: note.file.clone(),
                body_conflict,
            });
        }
    }

    /// Resolves the conflicted notes of one directory, by id.
    fn resolve_dir(&mut self, index: &mut git2::Index, dir: &str, s: Sides) -> Result<()> {
        let mut written: HashSet<String> = HashSet::new();
        let mut ids: Vec<&String> = s.ours.keys().collect();
        ids.sort();
        let mut their_ids: Vec<&String> = s
            .theirs
            .keys()
            .filter(|id| !s.ours.contains_key(*id))
            .collect();
        their_ids.sort();
        ids.extend(their_ids);
        for id in ids {
            let anc = s.ancestor.get(id).or_else(|| self.base.get(id)).cloned();
            let report = dir == "notes" && (anc.is_some() || s.broken.contains(id));
            match (s.ours.get(id), s.theirs.get(id)) {
                (Some((_, o)), Some((_, t))) => {
                    let m = self.merge_pair(index, dir, o, t, anc.as_ref())?;
                    written.insert(m.file);
                }
                (Some((_, o)), None) => {
                    // Theirs deleted (or never had) it; ours stays.
                    self.write_note(index, dir, o)?;
                    written.insert(o.file.clone());
                    if report {
                        self.report(o, false);
                    }
                }
                (None, Some((_, t))) => {
                    let mut t = t.clone();
                    // Their new file may clash with a different note of ours.
                    if written.contains(&t.file) {
                        t.file = store::free_name(&self.root.join(dir), &t.file, &t.id);
                    }
                    self.write_note(index, dir, &t)?;
                    written.insert(t.file.clone());
                    if report {
                        self.report(&t, false);
                    }
                }
                (None, None) => {}
            }
        }
        for p in s.paths {
            if !written.contains(&p) {
                self.unstage(index, &Path::new(dir).join(&p))?;
            }
        }
        Ok(())
    }

    /// Two files with the same id (a note renamed on both sides slips past git
    /// as a delete plus two adds) are merged into one.
    fn dedupe(
        &mut self,
        index: &mut git2::Index,
        dir: &str,
        head: Option<&git2::Tree>,
    ) -> Result<()> {
        let path = self.root.join(dir);
        if !path.exists() {
            return Ok(());
        }
        let mut by_id: HashMap<String, Vec<Note>> = HashMap::new();
        let mut names: Vec<String> = fs::read_dir(&path)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|f| f.ends_with(".md"))
            .collect();
        names.sort();
        for file in names {
            let text = fs::read_to_string(path.join(&file)).map_err(|e| e.to_string())?;
            if let Ok(n) = store::parse_note(&text, &file) {
                by_id.entry(n.id.clone()).or_default().push(n);
            }
        }
        let mut ids: Vec<String> = by_id.keys().cloned().collect();
        ids.sort();
        for id in ids {
            let mut group = by_id.remove(&id).unwrap();
            if group.len() < 2 {
                continue;
            }
            let ours_at = group
                .iter()
                .position(|n| self.note_in(head, dir, &n.file).is_some_and(|h| h.id == id))
                .unwrap_or(0);
            let mut cur = group.remove(ours_at);
            let anc = self.base.get(&id).cloned();
            for theirs in group {
                cur = self.merge_pair(index, dir, &cur, &theirs, anc.as_ref())?;
            }
        }
        Ok(())
    }

    /// Rule 3: of the edges added since the merge base (on either side, whether
    /// or not git saw a conflict), newest first, keep those that don't close a cycle.
    fn break_cycles(&mut self, index: &mut git2::Index) -> Result<()> {
        let mut notes: HashMap<String, Note> = store::read_notes(&store::notes_dir(self.root))?
            .into_iter()
            .map(|n| (n.id.clone(), n))
            .collect();
        let original: HashMap<String, Vec<String>> = notes
            .iter()
            .map(|(k, n)| (k.clone(), n.deps.clone()))
            .collect();
        // A merged note's stamp is the later side's; `merge_pair` knows which
        // side actually added each edge.
        let stamps: HashMap<(&str, &str), &str> = self
            .candidates
            .iter()
            .map(|(id, dep, s)| ((id.as_str(), dep.as_str()), s.as_str()))
            .collect();
        let mut order: Vec<(String, String, String)> = Vec::new();
        for (id, n) in &notes {
            let base_deps = self.base.get(id).map(|b| b.deps.as_slice()).unwrap_or(&[]);
            for dep in n.deps.iter().filter(|d| !base_deps.contains(d)) {
                let stamp = stamps
                    .get(&(id.as_str(), dep.as_str()))
                    .map_or(n.modified.as_str(), |s| s);
                order.push((id.clone(), dep.clone(), stamp.to_string()));
            }
        }
        if order.is_empty() {
            return Ok(());
        }
        for (id, dep, _) in &order {
            if let Some(n) = notes.get_mut(id) {
                n.deps.retain(|d| d != dep);
            }
        }
        order.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| (&a.0, &a.1).cmp(&(&b.0, &b.1))));
        let mut dropped: HashSet<(String, String)> = HashSet::new();
        for (id, dep, _) in order {
            if reaches(&notes, &dep, &id) {
                dropped.insert((id, dep));
            } else if let Some(n) = notes.get_mut(&id) {
                n.deps.push(dep);
            }
        }
        let mut changed: Vec<String> = dropped.iter().map(|(id, _)| id.clone()).collect();
        changed.sort();
        changed.dedup();
        for id in changed {
            if let Some(n) = notes.get_mut(&id) {
                n.deps = original[&id]
                    .iter()
                    .filter(|d| !dropped.contains(&(id.clone(), (*d).clone())))
                    .cloned()
                    .collect();
                let note = n.clone();
                self.write_note(index, "notes", &note)?;
            }
        }
        Ok(())
    }

    /// A note alive in `notes/` loses any copy of itself in `trash/`.
    fn drop_trash_copies(&self, index: &mut git2::Index) -> Result<()> {
        let live: HashSet<String> = store::read_notes(&store::notes_dir(self.root))?
            .into_iter()
            .map(|n| n.id)
            .collect();
        for t in store::read_notes(&store::trash_dir(self.root))? {
            if live.contains(&t.id) {
                self.unstage(index, &Path::new("trash").join(&t.file))?;
            }
        }
        Ok(())
    }
}

/// Completes the merge left by `git::pull` (`PullOutcome::Merging`): resolves
/// every conflict, folds files that share a note id (a rename on both sides
/// slips past git as two adds), commits with `message`, and lists the notes touched.
pub fn resolve(root: &Path, message: &str) -> Result<Vec<Conflict>> {
    let mut repo = git::open(root)?.ok_or("not a repository")?;
    if repo.state() != git2::RepositoryState::Merge {
        return Ok(vec![]);
    }
    let wd = repo
        .workdir()
        .ok_or("bare repository")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let prefix = root
        .canonicalize()
        .map_err(|e| e.to_string())?
        .strip_prefix(&wd)
        .map_err(|_| "project is outside the repository".to_string())?
        .to_path_buf();
    let head_oid = repo.head().ok().and_then(|h| h.target());
    let mut merge_heads = Vec::new();
    repo.mergehead_foreach(|o| {
        merge_heads.push(*o);
        true
    })
    .map_err(|e| e.message().to_string())?;
    let head_tree = head_oid.and_then(|o| repo.find_commit(o).ok()?.tree().ok());
    let base_tree = head_oid
        .zip(merge_heads.first().copied())
        .and_then(|(h, m)| repo.merge_base(h, m).ok())
        .and_then(|o| repo.find_commit(o).ok()?.tree().ok());

    let mut index = repo.index().map_err(|e| e.message().to_string())?;
    let conflicts: Vec<git2::IndexConflict> = index
        .conflicts()
        .map_err(|e| e.message().to_string())?
        .filter_map(|c| c.ok())
        .collect();
    let mut sides: HashMap<&'static str, Sides> = HashMap::new();
    let mut meta: Option<(Blob, Blob, Blob)> = None;
    let mut foreign: Vec<String> = Vec::new();
    let mut ctx = Ctx {
        repo: &repo,
        prefix,
        root,
        base: HashMap::new(),
        report: Vec::new(),
        candidates: Vec::new(),
    };
    ctx.base = ctx.notes_in(base_tree.as_ref());

    for c in conflicts {
        let entry = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref());
        let Some(entry) = entry else { continue };
        let path = PathBuf::from(String::from_utf8_lossy(&entry.path).to_string());
        let kind = path.strip_prefix(&ctx.prefix).map_or(Kind::Other, classify);
        match kind {
            Kind::Note { dir, file } => {
                let (ours, theirs) = (blob(&repo, &c.our)?, blob(&repo, &c.their)?);
                let (o, t) = (side(&ours, &file).note, side(&theirs, &file).note);
                let s = sides.entry(dir).or_default();
                // A file neither side can parse is left as git merged it.
                if o.is_none() && t.is_none() {
                    keep_worktree(&mut index, &path)?;
                    continue;
                }
                s.paths.push(file.clone());
                if let Some(n) = side(&blob(&repo, &c.ancestor)?, &file).note {
                    s.ancestor.insert(n.id.clone(), n);
                }
                for (n, other, other_blob) in [(&o, &t, &theirs), (&t, &o, &ours)] {
                    if let Some(n) = n
                        .as_ref()
                        .filter(|_| other.is_none() && other_blob.is_some())
                    {
                        s.broken.insert(n.id.clone());
                    }
                }
                if let Some(n) = o {
                    s.ours.insert(n.id.clone(), (file.clone(), n));
                }
                if let Some(n) = t {
                    s.theirs.insert(n.id.clone(), (file.clone(), n));
                }
            }
            Kind::Meta => {
                meta = Some((
                    blob(&repo, &c.our)?,
                    blob(&repo, &c.their)?,
                    blob(&repo, &c.ancestor)?,
                ))
            }
            Kind::Other => foreign.push(path.to_string_lossy().to_string()),
        }
    }
    // Conflicts in files that aren't ours are the user's to resolve with git;
    // the merge stays in progress and every cycle reports it until then.
    if !foreign.is_empty() {
        foreign.sort();
        return Err(format!(
            "Merge conflict outside Dagobert's files: {}. Resolve it with git, then sync again.",
            foreign.join(", ")
        ));
    }

    for dir in NOTE_DIRS {
        if let Some(s) = sides.remove(dir) {
            ctx.resolve_dir(&mut index, dir, s)?;
        }
    }
    for dir in NOTE_DIRS {
        ctx.dedupe(&mut index, dir, head_tree.as_ref())?;
    }
    ctx.drop_trash_copies(&mut index)?;
    ctx.break_cycles(&mut index)?;

    if let Some((ours, theirs, ancestor)) = meta {
        let parse = |b: Option<Vec<u8>>| b.and_then(|b| serde_json::from_slice::<Value>(&b).ok());
        let merged = match (parse(ours), parse(theirs)) {
            (Some(o), Some(t)) => Some(merge_meta(&o, &t)),
            (Some(v), None) | (None, Some(v)) => Some(v),
            (None, None) => parse(ancestor),
        };
        match merged {
            Some(v) => {
                let text = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
                ctx.stage(&mut index, Path::new("dagobert.json"), &text)?;
            }
            None => keep_worktree(&mut index, &ctx.prefix.join("dagobert.json"))?,
        }
    }

    index.write().map_err(|e| e.message().to_string())?;
    let report = ctx.report;
    drop((index, head_tree, base_tree));
    git::commit_merge(&mut repo, message)?;
    Ok(report)
}

/// Stages a conflicted file as it sits in the work tree (libgit2 already wrote
/// markers into it); the user sorts it out with git.
fn keep_worktree(index: &mut git2::Index, path: &Path) -> Result<()> {
    match index.add_path(path) {
        Ok(()) => Ok(()),
        Err(_) => index.remove_path(path).map_err(|e| e.message().to_string()),
    }
}

/// Can `from` reach `to` by following `deps`?
fn reaches(notes: &HashMap<String, Note>, from: &str, to: &str) -> bool {
    let mut stack = vec![from.to_string()];
    let mut seen = HashSet::new();
    while let Some(cur) = stack.pop() {
        if cur == to {
            return true;
        }
        if !seen.insert(cur.clone()) {
            continue;
        }
        if let Some(n) = notes.get(&cur) {
            stack.extend(n.deps.iter().cloned());
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests::{pair, write_note};
    use crate::git::{commit_if_dirty, pull, push, PullOutcome};
    use crate::store::{delete_note, open, parse_note, save_note, Note};

    fn note(id: &str, title: &str, modified: &str, deps: &[&str]) -> Note {
        Note {
            id: id.into(),
            title: title.into(),
            tags: vec![],
            created: "2026-01-01T00:00:00.000Z".into(),
            modified: modified.into(),
            opened: "o".into(),
            workflow: None,
            status: "todo".into(),
            tracking: false,
            x: 0.0,
            y: 0.0,
            width: None,
            deps: deps.iter().map(|s| s.to_string()).collect(),
            deleted: None,
            body: "body".into(),
            file: String::new(),
        }
    }

    /// Both clones start from the same commit holding `notes`.
    fn seeded(name: &str, notes: Vec<Note>) -> (PathBuf, PathBuf, PathBuf) {
        let (base, a, b) = pair(name);
        for n in notes {
            save_note(&a, n).unwrap();
        }
        commit_if_dirty(&a, "seed").unwrap();
        push(&a, None).unwrap();
        assert_eq!(pull(&b, None).unwrap(), PullOutcome::FastForward);
        (base, a, b)
    }

    fn edit(root: &Path, id: &str, f: impl FnOnce(&mut Note)) {
        let p = open(root).unwrap();
        let mut n = p.notes.into_iter().find(|n| n.id == id).unwrap();
        f(&mut n);
        save_note(root, n).unwrap();
    }

    /// A pushes, B commits, pulls (conflict) and resolves; returns B's report.
    fn sync_b(a: &Path, b: &Path) -> Vec<Conflict> {
        commit_if_dirty(a, "a").unwrap();
        push(a, None).unwrap();
        commit_if_dirty(b, "b").unwrap();
        assert_eq!(pull(b, None).unwrap(), PullOutcome::Merging);
        let r = resolve(b, "merge").unwrap();
        assert_eq!(
            Repository::open(b).unwrap().state(),
            git2::RepositoryState::Clean
        );
        assert!(!git::status(b).unwrap().dirty, "everything is committed");
        push(b, None).unwrap();
        r
    }

    #[test]
    fn later_modified_wins_frontmatter_unions_tags_and_deps() {
        let (base, a, b) = seeded(
            "merge-fm",
            vec![
                note("x", "X", "2026-01-01T00:00:00.000Z", &[]),
                note("d1", "D1", "2026-01-01T00:00:00.000Z", &[]),
                note("d2", "D2", "2026-01-01T00:00:00.000Z", &[]),
            ],
        );
        edit(&a, "x", |n| {
            n.title = "X from a".into();
            n.tags = vec!["a".into()];
            n.deps = vec!["d1".into()];
            n.modified = "2026-01-02T00:00:00.000Z".into();
            n.x = 10.0;
        });
        edit(&b, "x", |n| {
            n.title = "X from b".into();
            n.tags = vec!["b".into()];
            n.deps = vec!["d2".into()];
            n.modified = "2026-01-03T00:00:00.000Z".into();
            n.x = 20.0;
        });
        let report = sync_b(&a, &b);
        assert_eq!(report.len(), 1);
        assert!(!report[0].body_conflict);
        let p = open(&b).unwrap();
        assert_eq!(
            p.notes.len(),
            3,
            "the rename on each side didn't duplicate x"
        );
        let x = p.notes.iter().find(|n| n.id == "x").unwrap();
        assert_eq!(x.title, "X from b");
        assert_eq!(x.file, "x-from-b.md");
        assert!(!b.join("notes/x-from-a.md").exists());
        assert_eq!(x.x, 20.0);
        assert_eq!(x.tags, vec!["b".to_string(), "a".to_string()], "ours first");
        assert_eq!(x.deps, vec!["d2".to_string(), "d1".to_string()]);
        assert_eq!(x.modified, "2026-01-03T00:00:00.000Z");
        assert_eq!(x.body, "body");
        // A removal on one side beats the other side keeping it.
        pull(&a, None).unwrap();
        edit(&a, "x", |n| {
            n.tags = vec!["a".into()];
            n.deps = vec!["d1".into()];
            n.modified = "2026-01-04T00:00:00.000Z".into();
        });
        edit(&b, "x", |n| {
            n.body = "kept".into();
            n.modified = "2026-01-05T00:00:00.000Z".into();
        });
        sync_b(&a, &b);
        let p = open(&b).unwrap();
        let x = p.notes.iter().find(|n| n.id == "x").unwrap();
        assert_eq!(x.tags, vec!["a".to_string()]);
        assert_eq!(x.deps, vec!["d1".to_string()]);
        assert_eq!(x.body, "kept");
        // A picks the merge up cleanly.
        assert_eq!(pull(&a, None).unwrap(), PullOutcome::FastForward);
        assert_eq!(
            open(&a)
                .unwrap()
                .notes
                .iter()
                .find(|n| n.id == "x")
                .unwrap()
                .title,
            "X from b"
        );
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn body_conflict_keeps_markers_and_one_sided_edit_wins() {
        let (base, a, b) = seeded(
            "merge-body",
            vec![note("x", "X", "m", &[]), note("y", "Y", "m", &[])],
        );
        edit(&a, "x", |n| n.body = "line from a".into());
        edit(&b, "x", |n| n.body = "line from b".into());
        // y: only a changes the body, but both touch frontmatter.
        edit(&a, "y", |n| {
            n.body = "new y".into();
            n.modified = "m2".into();
        });
        edit(&b, "y", |n| n.modified = "m3".into());
        let mut report = sync_b(&a, &b);
        report.sort_by(|p, q| p.id.cmp(&q.id));
        assert_eq!(report.len(), 2);
        assert!(report[0].body_conflict && !report[1].body_conflict);
        let p = open(&b).unwrap();
        let x = p.notes.iter().find(|n| n.id == "x").unwrap();
        assert!(
            x.body
                .contains("<<<<<<< mine\nline from b\n=======\nline from a\n>>>>>>> theirs"),
            "{}",
            x.body
        );
        assert_eq!(x.title, "X", "frontmatter still parses");
        let y = p.notes.iter().find(|n| n.id == "y").unwrap();
        assert_eq!(y.body, "new y");
        assert_eq!(y.modified, "m3");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn edit_beats_delete_and_removes_trash_copy() {
        let (base, a, b) = seeded("merge-del", vec![note("x", "X", "m", &[])]);
        edit(&a, "x", |n| n.body = "edited on a".into());
        delete_note(&b, "x.md", "2026-02-01T00:00:00.000Z").unwrap();
        assert!(b.join("trash/x.md").exists());
        let report = sync_b(&a, &b);
        assert_eq!(report.len(), 1);
        assert!(b.join("notes/x.md").exists() && !b.join("trash/x.md").exists());
        assert_eq!(open(&b).unwrap().notes[0].body, "edited on a");
        assert!(store::list_trash(&b).unwrap().is_empty());
        // The other way round.
        edit(&b, "x", |n| n.body = "edited on b".into());
        commit_if_dirty(&b, "b").unwrap();
        push(&b, None).unwrap();
        pull(&a, None).unwrap();
        delete_note(&a, "x.md", "t").unwrap();
        edit(&b, "x", |n| n.body = "edited again on b".into());
        commit_if_dirty(&a, "a").unwrap();
        push(&a, None).unwrap();
        commit_if_dirty(&b, "b").unwrap();
        assert_eq!(pull(&b, None).unwrap(), PullOutcome::Merging);
        resolve(&b, "merge").unwrap();
        assert!(b.join("notes/x.md").exists() && !b.join("trash/x.md").exists());
        assert_eq!(open(&b).unwrap().notes[0].body, "edited again on b");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn add_add_with_different_ids_keeps_both() {
        let (base, a, b) = seeded("merge-addadd", vec![]);
        write_note(&a, "plan.md", "id-a", "Plan", "from a");
        write_note(&b, "plan.md", "id-b", "Plan", "from b");
        let report = sync_b(&a, &b);
        assert!(report.is_empty(), "nothing needs attention");
        let p = open(&b).unwrap();
        assert_eq!(p.notes.len(), 2);
        let ours = p.notes.iter().find(|n| n.id == "id-b").unwrap();
        let theirs = p.notes.iter().find(|n| n.id == "id-a").unwrap();
        assert_eq!(ours.file, "plan.md");
        assert_eq!(theirs.file, "plan-id-a.md");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn unioned_deps_never_form_a_cycle() {
        let (base, a, b) = seeded(
            "merge-cycle",
            vec![note("p", "P", "m", &[]), note("q", "Q", "m", &[])],
        );
        // a: p depends on q (and is the later edit); b: q depends on p.
        edit(&a, "p", |n| {
            n.deps = vec!["q".into()];
            n.modified = "m9".into();
        });
        edit(&a, "q", |n| n.modified = "m1".into());
        edit(&b, "q", |n| {
            n.deps = vec!["p".into()];
            n.modified = "m5".into();
        });
        edit(&b, "p", |n| n.modified = "m2".into());
        sync_b(&a, &b);
        let p = open(&b).unwrap();
        let notes: HashMap<String, Note> = p.notes.into_iter().map(|n| (n.id.clone(), n)).collect();
        assert_eq!(
            notes["p"].deps,
            vec!["q".to_string()],
            "the newer edge stays"
        );
        assert!(notes["q"].deps.is_empty(), "{:?}", notes["q"].deps);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn cycle_across_cleanly_merged_notes_is_broken() {
        let (base, a, b) = seeded(
            "merge-cycle-clean",
            vec![note("p", "P", "m", &[]), note("q", "Q", "m", &[])],
        );
        // Each side touches a different file, so git merges without conflict.
        edit(&a, "p", |n| {
            n.deps = vec!["q".into()];
            n.modified = "m9".into();
        });
        edit(&b, "q", |n| {
            n.deps = vec!["p".into()];
            n.modified = "m5".into();
        });
        sync_b(&a, &b);
        let p = open(&b).unwrap();
        let notes: HashMap<String, Note> = p.notes.into_iter().map(|n| (n.id.clone(), n)).collect();
        assert_eq!(
            notes["p"].deps,
            vec!["q".to_string()],
            "the newer edge stays"
        );
        assert!(notes["q"].deps.is_empty(), "{:?}", notes["q"].deps);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn rename_on_both_sides_still_merges_three_way() {
        let (base, a, b) = seeded(
            "merge-rename-both",
            vec![
                {
                    let mut n = note("x", "X", "m1", &["d"]);
                    n.tags = vec!["keep".into(), "drop".into()];
                    n
                },
                note("d", "D", "m1", &[]),
            ],
        );
        // Both rename (two adds, no conflicted path), only a edits the body,
        // only b removes a tag and the dep.
        edit(&a, "x", |n| {
            n.title = "From a".into();
            n.body = "edited on a".into();
            n.modified = "m2".into();
        });
        edit(&b, "x", |n| {
            n.title = "From b".into();
            n.tags = vec!["keep".into()];
            n.deps = vec![];
            n.modified = "m3".into();
        });
        let report = sync_b(&a, &b);
        assert!(report.iter().all(|c| !c.body_conflict), "{report:?}");
        let p = open(&b).unwrap();
        let x = p.notes.iter().find(|n| n.id == "x").unwrap();
        assert_eq!(p.notes.len(), 2);
        assert_eq!(x.title, "From b");
        assert_eq!(x.body, "edited on a", "one-sided body edit merges cleanly");
        assert_eq!(x.tags, vec!["keep".to_string()], "removal sticks");
        assert!(x.deps.is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn unparseable_side_is_kept_and_reported() {
        let (base, a, b) = seeded("merge-broken", vec![note("x", "X", "m", &[])]);
        edit(&a, "x", |n| n.body = "fine on a".into());
        fs::write(b.join("notes/x.md"), "---\nid: [\n---\nbroken").unwrap();
        let report = sync_b(&a, &b);
        assert_eq!(report.len(), 1);
        assert_eq!(open(&b).unwrap().notes[0].body, "fine on a");
        // Neither side parses: the file is left as git merged it, not deleted.
        commit_if_dirty(&b, "b").unwrap();
        push(&b, None).unwrap();
        pull(&a, None).unwrap();
        fs::write(a.join("notes/x.md"), "---\nid: [\n---\nfrom a").unwrap();
        fs::write(b.join("notes/x.md"), "---\nid: [\n---\nfrom b").unwrap();
        sync_b(&a, &b);
        let text = fs::read_to_string(b.join("notes/x.md")).unwrap();
        assert!(text.contains("<<<<<<<"), "{text}");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn foreign_conflict_leaves_the_merge_to_the_user() {
        let (base, a, b) = seeded("merge-foreign", vec![]);
        for (root, text) in [(&a, "a"), (&b, "b")] {
            fs::write(root.join("README"), text).unwrap();
            let repo = Repository::open(root).unwrap();
            let mut index = repo.index().unwrap();
            index.add_path(Path::new("README")).unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            let sig = repo.signature().unwrap();
            let head = repo.head().unwrap().peel_to_commit().unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "readme", &tree, &[&head])
                .unwrap();
        }
        push(&a, None).unwrap();
        assert_eq!(pull(&b, None).unwrap(), PullOutcome::Merging);
        let e = resolve(&b, "merge").unwrap_err();
        assert!(e.contains("README"), "{e}");
        assert_eq!(
            Repository::open(&b).unwrap().state(),
            git2::RepositoryState::Merge
        );
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn rename_on_one_side_merges_with_edit_on_the_other() {
        let (base, a, b) = seeded("merge-rename", vec![note("x", "X", "m1", &[])]);
        edit(&a, "x", |n| {
            n.title = "Renamed".into();
            n.modified = "m3".into();
        });
        edit(&b, "x", |n| {
            n.body = "edited on b".into();
            n.modified = "m2".into();
        });
        commit_if_dirty(&a, "a").unwrap();
        push(&a, None).unwrap();
        commit_if_dirty(&b, "b").unwrap();
        assert_eq!(pull(&b, None).unwrap(), PullOutcome::Merging);
        let report = resolve(&b, "merge").unwrap();
        let p = open(&b).unwrap();
        assert_eq!(
            p.notes.len(),
            1,
            "{:?}",
            p.notes.iter().map(|n| &n.file).collect::<Vec<_>>()
        );
        let x = &p.notes[0];
        assert_eq!(x.title, "Renamed");
        assert_eq!(x.body, "edited on b");
        assert_eq!(x.file, "renamed.md");
        assert!(report.iter().all(|c| !c.body_conflict));
        assert!(!git::status(&b).unwrap().dirty);

        // Rename on a, delete on b: the note survives under the new name.
        push(&b, None).unwrap();
        pull(&a, None).unwrap();
        edit(&a, "x", |n| {
            n.title = "Renamed twice".into();
            n.modified = "m4".into();
        });
        delete_note(&b, "renamed.md", "t").unwrap();
        commit_if_dirty(&a, "a").unwrap();
        push(&a, None).unwrap();
        commit_if_dirty(&b, "b").unwrap();
        assert_eq!(pull(&b, None).unwrap(), PullOutcome::Merging);
        resolve(&b, "merge").unwrap();
        let p = open(&b).unwrap();
        assert_eq!(p.notes.len(), 1);
        assert_eq!(p.notes[0].title, "Renamed twice");
        assert!(store::list_trash(&b).unwrap().is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn meta_conflicts_union_maps() {
        let (base, a, b) = seeded("merge-meta", vec![]);
        fs::write(a.join("dagobert.json"), r##"{"tag_colors":{"x":"#111","shared":"#a"},"palette":["#1"],"workflows":[{"id":"w1","name":"A","stages":[]}],"default_template":"from a"}"##).unwrap();
        commit_if_dirty(&a, "seed").unwrap();
        push(&a, None).unwrap();
        pull(&b, None).unwrap();
        fs::write(a.join("dagobert.json"), r##"{"tag_colors":{"x":"#111","shared":"#a2","onlya":"#3"},"palette":["#1","#2"],"workflows":[{"id":"w1","name":"A2","stages":[]},{"id":"w2","name":"B","stages":[]}],"default_template":"from a"}"##).unwrap();
        fs::write(b.join("dagobert.json"), r##"{"tag_colors":{"x":"#111","shared":"#b2","onlyb":"#4"},"palette":["#1","#5"],"workflows":[{"id":"w1","name":"B1","stages":[]}],"default_template":"from b"}"##).unwrap();
        sync_b(&a, &b);
        let m = store::read_meta(&b);
        assert_eq!(m.tag_colors["shared"], "#b2", "ours wins per key");
        assert_eq!(m.tag_colors["onlya"], "#3");
        assert_eq!(m.tag_colors["onlyb"], "#4");
        assert_eq!(m.palette, vec!["#1", "#5", "#2"]);
        assert_eq!(m.default_template, "from b");
        let names: Vec<&str> = m.workflows.iter().map(|w| w.name.as_str()).collect();
        assert_eq!(names, vec!["B1", "B"]);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn parse_survives_markers_in_body() {
        let n = parse_note("---\nid: x\ntitle: t\ncreated: c\nmodified: m\nopened: o\n---\n<<<<<<< mine\na\n=======\nb\n>>>>>>> theirs\n", "x.md").unwrap();
        assert!(n.body.starts_with("<<<<<<< mine"));
    }
}
