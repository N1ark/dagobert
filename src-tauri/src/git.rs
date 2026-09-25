//! Git primitives via libgit2; only Dagobert's own paths are ever staged.

use crate::store::{LOCAL_FILE, META_FILE, NOTES_DIR, TRASH_DIR};
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

pub const IGNORE_FILE: &str = ".gitignore";
/// Paths (relative to the project root) that tracking manages.
const PATHS: [&str; 4] = [NOTES_DIR, TRASH_DIR, META_FILE, IGNORE_FILE];
const IGNORED: [&str; 2] = [LOCAL_FILE, ".DS_Store"];
const REMOTE: &str = "origin";

#[derive(Debug, Clone, Serialize, Default)]
pub struct GitStatus {
    pub branch: Option<String>,
    pub dirty: bool,
    pub ahead: usize,
    pub behind: usize,
    pub has_remote: bool,
    /// The branch exists on the remote (`origin/<branch>` is known locally).
    pub has_upstream: bool,
    /// Unix seconds of the HEAD commit.
    pub last_commit_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PullOutcome {
    NoRemote,
    UpToDate,
    FastForward,
    /// A merge is in progress; `merge::resolve` finishes it.
    Merging,
}

pub type Result<T> = std::result::Result<T, String>;

pub fn err(e: git2::Error) -> String {
    e.message().to_string()
}

/// The repository containing `root`; the search walks up, but never as far as `~`.
pub fn open(root: &Path) -> Result<Option<Repository>> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let ceiling = home
        .as_deref()
        .filter(|h| root.canonicalize().is_ok_and(|r| r != *h))
        .into_iter();
    let path = match Repository::discover_path(root, ceiling) {
        Ok(p) => p,
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Ok(None),
        Err(e) => return Err(err(e)),
    };
    let repo = Repository::open(path).map_err(err)?;
    let Some(wd) = repo.workdir() else {
        return Ok(None);
    };
    // The ceiling stops the walk below `~` but still lets `~` itself match.
    if home.is_some_and(|h| wd.canonicalize().ok() == h.canonicalize().ok())
        && root.canonicalize().ok() != wd.canonicalize().ok()
    {
        return Ok(None);
    }
    Ok(Some(repo))
}

pub fn require(root: &Path) -> Result<Repository> {
    open(root)?.ok_or_else(|| "This folder isn't inside a git repository.".to_string())
}

fn require_clean(repo: &Repository) -> Result<()> {
    if repo.state() != RepositoryState::Clean {
        return Err("The repository has an operation in progress (merge/rebase).".into());
    }
    Ok(())
}

/// Creates a repository on `main` (or the user's `init.defaultBranch`).
pub fn init(root: &Path) -> Result<()> {
    let branch = git2::Config::open_default()
        .and_then(|c| c.get_string("init.defaultBranch"))
        .ok()
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| "main".to_string());
    let mut opts = git2::RepositoryInitOptions::new();
    opts.initial_head(&branch);
    Repository::init_opts(root, &opts).map_err(err)?;
    ensure_ignore(root)
}

/// The folder name a clone of `url` gets: its last segment, without `.git` and sanitised.
pub fn project_name(url: &str) -> String {
    let last = url
        .trim_end_matches('/')
        .rsplit(['/', ':'])
        .next()
        .unwrap_or("");
    let name: String = last
        .trim_end_matches(".git")
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .collect();
    let name = name.trim_matches('.').to_string();
    if name.is_empty() {
        "project".to_string()
    } else {
        name
    }
}

/// Clones `url` into `dest`, writing the identity in: a phone has no `~/.gitconfig`.
pub fn clone(url: &str, dest: &Path, token: Option<&str>, name: &str, email: &str) -> Result<()> {
    if dest.exists() {
        return Err("A project with that name is already here.".into());
    }
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(callbacks(token.map(str::to_string), None));
    let mut builder = git2::build::RepoBuilder::new();
    builder.fetch_options(fo);
    let repo = builder.clone(url, dest).map_err(|e| {
        let _ = fs::remove_dir_all(dest);
        format!("clone failed: {}", e.message())
    })?;
    let mut cfg = repo.config().map_err(err)?;
    for (k, v) in [("user.name", name), ("user.email", email)] {
        if !v.is_empty() {
            cfg.set_str(k, v).map_err(err)?;
        }
    }
    drop(cfg);
    drop(repo);
    ensure_ignore(dest)
}

/// Adds the per-machine files to the project's `.gitignore` if missing.
pub fn ensure_ignore(root: &Path) -> Result<()> {
    let path = root.join(IGNORE_FILE);
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

/// The project root relative to the repository's work tree.
pub fn prefix(repo: &Repository, root: &Path) -> Result<PathBuf> {
    let wd = repo.workdir().ok_or("bare repository")?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let wd = wd.canonicalize().map_err(|e| e.to_string())?;
    root.strip_prefix(&wd)
        .map(Path::to_path_buf)
        .map_err(|_| "project is outside the repository".to_string())
}

/// `rel` under the project as a repository pathspec.
fn spec(prefix: &Path, rel: &str) -> String {
    prefix.join(rel).to_string_lossy().replace('\\', "/")
}

/// Our pathspecs relative to the repository's work tree.
fn specs(repo: &Repository, root: &Path) -> Result<Vec<String>> {
    let prefix = prefix(repo, root)?;
    Ok(PATHS.iter().map(|p| spec(&prefix, p)).collect())
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

/// The branch on `origin` that `branch` tracks: its upstream there, else its own name.
fn remote_branch(repo: &Repository, branch: &str) -> String {
    repo.find_branch(branch, git2::BranchType::Local)
        .ok()
        .and_then(|b| b.upstream().ok())
        .and_then(|u| u.name().ok().flatten().map(str::to_string))
        .and_then(|n| n.strip_prefix(&format!("{REMOTE}/")).map(str::to_string))
        .unwrap_or_else(|| branch.to_string())
}

/// `refs/remotes/origin/<remote branch>`, if it exists.
fn remote_ref(repo: &Repository, branch: &str) -> Option<Oid> {
    let name = remote_branch(repo, branch);
    repo.find_reference(&format!("refs/remotes/{REMOTE}/{name}"))
        .ok()
        .and_then(|r| r.target())
}

/// Checks the folder is in a repository that doesn't ignore it, then writes `.gitignore`.
pub fn enable(root: &Path) -> Result<()> {
    let repo = open(root)?.ok_or("no-repo")?;
    let prefix = prefix(&repo, root)?;
    // A parent rule like `*.md` ignores the files, not the folders.
    let probes = [NOTES_DIR, TRASH_DIR].map(|d| format!("{d}/probe.md"));
    let paths = PATHS
        .iter()
        .copied()
        .chain(probes.iter().map(String::as_str));
    for s in paths.map(|p| spec(&prefix, p)) {
        if repo.is_path_ignored(&s).map_err(err)? {
            return Err(format!(
                "`{s}` is ignored by the repository's .gitignore, so nothing would be committed."
            ));
        }
    }
    ensure_ignore(root)
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
    let upstream = branch.as_deref().and_then(|b| remote_ref(&repo, b));
    let (ahead, behind) = match (head, upstream) {
        (Some(l), Some(r)) => repo.graph_ahead_behind(l, r).map_err(err)?,
        _ => (0, 0),
    };
    Ok(GitStatus {
        branch,
        dirty,
        ahead,
        behind,
        has_remote,
        has_upstream: upstream.is_some(),
        last_commit_at,
    })
}

fn signature(repo: &Repository) -> Result<Signature<'static>> {
    repo.signature()
        .or_else(|_| Signature::now("Dagobert", "dagobert@localhost"))
        .map_err(err)
}

/// Stages Dagobert's paths and commits them if anything changed, leaving other staging alone.
pub fn commit_if_dirty(root: &Path, message: &str) -> Result<bool> {
    let repo = require(root)?;
    require_clean(&repo)?;
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

/// What `callbacks` offers on a given attempt, kept pure so it can be tested offline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CredChoice {
    Username,
    Token,
    None,
}

/// The signed-in token over HTTPS is the only credential anywhere, and never a prompt.
fn pick_cred(token: bool, allowed: CredentialType, attempt: usize) -> CredChoice {
    if allowed == CredentialType::USERNAME {
        return CredChoice::Username;
    }
    if token && attempt == 0 && allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
        return CredChoice::Token;
    }
    CredChoice::None
}

fn callbacks<'a>(token: Option<String>, deadline: Option<Instant>) -> RemoteCallbacks<'a> {
    let mut cb = RemoteCallbacks::new();
    let attempt = Cell::new(0usize);
    cb.credentials(move |_url, username, allowed| {
        let choice = pick_cred(token.is_some(), allowed, attempt.get());
        if choice != CredChoice::Username {
            attempt.set(attempt.get() + 1);
        }
        match choice {
            CredChoice::Username => Cred::username(username.unwrap_or("git")),
            // GitHub, GitLab and Bitbucket all accept a token as the password.
            CredChoice::Token => Cred::userpass_plaintext(
                username
                    .filter(|u| !u.is_empty())
                    .unwrap_or("x-access-token"),
                token.as_deref().unwrap_or_default(),
            ),
            CredChoice::None => Err(git2::Error::from_str(
                "no usable credentials — sign in to GitHub",
            )),
        }
    });
    // Aborts a fetch past the deadline; git2 gives no way to interrupt a push.
    if let Some(d) = deadline {
        cb.transfer_progress(move |_| Instant::now() < d);
        cb.sideband_progress(move |_| Instant::now() < d);
    }
    cb
}

/// Reports a transfer error as a timeout when the deadline has passed.
fn transfer_err(what: &str, deadline: Option<Instant>, e: git2::Error) -> String {
    match deadline {
        Some(d) if Instant::now() >= d => format!("{what} timed out"),
        _ => format!("{what} failed: {}", e.message()),
    }
}

/// Safe checkout that skips files it would clobber, leaving them for the next commit.
fn checkout() -> CheckoutBuilder<'static> {
    let mut cb = CheckoutBuilder::new();
    cb.safe().allow_conflicts(true);
    cb
}

/// Safe checkout that fails, before touching anything, when a local change is in the way.
fn strict_checkout() -> CheckoutBuilder<'static> {
    let mut cb = CheckoutBuilder::new();
    cb.safe();
    cb
}

/// The HTTPS form of an ssh remote; `None` when the token can already authenticate the url.
fn https_url(url: &str) -> Option<String> {
    let rest = match url.strip_prefix("ssh://") {
        Some(r) => r.to_string(),
        None if url.contains("://") => return None,
        None => url.replacen(':', "/", 1),
    };
    let rest = rest.rsplit_once('@').map(|(_, r)| r).unwrap_or(&rest);
    let (host, path) = rest.split_once('/')?;
    let host = host.split_once(':').map(|(h, _)| h).unwrap_or(host);
    if host.is_empty() || path.is_empty() {
        return None;
    }
    Some(format!("https://{host}/{path}"))
}

/// Moves an ssh `origin` onto HTTPS, the only protocol the sign-in can serve.
fn ensure_https(repo: &Repository) -> Result<()> {
    let url = match repo.find_remote(REMOTE) {
        Ok(r) => r.url().map(str::to_string),
        Err(_) => None,
    };
    if let Some(https) = url.as_deref().and_then(https_url) {
        repo.remote_set_url(REMOTE, &https).map_err(err)?;
    }
    Ok(())
}

fn deadline(timeout: Option<Duration>) -> Option<Instant> {
    timeout.map(|t| Instant::now() + t)
}

/// Fetches `origin`; `false` when there is no remote (or no branch).
pub fn fetch(root: &Path, token: Option<&str>, timeout: Option<Duration>) -> Result<bool> {
    let repo = require(root)?;
    if current_branch(&repo)?.is_none() {
        return Ok(false);
    }
    ensure_https(&repo)?;
    let mut remote = match repo.find_remote(REMOTE) {
        Ok(r) => r,
        Err(_) => return Ok(false),
    };
    let d = deadline(timeout);
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(callbacks(token.map(str::to_string), d));
    remote
        .fetch(&[] as &[&str], Some(&mut fo), None)
        .map_err(|e| transfer_err("fetch", d, e))?;
    Ok(true)
}

/// `fetch` then `merge_fetched`.
#[cfg(test)]
pub fn pull(root: &Path, timeout: Option<Duration>) -> Result<PullOutcome> {
    if !fetch(root, None, timeout)? {
        return Ok(PullOutcome::NoRemote);
    }
    merge_fetched(root, "dagobert auto-save")
}

/// Merges the fetched branch in, committing first: libgit2 refuses over a local modification.
pub fn merge_fetched(root: &Path, save: &str) -> Result<PullOutcome> {
    let repo = require(root)?;
    require_clean(&repo)?;
    let branch = match current_branch(&repo)? {
        Some(b) => b,
        None => return Ok(PullOutcome::NoRemote),
    };
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
        match fast_forward(&repo, &branch, &theirs) {
            Ok(()) => return Ok(PullOutcome::FastForward),
            Err(e) if e.code() == git2::ErrorCode::Conflict => {
                commit_if_dirty(root, save)?;
            }
            Err(e) => return Err(err(e)),
        }
    }
    // No rename detection: a note moved to trash/ must conflict with an edit, not follow it.
    let mut mo = MergeOptions::new();
    mo.find_renames(false);
    // libgit2 refuses to merge over a staged change anywhere in the repository.
    repo.merge(&[&theirs], Some(&mut mo), Some(&mut checkout()))
        .map_err(|e| {
            if e.message().contains("would be overwritten by merge") {
                "Uncommitted changes elsewhere in the repository block the merge; commit or stash them, then sync again.".to_string()
            } else {
                err(e)
            }
        })?;
    Ok(PullOutcome::Merging)
}

fn fast_forward(
    repo: &Repository,
    branch: &str,
    target: &AnnotatedCommit,
) -> std::result::Result<(), git2::Error> {
    let obj = repo.find_object(target.id(), None)?;
    repo.checkout_tree(&obj, Some(&mut strict_checkout()))?;
    let mut r = repo.find_reference(&format!("refs/heads/{branch}"))?;
    r.set_target(target.id(), "dagobert: fast-forward")?;
    Ok(())
}

/// The commits in MERGE_HEAD.
pub fn merge_heads(repo: &mut Repository) -> Result<Vec<Oid>> {
    let mut oids = Vec::new();
    repo.mergehead_foreach(|oid| {
        oids.push(*oid);
        true
    })
    .map_err(err)?;
    Ok(oids)
}

/// Commits the index as a merge of HEAD and MERGE_HEAD and clears the merge state.
pub fn commit_merge(repo: &mut Repository, message: &str) -> Result<Oid> {
    let mut oids = vec![repo.head().map_err(err)?.target().ok_or("no HEAD")?];
    oids.extend(merge_heads(repo)?);
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
pub fn push(root: &Path, token: Option<&str>, timeout: Option<Duration>) -> Result<()> {
    let repo = require(root)?;
    let branch = current_branch(&repo)?.ok_or("no branch to push")?;
    if repo.head().is_err() {
        return Ok(());
    }
    ensure_https(&repo)?;
    let mut remote = repo
        .find_remote(REMOTE)
        .map_err(|_| "no remote named origin".to_string())?;
    let d = deadline(timeout);
    let mut cb = callbacks(token.map(str::to_string), d);
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
    let target = remote_branch(&repo, &branch);
    let spec = format!("refs/heads/{branch}:refs/heads/{target}");
    remote
        .push(&[spec.as_str()], Some(&mut po))
        .map_err(|e| transfer_err("push", d, e))?;
    if let Some(msg) = failure.borrow().clone() {
        return Err(format!("push rejected: {msg}"));
    }
    let mut local = repo
        .find_branch(&branch, git2::BranchType::Local)
        .map_err(err)?;
    if local.upstream().is_err() {
        let _ = local.set_upstream(Some(&format!("{REMOTE}/{target}")));
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
                "---\nid: {id}\ntitle: {title}\ncreated: c\nmodified: 2026-01-01T00:00:00.000Z\n---\n{body}"
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
        assert!(st.branch.is_some(), "unborn HEAD still names its branch");
        assert!(st.dirty && !st.has_remote && st.last_commit_at.is_none());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn enable_refuses_an_ignored_project() {
        let dir = tmp("git-ignored");
        init(&dir).unwrap();
        let project = dir.join("scratch/notes-project");
        fs::create_dir_all(&project).unwrap();
        let none = tmp("git-ignored-none");
        assert_eq!(enable(&none).unwrap_err(), "no-repo".to_string());
        fs::remove_dir_all(&none).unwrap();
        assert!(enable(&project).is_ok());
        fs::write(dir.join(".gitignore"), "scratch/\n").unwrap();
        assert!(enable(&project).unwrap_err().contains("ignored"));
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
    fn ssh_remotes_move_onto_https() {
        assert_eq!(
            https_url("git@github.com:n1ark/notes.git").as_deref(),
            Some("https://github.com/n1ark/notes.git")
        );
        assert_eq!(
            https_url("ssh://git@github.com/n1ark/notes").as_deref(),
            Some("https://github.com/n1ark/notes")
        );
        assert_eq!(https_url("https://github.com/n1ark/notes.git"), None);
        assert_eq!(https_url("/a/local/repo"), None);
    }

    #[test]
    fn the_token_is_the_only_credential() {
        use CredChoice::*;
        let https = CredentialType::USER_PASS_PLAINTEXT;
        assert_eq!(pick_cred(true, https, 0), Token);
        assert_eq!(pick_cred(true, https, 1), None);
        assert_eq!(pick_cred(false, https, 0), None);
        assert_eq!(pick_cred(true, CredentialType::SSH_KEY, 0), None);
        assert_eq!(pick_cred(true, CredentialType::DEFAULT, 0), None);
        assert_eq!(pick_cred(true, CredentialType::USERNAME, 7), Username);
    }

    #[test]
    fn project_names_come_from_the_url() {
        assert_eq!(project_name("https://github.com/n1ark/notes.git"), "notes");
        assert_eq!(project_name("https://github.com/n1ark/notes/"), "notes");
        assert_eq!(project_name("git@github.com:n1ark/my notes.git"), "mynotes");
        assert_eq!(project_name("https://example.com/"), "example.com");
        assert_eq!(project_name("https://example.com/../"), "project");
    }

    #[test]
    fn clone_lays_out_a_project_with_an_identity() {
        let (base, a, _b) = pair("git-clone");
        write_note(&a, "a.md", "a", "A", "hello");
        assert!(commit_if_dirty(&a, "first").unwrap());
        push(&a, None, None).unwrap();
        let dest = base.join("cloned");
        let remote = base.join("remote.git");
        clone(
            remote.to_str().unwrap(),
            &dest,
            None,
            "Phone",
            "p@example.com",
        )
        .unwrap();
        assert!(dest.join("notes/a.md").exists());
        let cfg = Repository::open(&dest).unwrap().config().unwrap();
        assert_eq!(cfg.get_string("user.name").unwrap(), "Phone");
        assert_eq!(cfg.get_string("user.email").unwrap(), "p@example.com");
        assert!(status(&dest).unwrap().has_remote);
        assert!(clone(remote.to_str().unwrap(), &dest, None, "", "").is_err());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn init_starts_on_main() {
        let dir = tmp("git-init-main");
        init(&dir).unwrap();
        let repo = Repository::open(&dir).unwrap();
        let head = repo.find_reference("HEAD").unwrap();
        let cfg = git2::Config::open_default()
            .and_then(|c| c.get_string("init.defaultBranch"))
            .unwrap_or_else(|_| "main".into());
        assert_eq!(
            head.symbolic_target(),
            Some(format!("refs/heads/{cfg}").as_str())
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn discovery_stops_below_home() {
        let base = tmp("git-home");
        let home = base.join("home");
        let project = home.join("Notes");
        fs::create_dir_all(&project).unwrap();
        Repository::init(&home).unwrap();
        let saved = std::env::var_os("HOME");
        std::env::set_var("HOME", &home);
        let found = open(&project);
        let nested = base.join("home/code");
        fs::create_dir_all(nested.join("plan")).unwrap();
        Repository::init(&nested).unwrap();
        let inside = open(&nested.join("plan"));
        match saved {
            Some(h) => std::env::set_var("HOME", h),
            None => std::env::remove_var("HOME"),
        }
        assert!(found.unwrap().is_none(), "a repo at ~ is not adopted");
        assert!(inside.unwrap().is_some(), "a repo below ~ still is");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn enable_refuses_a_parent_rule_that_ignores_the_notes() {
        let dir = tmp("git-parent-ignore");
        init(&dir).unwrap();
        fs::write(dir.join(".gitignore"), "*.md\n").unwrap();
        let project = dir.join("docs/plan");
        fs::create_dir_all(&project).unwrap();
        assert!(enable(&project)
            .unwrap_err()
            .contains("`docs/plan/notes/probe.md`"));
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
        // A change the user staged themselves stays staged, uncommitted.
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("README")).unwrap();
        index.write().unwrap();
        write_note(&project, "a.md", "a", "A", "hello");
        ensure_ignore(&project).unwrap();
        assert!(commit_if_dirty(&project, "nested").unwrap());
        let head = repo.head().unwrap().peel_to_tree().unwrap();
        assert!(head.get_path(Path::new("docs/plan/notes/a.md")).is_ok());
        assert!(head.get_path(Path::new("docs/plan/.gitignore")).is_ok());
        assert!(head.get_path(Path::new("README")).is_err());
        assert!(repo
            .index()
            .unwrap()
            .get_path(Path::new("README"), 0)
            .is_some());
        assert!(!status(&project).unwrap().dirty);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn push_and_pull_follow_the_upstream_branch() {
        let (base, a, b) = pair("git-upstream");
        write_note(&a, "a.md", "a", "A", "x");
        commit_if_dirty(&a, "a1").unwrap();
        push(&a, None, None).unwrap();
        pull(&b, None).unwrap();
        // b works on a local branch `work` tracking origin/<a's branch>.
        let repo = Repository::open(&b).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let upstream = repo.head().unwrap().shorthand().unwrap().to_string();
        repo.branch("work", &head, false).unwrap();
        repo.set_head("refs/heads/work").unwrap();
        repo.find_branch("work", git2::BranchType::Local)
            .unwrap()
            .set_upstream(Some(&format!("origin/{upstream}")))
            .unwrap();
        write_note(&b, "b.md", "b", "B", "y");
        commit_if_dirty(&b, "b1").unwrap();
        assert_eq!(status(&b).unwrap().ahead, 1);
        push(&b, None, None).unwrap();
        let st = status(&b).unwrap();
        assert!(st.ahead == 0 && st.has_upstream, "{st:?}");
        assert!(repo.find_reference("refs/remotes/origin/work").is_err());
        assert_eq!(pull(&a, None).unwrap(), PullOutcome::FastForward);
        assert!(a.join("notes/b.md").exists());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn pull_and_push_between_clones() {
        let (base, a, b) = pair("git-sync");
        write_note(&a, "a.md", "a", "A", "from a");
        assert!(commit_if_dirty(&a, "a1").unwrap());
        push(&a, None, None).unwrap();
        let st = status(&a).unwrap();
        assert!(st.has_remote && st.ahead == 0 && st.behind == 0);

        assert_eq!(pull(&b, None).unwrap(), PullOutcome::FastForward);
        assert!(b.join("notes/a.md").exists());
        assert_eq!(pull(&b, None).unwrap(), PullOutcome::UpToDate);

        // Divergent, non-conflicting edits merge.
        write_note(&a, "a2.md", "a2", "A2", "more a");
        commit_if_dirty(&a, "a2").unwrap();
        push(&a, None, None).unwrap();
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
        push(&b, None, None).unwrap();
        assert_eq!(pull(&a, None).unwrap(), PullOutcome::FastForward);
        assert!(a.join("notes/b.md").exists());
        assert!(!status(&a).unwrap().dirty);
        fs::remove_dir_all(&base).unwrap();
    }
}
