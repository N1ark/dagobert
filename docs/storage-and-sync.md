# Storage, git tracking and merging

Read this when touching `store.rs`, `git.rs`, `merge.rs`, `sync.rs`, `watch.rs` or the
git slice of `store.svelte.ts`.

## On-disk format (`src-tauri/src/store.rs`)

A project is a folder: `notes/<slug>.md` per note (YAML frontmatter + markdown body);
`dagobert.json` holds `Meta` (`tag_colors`, `workflows`, `repos`, `palette`, templates,
`git`); per-machine state (`Local`: the viewport) is in `dagobert.local.json` so it never
syncs. Legacy fields are read, never written: a `viewport` in `dagobert.json` moves to the
local file on open (when there is none yet) and drops out at the next `save_meta`;
`done: true` in frontmatter becomes `status: done`.

`save_meta` takes a `MetaPatch` and merges on disk (so a popup saving tag colours can't
clobber the main window's state) and refuses to write over a `dagobert.json` it can't
parse (reads fall back to defaults).

`open` skips unparseable notes and drops dangling deps. Files sharing an id: the shortest
file name wins (so a sync tool's `x 2.md` loses to `x.md`), the rest come back in
`Project.duplicates` and the frontend warns about them.

Filenames are `slugify(title)`; a name another note holds gets `-<id>[-n]` (`free_name`),
and a note's own current file counts as free, so a suffixed name is stable across saves.
The merge rule compares `modified` lexicographically, so timestamps must stay ISO strings.

Deletes are soft: `delete_note` moves the file to `trash/` (stamping `deleted`), never
overwriting; `restore_note` refuses an id that is live again; `purge_trash(None)` removes
every `.md` in `trash/`, unparseable ones included; `discard_note` hard-deletes (empty
notes).

## File watcher (`watch.rs`, desktop only)

`notify` + `notify-debouncer-mini` (300 ms), recursive on the project root; `classify`
keeps only top-level `notes/*.md` and `dagobert.json` (`trash/` is ignored) and emits
`project-changed` (`{kind: "note", note} | {kind: "note-removed", file} | {kind: "meta"}`).
`Recent` (`state.rs`): the commands in `lib.rs` mark every watched path they write (a
rename marks both names), and events for paths marked < 1 s ago are dropped so our own
saves don't echo.

The frontend applies events in `store.applyExternal`. Notes match by id, so an external
rename just updates `file`. A pending or in-flight local save wins over disk, unless the
body on disk differs from what we last read or wrote (`#disk` — a pull merged the remote's
edit): then a locally unchanged body takes the disk's, and a changed one keeps both as a
`<<<<<<< mine` / `>>>>>>> theirs` block. A `note-removed` for a note with a pending save
keeps the note and lets the save recreate the file. A note in `#deleted` that reappears
on disk (a merge restored it) comes back.

## Git primitives (`git.rs`)

Over `git2` (vendored libgit2/OpenSSL, no git binary). HTTPS only: the `ssh` feature is
off on every target, so libssh2 is never built.

- `open`: discovers upward but never past `~`, and never adopts a repository at `~`
  itself (a dotfiles repo) unless the project is `~`. The project may sit inside a larger
  repo: only `notes/`, `trash/`, `dagobert.json` and `.gitignore` under the project
  (`PATHS`) are ever staged, and the commit is built with `TreeUpdateBuilder` on HEAD's
  tree, so other staged files are untouched.
- `init` (on `main` or `init.defaultBranch`), `ensure_ignore` (adds `dagobert.local.json`,
  `.DS_Store`), `status` (our pathspecs only; `ahead/behind` vs the remote branch).
- `enable`: `Err("no-repo")`, refuses a project the repository ignores, probes
  `notes/probe.md` / `trash/probe.md` so a parent rule like `*.md` can't make tracking a
  silent no-op, then `ensure_ignore`.
- `commit_if_dirty` (signature from git config, else `Dagobert <dagobert@localhost>`).
- `fetch` (with the remote's refspecs) and `merge_fetched(root, save)`: up-to-date /
  fast-forward / adopt the remote branch on an unborn HEAD / `repo.merge` **without rename
  detection** (a note moved to `trash/` must conflict with an edit, not follow it), always
  returning `Merging` so `merge::resolve` finishes it. The fast-forward checkout is
  strict: a file saved meanwhile makes it fail before touching anything; it is committed
  with `save` and merged instead of being left as a silent local modification. libgit2
  refuses `repo.merge` over any staged change in the repository (e.g. the user's own in a
  parent repo); that error is reworded. `pull` chains both (tests only).
- `push` (sets the upstream). `remote_branch` picks the branch on `origin` the local one
  tracks (its upstream when it lives there, else its own name); pull, push and
  ahead/behind all use it.
- Detached HEAD is refused everywhere. Credentials (`callbacks` / `pick_cred`): the
  signed-in GitHub token as the HTTPS password and nothing else — no ssh-agent, no key
  files, no credential helper, never a prompt. The frontend passes it per call
  (`git_sync` / `git_quit` / `clone_project`); Rust never writes it to disk. `ensure_https`
  moves an ssh `origin` onto its HTTPS url before a fetch or push. `timeout` aborts a
  fetch via `transfer_progress` (a push's upload can't be interrupted through git2); an
  error past the deadline reads "timed out". Tests use temp repos sharing a bare remote
  (`tests::pair`).
- `clone` / `project_name` serve the phone's clone flow ([mobile.md](mobile.md)).

## Merge resolution (`merge.rs`)

`resolve(root, message)` completes a merge. Notes are matched **by id** across the
conflicted paths (ours / theirs / ancestor blobs parsed with `parse_note`; when the
conflicted path has no ancestor — a rename on both sides — the merge base's note with that
id, `Ctx.base`, serves). Then the frontmatter rules below apply, the body is three-way
merged with `merge_file_from_index` (labels `mine` / `theirs`; markers kept as body content
when it conflicts), and the result is written and staged at the winner's file name. A
conflicted note neither side can parse is left as git merged it (never deleted); one side
unparseable ⇒ the other wins and is reported.

Afterwards: `dedupe` folds files sharing an id (a title change on both sides is two adds
to git), `drop_trash_copies` removes `trash/` copies of live notes, `break_cycles` applies
rule 3 over the whole graph (every edge absent from the merge base, so edges git merged
cleanly count too; stamped by the side that added it when known, else the note's
`modified`), `dagobert.json` gets rule 6 (`serde_json::Value`, written back in `Meta`'s
field order; both sides invalid ⇒ the ancestor) — also when git line-merged it "cleanly"
into invalid JSON (the on-disk file is validated and rebuilt from HEAD / MERGE_HEAD /
base). A `.gitignore` conflict is the union of both sides' lines. A conflict in any other
file (a project nested in a larger repo) is an error: the merge stays in progress for the
user to finish with git and every cycle reports it. Returns the
`Conflict { id, title, file, body_conflict }` list for the popup (also notes merged
automatically).

Merge rules for a note edited on both sides:

1. The side with the later `modified` wins the whole frontmatter.
2. `tags` and `deps` are merged three-way against the ancestor (ours first, then theirs'
   additions; an item either side removed stays removed); `created` = earlier,
   `modified` = later.
3. Added edges that would close a cycle are dropped, newest edge first kept.
4. Deleted on one side, edited on the other ⇒ the edit wins and the trash copy goes.
5. Same filename added on both sides with different ids ⇒ theirs gets the `-<id>` suffix.
6. `dagobert.json`: `tag_colors` / `repos` unioned (ours wins per key), palette unioned,
   workflows unioned by id (ours wins), other keys ours (theirs fills in missing ones).

Body: a one-sided change wins, else a three-way merge whose conflicts keep git's markers
as content (warning badge on the card, count in the toolbar, `ConflictBlock` in the editor).

## The sync cycle (`sync.rs`)

`cycle`: resolve a leftover merge → commit if dirty → fetch → commit again → merge →
resolve → push when ahead or unpublished; errors land in `SyncReport.error` after whatever
succeeded. Two guards keep a note saved mid-cycle (e.g. by a standalone window) from being
buried under the remote's version: the second commit catches a save during the fetch, the
strict fast-forward checkout one after it.

A process-wide lock (`locked`, on a blocking thread) and the tick thread (`configure`;
emits `git-tick`; disabled or interval 0 stops it; a generation counter retires old
threads). Commit messages are `dagobert auto-save <stamp>` / `dagobert merge <stamp>`; the
frontend passes the local-time stamp (`stamp()` in `time.ts`).

Quitting (desktop): closing the main window or quitting with tracking on is held back
(`intercept_quit` → `prevent_close` / `prevent_exit`; a second request while the sync
runs keeps waiting, only the close/exit `finish_quit` itself triggers goes through),
`git-quit` is emitted with the reason, the frontend flushes saves and calls `git_quit`
(10 s transfer timeout, failures logged; `path: null` when it has nothing to sync), then
Rust destroys the window or exits (`finish_quit`, also fired by a 20 s `QUIT_DEADLINE`
thread so a hung connect or a silent frontend can't block quitting). An updater restart
(`RESTART_EXIT_CODE`) is never held; the frontend synced first ([ui.md](ui.md)).
`git_sync` / `git_quit` clear `Recent` first (the frontend has awaited its writes), so
files the pull rewrites echo as `project-changed` even when the same note was flushed a
moment earlier, and reach the store through `applyExternal`.

## Frontend side (`store.svelte.ts`)

`gitEnabled` / `gitInterval` mirror `Meta.git`. A cycle is triggered by the timer
(`git-tick`), `⌘S` ("Commit now", also inside text fields), opening a project, close/quit,
and on a phone foreground/background ([mobile.md](mobile.md)). `open()` starts the
watcher before its first sync, since the pull may rewrite files. No `origin` ⇒ commit only
(toolbar icon greyed "local"). `syncs` (false in standalone note windows, set by
`App.svelte`) gates the timer and every cycle.

State: `gitStatus`, `gitState` (`idle | syncing | error`) + `gitError`, `gitLastSync`,
`conflictIds` (notes whose body has conflict markers; `hasConflict`, `nextConflict`),
`conflictReport` (drives the popup), `needsRepo` (drives the no-repo popup). `enableGit`
→ `git_enable` (no-repo → popup → `initRepo`). `syncNow(manual)` flushes and awaits every
in-flight write (`flushAndWait`: note saves in `#inflight`, meta/local saves, deletes,
restores and purges in `#writes`) then calls `git_sync`; a `syncNow` while a cycle for
the same project runs queues one follow-up (`#queued`) so edits made since its flush get
committed; a report that comes back after the project changed is dropped; errors toast
only when manual. `quitSync` answers `git-quit`.

Saves: note saves are debounced 500 ms (`touch` bumps `modified` unless `silent`, then
`save`; `immediate` for structural changes); `saveMeta` / `saveViewport` are debounced
400 ms each. Writes are serialised per note (`#inflight`) and `remove` awaits them before
trashing; `#deleted` stops late writes resurrecting a note.

UI: `WorkflowEditor` (`section="git"`) holds the tracking toggle, interval 1–120 min,
branch / remote / last sync and "Sync now". `GitDialog.svelte` is the modal for the no-repo
prompt (`kind="norepo"`) and the post-merge conflict list (`kind="conflicts"`).
