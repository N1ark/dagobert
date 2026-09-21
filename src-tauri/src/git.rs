//! Git primitives for project tracking: commit, pull, push and status, all via
//! libgit2 so the app needs neither a git binary nor a system OpenSSL.
//!
//! Only Dagobert's own paths (`notes/`, `trash/`, `dagobert.json`, `.gitignore`)
//! are ever staged; the project may sit inside a larger repository.

// Wired up by the git_* commands in a later milestone.
#![allow(dead_code)]

use git2::{
    build::{CheckoutBuilder, TreeUpdateBuilder},
    AnnotatedCommit, Cred, CredentialType, Delta, DiffOptions, FetchOptions, IndexAddOption,
    MergeOptions, Oid, PushOptions, RemoteCallbacks, Repository, RepositoryState, Signature,
    StatusOptions, Tree,
};
use serde::Serialize;
use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Paths (relative to the project root) that tracking manages.
pub const PATHS: [&str; 4] = ["notes", "trash", "dagobert.json", ".gitignore"];
const IGNORED: [&str; 2] = ["dagobert.local.json", ".DS_Store"];
const REMOTE: &str = "origin";

#[derive(Debug, Clone, Serialize, Default)]
pub struct GitStatus {
    pub branch: Option<String>,
    pub dirty: bool,
    pub ahead: usize,
    pub behind: usize,
    pub has_remote: bool,
    /// Unix seconds of the HEAD commit.
    pub last_commit_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PullOutcome {
    NoRemote,
    UpToDate,
    FastForward,
    /// A merge is in progress (`MERGE_HEAD` is set, the index may hold
    /// conflicts); `merge::resolve` finishes it.
    Merging,
}

pub type Result<T> = std::result::Result<T, String>;

fn err(e: git2::Error) -> String {
    e.message().to_string()
}

/// The repository containing `root`, or `None` when it isn't inside a work tree.
pub fn open(root: &Path) -> Result<Option<Repository>> {
    match Repository::discover(root) {
        Ok(r) if r.workdir().is_some() => Ok(Some(r)),
        Ok(_) => Ok(None),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

fn require(root: &Path) -> Result<Repository> {
    open(root)?.ok_or_else(|| "This folder isn't inside a git repository.".to_string())
}

pub fn init(root: &Path) -> Result<()> {
    Repository::init(root).map_err(err)?;
    ensure_ignore(root)
}

/// Adds the per-machine files to the project's `.gitignore` if missing.
pub fn ensure_ignore(root: &Path) -> Result<()> {
    let path = root.join(".gitignore");
    let mut text = fs::read_to_string(&path).unwrap_or_default();
    let missing: Vec<&str> = IGNORED
        .iter()
        .copied()
        .filter(|l| !text.lines().any(|x| x.trim() == *l))
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    for l in missing {
        text.push_str(l);
        text.push('\n');
    }
    fs::write(&path, text).map_err(|e| e.to_string())
}

/// Our pathspecs relative to the repository's work tree.
fn specs(repo: &Repository, root: &Path) -> Result<Vec<String>> {
    let wd = repo.workdir().ok_or("bare repository")?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let wd = wd.canonicalize().map_err(|e| e.to_string())?;
    let rel = root
        .strip_prefix(&wd)
        .map_err(|_| "project is outside the repository".to_string())?;
    Ok(PATHS
        .iter()
        .map(|p| rel.join(p).to_string_lossy().replace('\\', "/"))
        .collect())
}

fn head_tree(repo: &Repository) -> Result<Option<Tree<'_>>> {
    match repo.head() {
        Ok(h) => Ok(Some(h.peel_to_tree().map_err(err)?)),
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => Ok(None),
        Err(e) => Err(err(e)),
    }
}

fn empty_tree(repo: &Repository) -> Result<Tree<'_>> {
    let oid = repo.treebuilder(None).map_err(err)?.write().map_err(err)?;
    repo.find_tree(oid).map_err(err)
}

fn current_branch(repo: &Repository) -> Result<Option<String>> {
    if repo.head_detached().map_err(err)? {
        return Err("The repository is in detached HEAD state.".into());
    }
    match repo.head() {
        Ok(h) => Ok(h.shorthand().map(str::to_string)),
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => {
            // Unborn: the name HEAD points at.
            let r = repo.find_reference("HEAD").map_err(err)?;
            Ok(r.symbolic_target()
                .and_then(|t| t.strip_prefix("refs/heads/"))
                .map(str::to_string))
        }
        Err(e) => Err(err(e)),
    }
}

/// `refs/remotes/origin/<branch>` (the upstream if configured), if it exists.
fn remote_ref(repo: &Repository, branch: &str) -> Option<Oid> {
    let upstream = repo
        .find_branch(branch, git2::BranchType::Local)
        .ok()
        .and_then(|b| b.upstream().ok())
        .and_then(|u| u.get().target());
    upstream.or_else(|| {
        repo.find_reference(&format!("refs/remotes/{REMOTE}/{branch}"))
            .ok()
            .and_then(|r| r.target())
    })
}

pub fn status(root: &Path) -> Result<GitStatus> {
    let repo = require(root)?;
    let branch = current_branch(&repo)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .exclude_submodules(true);
    for s in specs(&repo, root)? {
        opts.pathspec(s);
    }
    let dirty = !repo.statuses(Some(&mut opts)).map_err(err)?.is_empty();
    let head = repo.head().ok().and_then(|h| h.target());
    let last_commit_at = head
        .and_then(|o| repo.find_commit(o).ok())
        .map(|c| c.time().seconds());
    let has_remote = repo.find_remote(REMOTE).is_ok();
    let (ahead, behind) = match (head, branch.as_deref().and_then(|b| remote_ref(&repo, b))) {
        (Some(l), Some(r)) => repo.graph_ahead_behind(l, r).map_err(err)?,
        _ => (0, 0),
    };
    Ok(GitStatus {
        branch,
        dirty,
        ahead,
        behind,
        has_remote,
        last_commit_at,
    })
}

fn signature(repo: &Repository) -> Result<Signature<'static>> {
    repo.signature()
        .or_else(|_| Signature::now("Dagobert", "dagobert@localhost"))
        .map_err(err)
}

/// Stages Dagobert's paths and commits them if anything changed. Other staged
/// changes in the repository are left alone.
pub fn commit_if_dirty(root: &Path, message: &str) -> Result<bool> {
    let repo = require(root)?;
    if repo.state() != RepositoryState::Clean {
        return Err("The repository has an operation in progress (merge/rebase).".into());
    }
    current_branch(&repo)?;
    let specs = specs(&repo, root)?;
    let mut index = repo.index().map_err(err)?;
    index
        .add_all(specs.iter(), IndexAddOption::DEFAULT, None)
        .map_err(err)?;
    index.update_all(specs.iter(), None).map_err(err)?;
    index.write().map_err(err)?;
    let staged = repo
        .find_tree(index.write_tree().map_err(err)?)
        .map_err(err)?;
    let base = match head_tree(&repo)? {
        Some(t) => t,
        None => empty_tree(&repo)?,
    };
    // HEAD's tree with only our paths brought up to the index.
    let mut diff_opts = DiffOptions::new();
    for s in &specs {
        diff_opts.pathspec(s);
    }
    let diff = repo
        .diff_tree_to_tree(Some(&base), Some(&staged), Some(&mut diff_opts))
        .map_err(err)?;
    if diff.deltas().len() == 0 {
        return Ok(false);
    }
    let mut update = TreeUpdateBuilder::new();
    for d in diff.deltas() {
        match d.status() {
            Delta::Deleted => {
                update.remove(d.old_file().path().unwrap_or(Path::new("")));
            }
            _ => {
                let f = d.new_file();
                update.upsert(f.path().unwrap_or(Path::new("")), f.id(), f.mode());
            }
        }
    }
    let tree_oid = update.create_updated(&repo, &base).map_err(err)?;
    let tree = repo.find_tree(tree_oid).map_err(err)?;
    let sig = signature(&repo)?;
    let head = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = head.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(err)?;
    Ok(true)
}

/// Credentials tried in order: ssh-agent, `~/.ssh/id_*` keys, the credential
/// helper (osxkeychain, gh, …), then libgit2's default. Never prompts.
fn callbacks<'a>(deadline: Option<Instant>) -> RemoteCallbacks<'a> {
    let mut cb = RemoteCallbacks::new();
    let attempt = Cell::new(0usize);
    cb.credentials(move |url, username, allowed| {
        let n = attempt.get();
        attempt.set(n + 1);
        let user = username.unwrap_or("git");
        if allowed.contains(CredentialType::SSH_KEY) {
            let keys = ssh_keys();
            if n == 0 {
                return Cred::ssh_key_from_agent(user);
            }
            if let Some(k) = keys.get(n - 1) {
                return Cred::ssh_key(user, None, k, None);
            }
            return Err(git2::Error::from_str("no usable SSH credentials"));
        }
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) && n == 0 {
            let cfg = git2::Config::open_default()?;
            return Cred::credential_helper(&cfg, url, username);
        }
        if allowed.contains(CredentialType::DEFAULT) && n == 0 {
            return Cred::default();
        }
        Err(git2::Error::from_str("no usable credentials"))
    });
    if let Some(d) = deadline {
        cb.transfer_progress(move |_| Instant::now() < d);
        cb.push_transfer_progress(move |_, _, _| {});
        cb.sideband_progress(move |_| Instant::now() < d);
    }
    cb
}

fn ssh_keys() -> Vec<PathBuf> {
    let home = match std::env::var_os("HOME") {
        Some(h) => PathBuf::from(h).join(".ssh"),
        None => return vec![],
    };
    ["id_ed25519", "id_rsa", "id_ecdsa"]
        .iter()
        .map(|n| home.join(n))
        .filter(|p| p.exists())
        .collect()
}

/// Safe checkout that skips (rather than fails on) files it would clobber; the
/// skipped files stay as local modifications and ride along in the next commit.
fn checkout() -> CheckoutBuilder<'static> {
    let mut cb = CheckoutBuilder::new();
    cb.safe().allow_conflicts(true);
    cb
}

fn deadline(timeout: Option<Duration>) -> Option<Instant> {
    timeout.map(|t| Instant::now() + t)
}

/// Fetches the branch's remote counterpart and merges it in.
pub fn pull(root: &Path, timeout: Option<Duration>) -> Result<PullOutcome> {
    let repo = require(root)?;
    if repo.state() != RepositoryState::Clean {
        return Err("The repository has an operation in progress (merge/rebase).".into());
    }
    let branch = match current_branch(&repo)? {
        Some(b) => b,
        None => return Ok(PullOutcome::NoRemote),
    };
    let mut remote = match repo.find_remote(REMOTE) {
        Ok(r) => r,
        Err(_) => return Ok(PullOutcome::NoRemote),
    };
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(callbacks(deadline(timeout)));
    remote
        .fetch(&[] as &[&str], Some(&mut fo), None)
        .map_err(|e| format!("fetch failed: {}", e.message()))?;
    let their_oid = match remote_ref(&repo, &branch) {
        Some(o) => o,
        None => return Ok(PullOutcome::NoRemote),
    };
    let theirs = repo.find_annotated_commit(their_oid).map_err(err)?;
    if repo.head().is_err() {
        // Unborn local branch: adopt the remote one.
        let obj = repo.find_object(their_oid, None).map_err(err)?;
        repo.checkout_tree(&obj, Some(&mut checkout()))
            .map_err(err)?;
        repo.reference(
            &format!("refs/heads/{branch}"),
            their_oid,
            true,
            "dagobert: adopt remote branch",
        )
        .map_err(err)?;
        if let Ok(mut b) = repo.find_branch(&branch, git2::BranchType::Local) {
            let _ = b.set_upstream(Some(&format!("{REMOTE}/{branch}")));
        }
        return Ok(PullOutcome::FastForward);
    }
    let (analysis, _) = repo.merge_analysis(&[&theirs]).map_err(err)?;
    if analysis.is_up_to_date() {
        return Ok(PullOutcome::UpToDate);
    }
    if analysis.is_fast_forward() {
        fast_forward(&repo, &branch, &theirs)?;
        return Ok(PullOutcome::FastForward);
    }
    // No rename detection: a note moved to trash/ must conflict with an edit,
    // not merge into the trashed copy; `merge::resolve` pairs files by id.
    let mut mo = MergeOptions::new();
    mo.find_renames(false);
    repo.merge(&[&theirs], Some(&mut mo), Some(&mut checkout()))
        .map_err(err)?;
    Ok(PullOutcome::Merging)
}

fn fast_forward(repo: &Repository, branch: &str, target: &AnnotatedCommit) -> Result<()> {
    let obj = repo.find_object(target.id(), None).map_err(err)?;
    repo.checkout_tree(&obj, Some(&mut checkout()))
        .map_err(err)?;
    let mut r = repo
        .find_reference(&format!("refs/heads/{branch}"))
        .map_err(err)?;
    r.set_target(target.id(), "dagobert: fast-forward")
        .map_err(err)?;
    Ok(())
}

/// Commits the index as a merge of HEAD and MERGE_HEAD and clears the merge state.
pub fn commit_merge(repo: &mut Repository, message: &str) -> Result<Oid> {
    let mut oids = vec![repo.head().map_err(err)?.target().ok_or("no HEAD")?];
    repo.mergehead_foreach(|oid| {
        oids.push(*oid);
        true
    })
    .map_err(err)?;
    let mut index = repo.index().map_err(err)?;
    index.write().map_err(err)?;
    let tree = repo
        .find_tree(index.write_tree().map_err(err)?)
        .map_err(err)?;
    let parents: Vec<git2::Commit> = oids
        .iter()
        .map(|o| repo.find_commit(*o).map_err(err))
        .collect::<Result<_>>()?;
    let refs: Vec<&git2::Commit> = parents.iter().collect();
    let sig = signature(repo)?;
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &refs)
        .map_err(err)?;
    repo.cleanup_state().map_err(err)?;
    Ok(oid)
}

/// Pushes the current branch to `origin`, setting the upstream if it had none.
pub fn push(root: &Path, timeout: Option<Duration>) -> Result<()> {
    let repo = require(root)?;
    let branch = current_branch(&repo)?.ok_or("no branch to push")?;
    if repo.head().is_err() {
        return Ok(());
    }
    let mut remote = repo
        .find_remote(REMOTE)
        .map_err(|_| "no remote named origin".to_string())?;
    let mut cb = callbacks(deadline(timeout));
    let failure = std::rc::Rc::new(std::cell::RefCell::new(None::<String>));
    let f = failure.clone();
    cb.push_update_reference(move |_, status| {
        if let Some(s) = status {
            *f.borrow_mut() = Some(s.to_string());
        }
        Ok(())
    });
    let mut po = PushOptions::new();
    po.remote_callbacks(cb);
    let spec = format!("refs/heads/{branch}:refs/heads/{branch}");
    remote
        .push(&[spec.as_str()], Some(&mut po))
        .map_err(|e| format!("push failed: {}", e.message()))?;
    if let Some(msg) = failure.borrow().clone() {
        return Err(format!("push rejected: {msg}"));
    }
    let mut local = repo
        .find_branch(&branch, git2::BranchType::Local)
        .map_err(err)?;
    if local.upstream().is_err() {
        let _ = local.set_upstream(Some(&format!("{REMOTE}/{branch}")));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dagobert-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    pub fn write_note(root: &Path, file: &str, id: &str, title: &str, body: &str) {
        fs::create_dir_all(root.join("notes")).unwrap();
        fs::write(
            root.join("notes").join(file),
            format!(
                "---\nid: {id}\ntitle: {title}\ncreated: c\nmodified: 2026-01-01T00:00:00.000Z\nopened: o\n---\n{body}"
            ),
        )
        .unwrap();
    }

    /// A bare remote plus two clones of it, each with tracking enabled.
    pub fn pair(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let base = tmp(name);
        let remote = base.join("remote.git");
        Repository::init_bare(&remote).unwrap();
        let a = base.join("a");
        let b = base.join("b");
        Repository::clone(remote.to_str().unwrap(), &a).unwrap();
        Repository::clone(remote.to_str().unwrap(), &b).unwrap();
        for r in [&a, &b] {
            ensure_ignore(r).unwrap();
            let repo = Repository::open(r).unwrap();
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.name", "Test").unwrap();
            cfg.set_str("user.email", "t@example.com").unwrap();
        }
        (base, a, b)
    }

    #[test]
    fn open_and_ignore() {
        let dir = tmp("git-open");
        assert!(open(&dir).unwrap().is_none());
        init(&dir).unwrap();
        assert!(open(&dir).unwrap().is_some());
        let ignore = fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert!(ignore.contains("dagobert.local.json\n") && ignore.contains(".DS_Store\n"));
        ensure_ignore(&dir).unwrap();
        assert_eq!(fs::read_to_string(dir.join(".gitignore")).unwrap(), ignore);
        // A subfolder of a repo is found too.
        let sub = dir.join("sub");
        fs::create_dir_all(&sub).unwrap();
        assert!(open(&sub).unwrap().is_some());
        let st = status(&dir).unwrap();
        assert_eq!(
            st.branch.as_deref(),
            Some("master").or(st.branch.as_deref())
        );
        assert!(st.dirty && !st.has_remote && st.last_commit_at.is_none());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn commit_only_our_paths() {
        let dir = tmp("git-commit");
        init(&dir).unwrap();
        let repo = Repository::open(&dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
        fs::write(dir.join("other.txt"), "not ours").unwrap();
        fs::write(dir.join("dagobert.local.json"), "{}").unwrap();
        write_note(&dir, "a.md", "a", "A", "hello");
        assert!(commit_if_dirty(&dir, "first").unwrap());
        assert!(!commit_if_dirty(&dir, "again").unwrap());
        let head = repo.head().unwrap().peel_to_tree().unwrap();
        assert!(head.get_path(Path::new("notes/a.md")).is_ok());
        assert!(head.get_path(Path::new(".gitignore")).is_ok());
        assert!(head.get_path(Path::new("other.txt")).is_err());
        assert!(head.get_path(Path::new("dagobert.local.json")).is_err());
        assert!(!status(&dir).unwrap().dirty, "other.txt doesn't count");
        // Deletions are staged too.
        fs::remove_file(dir.join("notes/a.md")).unwrap();
        assert!(status(&dir).unwrap().dirty);
        assert!(commit_if_dirty(&dir, "rm").unwrap());
        let head = repo.head().unwrap().peel_to_tree().unwrap();
        assert!(head.get_path(Path::new("notes/a.md")).is_err());
        assert_eq!(pull(&dir, None).unwrap(), PullOutcome::NoRemote);
        assert!(status(&dir).unwrap().last_commit_at.is_some());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn project_inside_larger_repo() {
        let dir = tmp("git-nested");
        init(&dir).unwrap();
        let project = dir.join("docs/plan");
        fs::create_dir_all(&project).unwrap();
        let repo = Repository::open(&dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
        fs::write(dir.join("README"), "x").unwrap();
        write_note(&project, "a.md", "a", "A", "hello");
        ensure_ignore(&project).unwrap();
        assert!(commit_if_dirty(&project, "nested").unwrap());
        let head = repo.head().unwrap().peel_to_tree().unwrap();
        assert!(head.get_path(Path::new("docs/plan/notes/a.md")).is_ok());
        assert!(head.get_path(Path::new("docs/plan/.gitignore")).is_ok());
        assert!(head.get_path(Path::new("README")).is_err());
        assert!(!status(&project).unwrap().dirty);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn pull_and_push_between_clones() {
        let (base, a, b) = pair("git-sync");
        write_note(&a, "a.md", "a", "A", "from a");
        assert!(commit_if_dirty(&a, "a1").unwrap());
        push(&a, None).unwrap();
        let st = status(&a).unwrap();
        assert!(st.has_remote && st.ahead == 0 && st.behind == 0);

        assert_eq!(pull(&b, None).unwrap(), PullOutcome::FastForward);
        assert!(b.join("notes/a.md").exists());
        assert_eq!(pull(&b, None).unwrap(), PullOutcome::UpToDate);

        // Divergent, non-conflicting edits merge.
        write_note(&a, "a2.md", "a2", "A2", "more a");
        commit_if_dirty(&a, "a2").unwrap();
        push(&a, None).unwrap();
        write_note(&b, "b.md", "b", "B", "from b");
        commit_if_dirty(&b, "b1").unwrap();
        assert_eq!(status(&b).unwrap().ahead, 1);
        assert_eq!(pull(&b, None).unwrap(), PullOutcome::Merging);
        assert!(crate::merge::resolve(&b, "merge").unwrap().is_empty());
        assert!(b.join("notes/a2.md").exists() && b.join("notes/b.md").exists());
        assert_eq!(
            Repository::open(&b).unwrap().state(),
            RepositoryState::Clean
        );
        push(&b, None).unwrap();
        assert_eq!(pull(&a, None).unwrap(), PullOutcome::FastForward);
        assert!(a.join("notes/b.md").exists());
        assert!(!status(&a).unwrap().dirty);
        fs::remove_dir_all(&base).unwrap();
    }
}
