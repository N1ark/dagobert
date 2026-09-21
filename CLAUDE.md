# Dagobert — notes for Claude

DAG-shaped note-taking/task app. Tauri 2 + Svelte 5 (runes) + Vite, no SvelteKit.
Keep it lightweight: avoid adding dependencies unless they clearly pay for themselves.

## Commands

```sh
npm run tauri dev                              # desktop app (compiles Rust, opens window)
npm run dev                                    # UI only in a browser, in-memory backend
npm run check                                  # svelte-check (must be 0 errors / 0 warnings)
npm test                                       # tests/*.test.mjs (pure TS modules) + cargo test
npm run format                                 # prettier (+svelte plugin) and cargo fmt; run before committing
npm run format:check
npm run lint                                   # eslint (ts + svelte) and cargo clippy -D warnings; must be clean
npm run tauri build
npm run install:app                            # release build → quit running app → replace in /Applications → relaunch
npm run version -- X.Y.Z                       # sync versions, roll CHANGELOG, commit + tag
                                               # pushing that to main makes the Release workflow publish a GitHub release (DMGs)
```

Verifying UI changes: `npm run dev`, open http://localhost:1420 in a browser, click
"Open a folder…" (returns a mock project). The native window can't be screenshotted
from the CLI, so the browser shim is the practical way to check interactions.

CI (`.github/workflows/ci.yml`) runs format:check, lint, check, test and the Vite
build on every PR and on main (concurrency-cancelled per ref, macOS runner because
of AppKit). `release.yml` runs on main when version files change: if no GitHub
release exists for `package.json`'s version it builds DMGs (arm64 + x86_64) with
`tauri-action` and publishes one, using that version's CHANGELOG section as notes.
Builds are unsigned.

## Layout

- `src-tauri/src/store.rs` — all disk I/O. Project = folder; `notes/<slug>.md` per
  note (YAML frontmatter + markdown body); `dagobert.json` holds `Meta`
  (`tag_colors`, `workflows`, `repos`, `palette`, templates, `git`); per-machine state
  (`Local`: the viewport) lives in `dagobert.local.json` so it never syncs — a legacy
  `viewport` in `dagobert.json` is migrated on read and dropped on the next write
  (`save_local` command). `save_meta` refuses to write over a `dagobert.json` it can't
  parse (reads still fall back to defaults). A legacy `done: true` in frontmatter is
  migrated to `status: done` on read and never written back. Deletes are soft:
  `delete_note` moves the file to `trash/` (stamping `deleted`), never overwriting
  (`free_name` adds `-<id>[-n]` suffixes); `list_trash`/`restore_note`/`purge_trash`
  round it out. Commands: `open_project`, `save_note`, `delete_note`, `list_trash`,
  `restore_note`, `purge_trash`, `discard_note`, `read_meta`, `save_meta`, `save_local`.
  Has round-trip tests. `lib.rs` just exposes these commands.

- `src-tauri/src/git.rs` — git primitives over `git2` (vendored libgit2/libssh2/OpenSSL,
  no git binary): `open` (discover, walking up but never past `~` so a dotfiles repo is
  never adopted; the project may sit inside a larger repo — only
  `notes/`, `trash/`, `dagobert.json` and `.gitignore` under the project are ever staged,
  via `TreeUpdateBuilder` on HEAD's tree so other staged files are untouched), `init` (on `main`, or `init.defaultBranch`),
  `ensure_ignore` (adds `dagobert.local.json`, `.DS_Store`), `status` (restricted to our
  pathspecs; `ahead/behind` vs the remote branch), `enable` (`Err("no-repo")`, refuses a
  project the repository ignores, then `ensure_ignore`), `commit_if_dirty` (signature from
  git config, else `Dagobert <dagobert@localhost>`), `fetch` (with the remote's refspecs)
  and `merge_fetched(root, save)` (up-to-date / fast-forward / adopt the remote branch on
  an unborn HEAD / `repo.merge` **without rename detection**, always returning `Merging`
  so `merge::resolve` finishes it; `pull` chains both, tests only), `push` (sets the
  upstream). The fast-forward checkout is strict: a file saved meanwhile (a standalone
  window) makes it fail before touching anything, and it is committed with `save` and
  merged instead of being left as a silent local modification. `remote_branch` picks the branch on `origin` the local one tracks (its
  upstream when it lives there, else its own name) and pull, push and ahead/behind all
  use it. The cycle commits again between fetch and merge: a fast-forward checkout is
  `safe().allow_conflicts` and would keep a note saved meanwhile as a local
  modification, silently burying the remote's version at the next commit; committing it
  first turns that into a real merge. libgit2 refuses `repo.merge` over any staged change
  in the repository (e.g. the user's own in a parent repo); that error is reworded.
  Detached HEAD is refused everywhere with an error. `enable` also probes
  `notes/probe.md` / `trash/probe.md` so a parent rule like `*.md` can't make tracking a
  silent no-op. Credentials (`callbacks`): ssh-agent, then `~/.ssh/id_*`, then the
  credential helper; never prompts. `timeout` aborts a fetch via `transfer_progress` (a push's upload can't be
  interrupted through git2); an error past the deadline reads "timed out". Tests use temp
  repos sharing a bare remote (`tests::pair`).
- `src-tauri/src/merge.rs` — `resolve(root, message)` completes a merge: notes are
  matched **by id** across the conflicted paths (ours / theirs / ancestor blobs parsed with
  `parse_note`; when the conflicted path has no ancestor — a rename on both sides — the
  merge base's note with that id, `Ctx.base`, serves), then the frontmatter rule below is
  applied, the body is three-way merged with `merge_file_from_index` (labels `mine` /
  `theirs`; markers kept as body content when it conflicts), and the result is written
  and staged at the winner's file name. A conflicted note neither side can parse is left
  as git merged it (never deleted); one side unparseable ⇒ the other wins and is reported.
  After that, `dedupe` folds files sharing an id (a title change on both sides is two adds
  to git), `drop_trash_copies` removes `trash/` copies of live notes, `break_cycles`
  applies rule 3 over the whole graph (every edge absent from the merge base, so edges git
  merged cleanly count too; stamped by the side that added it when known, else the note's
  `modified`), `dagobert.json` gets rule 6 (`serde_json::Value`, written back in `Meta`'s
  field order; both sides invalid ⇒ the ancestor) — also when git line-merged it
  "cleanly" into invalid JSON (the on-disk file is validated and rebuilt from HEAD /
  MERGE_HEAD / base). A `.gitignore` conflict is the union of both sides' lines. A
  conflict in any other file (a project nested in a larger repo) is an error:
  the merge stays in progress for the user to finish with git and every cycle reports it.
  Returns the `Conflict { id, title, file, body_conflict }` list for the popup (also notes
  merged automatically).
- `src-tauri/src/sync.rs` — the cycle (`cycle`: resolve a leftover merge → commit if
  dirty → fetch → commit again → merge → resolve → push when ahead or unpublished; errors land in
  `SyncReport.error` after whatever succeeded), the process-wide lock (`locked` runs
  on a blocking thread), the tick thread (`configure`; emits `git-tick`, generation
  counter retires old threads) and `intercept_quit`. Commit messages are
  `dagobert auto-save <stamp>` / `dagobert merge <stamp>`; the frontend passes the
  local-time stamp (`stamp()` in `time.ts`). `lib.rs` commands: `git_status`,
  `git_enable` (`Err("no-repo")`), `git_init`, `git_configure`, `git_sync`, `git_quit`.
  Closing the main window or quitting with tracking on is held back
  (`prevent_close`/`prevent_exit`; a second request while the sync runs keeps waiting,
  only the close/exit `finish_quit` itself triggers goes through), `git-quit` is emitted with the reason, the frontend
  flushes saves and calls `git_quit` (10 s transfer timeout, failures logged; `path: null`
  when it has nothing to sync, so the quit still goes through), and Rust
  then destroys the window or exits (`finish_quit`, also fired by a 20 s `QUIT_DEADLINE`
  thread so a hung connect or a silent frontend can't block quitting). `git_sync`/`git_quit`
  clear `Recent` first (the frontend has awaited its writes), so files the pull rewrites
  echo as `project-changed` even when the same note was flushed a moment earlier, and
  reach the store through `applyExternal`.

- `src-tauri/src/watch.rs` — file watcher (`notify` + `notify-debouncer-mini`, 300 ms).
  `watch_project`/`unwatch_project` commands; emits `project-changed` events
  (`{kind: "note", note} | {kind: "note-removed", file} | {kind: "meta"}`). `AppState`
  (Tauri managed state) holds the watcher and `Recent`: every writing command marks the
  path it touched, and events for paths marked < 1 s ago are dropped so our own saves
  don't echo. The frontend applies events in `store.applyExternal` (matching notes by
  id, so external renames just update `file`; a pending or in-flight local save wins over
  disk — but when the body on disk differs from what we last wrote (`#disk`, a pull merged
  the remote's edit) the two are kept as a `<<<<<<< mine` / `>>>>>>> theirs` block rather
  than dropping the remote's text; a `note-removed` for a note with a pending save keeps
  the note and lets the save recreate the file; a note in `#deleted` that reappears on
  disk — a merge restored it — comes back).
- `src/lib/backend.ts` — wraps `invoke`; falls back to an in-memory mock when
  `window.__TAURI_INTERNALS__` is absent. All Tauri calls go through here, including
  cross-window sync (`broadcast`/`subscribe`: Tauri events, BroadcastChannel in the
  browser) and `openNoteWindow` (a `note-<id>` WebviewWindow loading
  `index.html?note=<id>&path=<project>`).
- `src/lib/store.svelte.ts` — single `store` instance (class with `$state` fields):
  notes, viewport, tag colours/filter, selection, recent folders, graph helpers
  (`wouldCycle`, `dependents`, `isReady`), debounced saves (`touch`/`save`, 500 ms;
  `immediate` for structural changes; `silent` to skip bumping `modified`;
  `saveMeta` for tag colours/workflows/settings, `saveViewport` for the local file).
  Git slice: `gitEnabled`/`gitInterval` (from `Meta.git`), `gitStatus`, `gitState`
  (`idle | syncing | error`), `gitLastSync`, `conflictIds` (notes whose body has a
  `<<<<<<< ` line; `hasConflict`), `conflictReport` (drives the popup), `needsRepo`
  (drives the no-repo popup). `enableGit` → `git_enable` (no-repo → popup → `initRepo`);
  `syncNow(manual)` flushes and awaits every in-flight write (`flushAndWait`: note saves in
  `#inflight`, meta/local saves, deletes, restores and purges in `#writes`) then calls
  `git_sync`; a `syncNow` while a cycle for the same project runs queues one follow-up
  cycle (`#queued`) so edits made since its flush get committed; a report
  that comes back after the project changed is dropped (`#syncingPath`); errors toast only when manual. `quitSync` answers `git-quit`. `open()`
  reconfigures the timer and syncs right away when tracking is on; `syncs` (false in
  standalone note windows, set by `App.svelte`) gates the timer and every cycle. Last-opened path is in localStorage and
  restored on startup (`restore`). Writes are serialised per note (`#inflight`) and
  `remove` awaits them before trashing; `#deleted` stops late writes resurrecting a
  note. Trash state: `trash`, `loadTrash`, `restoreNote`, `purge`.
- `src/lib/Canvas.svelte` — pan/zoom/drag/link interactions and edge rendering.
  Exposes `focusNode`, `createAtCenter`, `fitAll` via `bind:this`. Arrowheads are plain
  `<path class="head">` triangles (`head()`), never SVG `<marker>`s: WebKit re-renders
  markers on every paint, and a few hundred of them on screen (zoomed out) dropped
  panning to ~25 fps. Wheel events are queued and applied once per animation frame
  (`applyWheel`): a trackpad fires far more often than the display refreshes, and
  WebKit re-flushes style and hit-tests the world after each one. `.world` carries
  `will-change: transform` so it's a compositor layer from the start (panning
  translates tiles; otherwise WebKit promotes it mid-gesture with a ~65 ms hitch) and
  its transform is inline rather than via custom properties on `.canvas` (changing an
  inherited property re-resolves every descendant). `Grain`'s loop skips a frame the
  input effect already drew. The world edge (shade outside the square + dashed rim) is
  drawn as screen-space bands clamped to the view (`worldEdge`), never as world-sized
  shapes inside `.world`: WebKit repaints a shape that large for every tile it
  rasterises, which alone ate a third of the frame budget while zooming or panning
  fast. Profile in Safari, not Chrome (Chrome is fine either way);
  `main.ts` exposes `window.store` in dev builds so a script can seed a big graph, and
  simulate panning with dispatched `WheelEvent`s, not by writing `store.viewport`.
- `src/lib/layout.ts` — pure layered layout (`layout(nodes, opts)`): longest-path
  layering, barycenter ordering sweeps, columns centred on the tallest, components
  stacked vertically (largest first). `Canvas.tidy()` applies it (selection-only
  when `store.multi.length > 1`, anchored at the selection's top-left). Test:
  `node tests/layout.test.mjs`.
- `src/lib/Grain.svelte` + `grainGL.ts` — decorative WebGL layer under the canvas
  (`z-index: -1` inside `.canvas`, which is `isolation: isolate`). The component owns
  props, the fade-in bookkeeping and the frame loop; `grainGL.ts` is plain WebGL1
  (`createGrain(canvas)` → `render(w, h, frame)`), so `scripts/grain-bench.mjs` can
  drive it headlessly (timings on the real GPU; `node scripts/grain-bench.mjs <ref>`
  also pixel-compares against that git ref). Shaders are `.glsl/.frag/.vert` files
  imported with Vite `?raw`; `precision`, `MAX_RECTS`/`MAX_CURVES` `#define`s and the
  shared `grain.glsl` (hash, bez) are prepended. Two passes: `travellers.vert/.frag`
  draw one small quad per sand grain riding an edge into an offscreen RGBA8 texture
  (MAX blending via `EXT_blend_minmax`, additive fallback), then `grain.frag` runs
  full-screen and samples it once — cost scales with grain count, not screen area
  (a per-fragment loop over 30 long edges cost ~200 ms/frame at 2× full screen).
  `grain.frag`: 1–2 _device_-pixel specks that twinkle in place (per-cell phase;
  frozen under `prefers-reduced-motion`), masked by a 24px rounded-rect vignette
  along the frame and a halo around the selected nodes (`glowRects` in
  `Canvas.svelte`, up to 16, faded in over 160 ms, scaled by zoom, tinted
  `--accent2`). Cells live in world space so the sand sticks to the graph; the cell
  size is chosen per power-of-two zoom band (crossfaded between bands) to stay ~1–2
  device px. It also draws the dot grid per pixel (`dots()`, lattice 16 + 32k;
  radius/opacity taper with zoom via `grid` in `Canvas.svelte`); the CSS `.bg` grid
  is only the fallback when the shader is off, since repeating backgrounds get
  pixel-snapped per tile and flicker while panning. The sand and the dot grid use a
  parallax'd camera (`bg` in `Canvas.svelte`: the foreground camera scaled by 0.7
  about the view centre, i.e. perspective at depth 0.7; `comp` cancels the
  translation a resize would otherwise cause) so they read as further away than the
  nodes; the halo and edge travellers stay in the foreground camera. Every edge in
  the selected node's chain (`flowCurves` in `Canvas.svelte`, the same cubic as the
  SVG `path()`, up to 48) gets sand grains travelling dependency → dependent
  (`travellerCount(len)`: one per ~14 world px, 6–48). The buffer is resized inside
  a `ResizeObserver` and drawn synchronously on input changes so a stretched or
  lagging frame never shows. Toggled by the "background grain" palette action
  (localStorage `dagobert.grain`).
- `src/lib/Minimap.svelte` — bottom-right overview (180×120). Bounds = all notes ∪
  the viewport, padded, so the view box always stays inside the map. Click/drag
  pans (stopPropagation keeps the canvas from panning too). Collapsed state in
  localStorage `dagobert.minimap`. Hidden when fewer than 2 notes.
- `src/lib/NodeCard.svelte` — a node. Reports its height via `onresize` so edges
  can anchor at mid-height (don't use `bind:` with a fallback — Svelte 5 throws).
- `src/lib/NotePanel.svelte` — right-hand editor. Re-keyed per note id in `App.svelte`
  so local state resets on selection change. The body is edited by `LiveEditor`.
- `src/lib/LiveEditor.svelte` — Obsidian-style live preview, per block. `blocks.ts`
  splits the body on blank lines (fenced code and `<<<<<<< `…`>>>>>>> ` conflict regions
  kept whole; a region belongs to the paragraph around it so resolving it never adds
  paragraph breaks; an unterminated `<<<<<<< ` is ordinary text; blank-line runs
  collapse on re-join). A block holding a region renders through `ConflictBlock.svelte`
  (two stacked `Markdown` panes showing the whole paragraph as each side wrote it + keep
  mine / theirs / both, via `resolveConflict` and
  `store.touch(id, { label: "resolve conflict" })`); clicking it edits the raw text.
  `hasMarkers` (badge, toolbar count) is fence-aware through the same splitter. `stripMarkers`/`MARKER_RE` keep marker lines out of search and
  card previews. Every block renders via `Markdown.svelte` except the `active` one, which
  is a textarea holding `draft`. Rules worth knowing: the draft is live-synced into
  `note.body` unless it's empty (an empty block can't be represented, so it's dropped
  only when leaving it — see `moveBy`'s `dropped` offset); typing a blank line splits
  the draft and moves the caret to the right new block (`locate`); a "virtual" block
  (`active === blocks.length`) exists for appending; Backspace at offset 0 merges into
  the previous block; ↑/↓ on first/last line move between blocks; Esc leaves edit
  mode; clicking a rendered block places the caret near the click via
  `caretRangeFromPoint` + text search; task checkboxes toggle in place
  (`toggleCheckbox`). `@` mentions and the `editor.ts` shortcuts live here too.
- `src/lib/ContextMenu.svelte` — right-click menu, opened by `Canvas` for a node
  (open / status / tag checklist + new tag / delete), an edge (remove link) or the
  background (new note here). Closes on outside pointerdown, Esc or window blur.
  Rendered as a sibling of `.canvas`, not inside it: a `position: fixed` element inside
  the `overflow: hidden` canvas makes WebKit drop the canvas clip and paint the graph
  over the note panel.
- `src/lib/editor.ts` — pure textarea commands (`toggleWrap`, `link`,
  `continueList`, `indent`, `command`) used by the panel's body `onkeydown`.
  Test them with a node script (`node --experimental-strip-types` works) rather
  than in the browser.
- `src/lib/history.ts` — pure undo stack (`History`, `NoteDiff`, `sameNote`). The
  store integrates it: every `touch`/`create`/`remove`/`restoreNote` calls
  `#record`, which batches all diffs recorded in the same microtask into one entry
  (so loops over a group become one undo step) and keeps `#last` (per-note baseline
  snapshot) current. `#apply` replays `before`/`after`: deleted notes come back via
  their `trashFile` (falls back to recreating from the snapshot if the trash was
  emptied); notes that must vanish go through `remove()`. `#applying` suppresses
  recording during replay; `applySync`/`applyExternal` update `#last` without
  recording. `opened`/`modified`/`file` changes never count as edits (`sameNote`).
  Pass `label` to `touch` for a readable "Undid: …" toast (`store.notice`).
- `src/lib/wikilinks.ts` — `[[Title]]` links: `renderWikilinks` (pre-pass before
  marked, skips code; resolved → `<a class="wikilink" href="#note-<id>">`, missing →
  `.wikilink.missing`), `wikilinkTarget` for click handling, `mentions` (backlinks),
  `renameLinks` (rewrites bodies when a title is committed in the panel), and
  `caretCoords` (mirror-div caret measurement for the `@` popup). Test `blocks.ts`
  and `editor.ts` with a node script (`node file.mjs` importing the .ts works).
- `src/lib/github.ts` — GitHub REST client (`searchIssues`, 60 s cache, token from
  localStorage `dagobert.githubToken` or `gh auth token` via the `github_cli_token`
  command). `IssuePopup.svelte` is the `alias#query` picker in `LiveEditor` (same
  `handleKey` pattern as mentions). Repo aliases live in `Meta.repos` (`store.repos`,
  `setRepo`); `renderRepoRefs` in `wikilinks.ts` auto-links `alias#123` at render time
  (class `.ghref`), so the raw markdown stays plain. `repoRefs(md)` lists those refs.
- `src/lib/PullRequests.svelte` — left sidebar (toolbar "PRs", `⇧⌘P`, localStorage
  `dagobert.prs`) listing every PR referenced as `alias#123` across notes: state icon
  (open/draft/merged/closed), title (opens GitHub), author, updated, comment count and
  chips for the notes mentioning it (click = jump). `github.issue(repo, n)` serves each
  from the cached recent list, else one request per number; `invalidate()` backs the
  refresh button. Fetching lives in `prs.svelte.ts`: `prCache` (module-level `$state`,
  keyed `prKey(repo, n)`), `linkedRefs()` (every ref across notes), `syncPRs()` (the
  fetch effect, started once in `App.svelte` so the cache fills in the background
  whether or not the pane is open; batched and, in the first seconds after launch,
  deferred to an idle callback) and `refreshPRs()`. `PrIcon.svelte` is the shared state
  icon (PR open/draft/closed/merged, issue open/closed): pass `item` or a cache `key`.
  Used by the sidebar, `IssuePopup` and inline: `renderRepoRefs` puts `data-ref` on
  each `.ghref` anchor and the `prIcons` action (`prIcons.svelte.ts`, on `Markdown` and
  `InlineMd`) `mount()`s a `PrIcon` into every one after render. Rows are grouped per repo with a
  divider. Plain issues are dropped. "Hide closed/merged" toggle persists in
  `dagobert.prsHideClosed`. Width is `--prs-w` (`prsW` in `App.svelte`, localStorage
  `dagobert.prsWidth`, dragged via `.resizer.left`). Toggling or resizing calls
  `absorb(dx)`, which shifts the viewport by the canvas's left-edge move so the graph
  doesn't move; `Canvas` cancels the matching background parallax shift.
- `src/lib/MentionPopup.svelte` — the `@` autocomplete in `LiveEditor`; parent
  forwards keys via `handleKey`. Offers "Create …" when no title matches.
- `src/lib/menu.ts` — builds the native app menu from `paletteActions` in
  `App.svelte` (each `Action` has `id`, `menu` section, optional `menuLabel`,
  `hint` → accelerator). Rebuilt only when `menuSignature` changes; menu closures
  must read live state (`store.selected`) rather than captured values. Because a
  menu accelerator and the window `keydown` handler can both fire for one key,
  actions run through `once(id, fn)` (150 ms dedupe) and `store.undo/redo` dedupe
  themselves. Edit menu keeps the native Cut/Copy/Paste/SelectAll items; menu
  Undo/Redo call `execCommand` inside text fields and the store elsewhere.
- Menu bar icons are SF Symbols: `Action.symbol` lists candidate names; the Rust
  `sf_symbol` command (`symbols.rs`, objc2-app-kit) renders the first that exists to
  PNG, and `sfsymbol.ts` centres/tints it on a canvas for the current appearance
  (menu rebuilt when appearance flips). Phosphor icons are only used in-app.
- `src/lib/QuickOpen.svelte` takes `mode: "notes" | "commands"` (⌘K vs ⇧⌘K).
- `src/lib/highlight.ts` — `highlight.js/lib/core` with a hand-picked language list
  (import per language; add there, plus aliases like `svelte` → `xml`) and
  `highlightExtension`, the marked renderer `Markdown.svelte` installs. Unknown or
  missing languages fall back to escaped plain text. Token colours are `.hljs-*`
  rules in `app.css` using the tag palette. Test: `tests/highlight.test.mjs`.
- `src/lib/InlineMd.svelte` — renders a title as inline markdown (`marked.parseInline`
  - DOMPurify). Used wherever a title is displayed (card, dep lists, picker, trash);
    the panel's title field stays a raw `<input>`.
- `src/lib/QuickOpen.svelte` — `⌘K` (`⇧⌘K` = command mode) palette (App owns `showQuickOpen`; not in
  standalone windows). Matching lives in `fuzzy.ts` (`fuzzyMatch`: prefix > word-start
  > substring > subsequence; `parseQuery`: `#tag` filter, `>` command mode). Commands
  > come from App's `paletteActions` prop so the palette stays dumb.
- `src/lib/TrashDialog.svelte` — modal listing `trash/` with restore / delete forever / empty.
- `src/lib/LinkPicker.svelte` — search dropdown used for adding deps/dependents.
- `src/lib/workflows.ts` — `DEFAULT_WORKFLOW` (todo → done, id `""`, never stored)
  and `stageColor`. `WorkflowEditor.svelte` is the modal for managing custom workflows.
- `src/lib/tags.ts` — built-in tag colour palette (site's code-hue colours; index 0 is
  the default) and `normalizeColor`. Users extend it with `Meta.palette` (`store.palette`,
  `addPaletteColor`/`removePaletteColor`): `ColorPicker`'s "+" swatch opens a hidden native
  `<input type="color">` (live preview on `input`, added to the palette and picked on
  `change`); custom swatches are removed by right-click.
- `src/lib/WorkflowEditor.svelte` doubles as the settings dialog: `section` prop
  picks "workflows", "github" or "git" (tracking toggle, interval 1–120 min, branch /
  remote / last sync, "Sync now"). `GitDialog.svelte` is the modal for both the
  no-repo prompt (`kind="norepo"`) and the post-merge conflict list (`kind="conflicts"`).
- `src/lib/ColorPicker.svelte` — shared swatch popover (tag colours and workflow
  stage colours; `allowAuto` adds an "Automatic" swatch: dashed ring + lightning bolt).
- `src/lib/tooltip.ts` — `use:tooltip={"text"}` action: an instant tooltip (one shared
  `.tooltip` element on `<body>`, styled in `app.css`). Also takes `{ html }` (must be
  DOMPurify output, e.g. `inlineHtml` from `inline.ts`, the renderer `InlineMd` uses)
  or a function evaluated per hover (`PullRequests` uses it to show overflowing titles). Prefer it over `title` on
  icon-only controls, since native tooltips take a second to appear. `TagColorPicker.svelte` wraps it; `TagMenu.svelte` — toolbar
  popover listing all tags (click name = toggle filter, click dot = recolour).
  Tag chips share the global `.tag-chip` class with `--tag` set to the colour.
- `assets/` — source SVGs: `logo.svg` (rounded background; the app icon) and
  `icon.svg` (transparent glyph). Regenerate `src-tauri/icons/` with
  `npm run tauri icon assets/logo.svg` (then delete the android/ios folders it
  adds). `public/` holds copies served by Vite for the favicon, toolbar and welcome screen.
- Icons: `phosphor-svelte` (https://phosphoricons.com), imported per icon as
  `import X from "phosphor-svelte/lib/X"`. No hand-drawn glyphs or unicode symbols
  for UI icons.
- `src/app.css` — theme tokens (from n1ark.com's dark mode) and `.markdown` styles.

## Working rules

- Comments: as few as possible, and only the bare minimum (1 line max).
- Every user-facing change gets a line in `CHANGELOG.md` under Unreleased.
- Always commit your changes, one commit per feature. If you fix something in the
  previous commit, amend it rather than adding a new commit.

## Conventions & decisions

- Graph direction: `note.deps` lists what the note depends on. Edges/arrows are
  drawn dependency → dependent ("this unlocks that"). Dragging from a node's
  right-hand port onto another node makes the _target_ depend on the _source_.
- Cycles are rejected in `store.addDependency`; pickers pre-filter with `wouldCycle`.
- Progress: a note has `workflow` (id, `null` = built-in Todo) and `status` (stage
  name). Done-ness is derived — `store.isDone(note)` checks whether the current stage
  has `done: true` — never read a `done` field. Default-workflow notes show a checkbox;
  custom ones show a status pill (click = `store.advance`, shift-click = `advance(id, -1)`, wraps around). Pill colour:
  `Stage.color` if set, else `stageColor`'s automatic grey/yellow/green. Switching
  workflow maps done → first done stage, else first stage. Editing a workflow repairs
  notes whose stage vanished (`updateWorkflow`); deleting one reverts its notes to Todo.
- Templates: `Workflow.template` and `Meta.default_template` (for Todo), edited in
  `WorkflowEditor`. `store.create` fills `body` from `templateFor(workflow)` via
  `renderTemplate` only when `init.body` is undefined (clones/pastes pass a body).
  `isEmpty` treats a body equal to its template as blank so accidental notes are still
  discarded; `setWorkflow` swaps in the new template only when the body is blank by
  that definition.
- Tracking issues: `note.tracking` (frontmatter `tracking: true`, omitted when false).
  `isDone` = all direct deps done (and at least one dep); `setDone`/`advance` are
  no-ops; never "ready". `store.progress(note)` feeds `ProgressRing.svelte`. They have
  their own template (`Meta.tracking_template`, settings → "Tracking issue").
- "Ready" = not done and every dep is done. Shown with a purple ring; counted in toolbar.
- Canvas dimming: `App.svelte` computes `matches` = search terms AND tag filter
  (tag filter is OR across selected tags); `null` means nothing is filtered. When
  `matches` is null and Focus is on (`focus` prop, localStorage `dagobert.focus`),
  Canvas dims everything outside the selected note's `chain` (ancestors +
  descendants) at a softer opacity (`.soft-dim`). `visible = matches ?? chain`.
- Tag colours are project-wide (`tag_colors` in `dagobert.json`), not per note.
  The default colour is not stored (`setTagColor` deletes the entry).
- Timestamps are ISO strings generated in the frontend; Rust treats them as opaque
  (the merge rule compares `modified` strings lexicographically, which works for ISO).
- Git tracking is per project (`Meta.git`), off by default. One cycle =
  flush saves → commit if dirty → pull → resolve → push; triggered by the timer, `⌘S`
  ("Commit now", also inside text fields), right after opening, and on close/quit. No
  `origin` ⇒ commit only (toolbar icon greyed "local"). Merge rule for a note edited on
  both sides: (1) the side with the later `modified` wins the whole frontmatter;
  (2) `tags` and `deps` are merged three-way against the ancestor (ours first, then
  theirs' additions; an item either side removed stays removed), `created` = earlier,
  `modified` = later; (3) added edges that would close a cycle are dropped, newest edge first kept;
  (4) deleted on one side, edited on the other ⇒ the edit wins and the trash copy goes;
  (5) same filename added on both sides with different ids ⇒ theirs gets the `-<id>`
  suffix; (6) `dagobert.json`: maps unioned (ours wins per key), palette unioned,
  workflows merged by id, scalars ours. Body: one-sided change wins, else a three-way
  merge whose conflicts keep git's markers as content (warning badge on the card,
  count in the toolbar, `ConflictBlock` in the editor). Only the main window syncs.
- Filenames derive from the title (`slugify` in `store.rs`); collisions get `-<id>`.
  The backend owns `note.file` — the frontend never sets it.
- Wheel: plain scroll pans, `ctrl`/`meta`+wheel (pinch) zooms. Wheel listener is
  attached manually with `passive: false`.
- Keyboard: `⌘N` new note, `⌘K` quick open, `⌘F` search, `⌘O` open folder, `Esc` deselect,
  `⌫`/`⌦` removes a selected edge, or with a note selected arms the panel's Delete button (second press deletes; `NotePanel` owns that listener). Global handlers ignore events from inputs/textareas.
  Canvas navigation (`navigate` in `Canvas.svelte`): `←`/`→` = closest-by-y
  dependency/dependent, `↑`/`↓` = nearest node above/below (overlapping x preferred),
  `Tab`/`⇧Tab` = next dependent/dependency in y order, `Enter` bumps
  `store.focusTitle` (NotePanel focuses the title). With nothing selected, any arrow
  picks the node nearest the view centre. `ensureVisible` pans minimally.
  In the body editor: `⌘B` bold, `⌘I` italic, `⌘E`/`` ⌘` `` code, `⌘K` link,
  `⌘⇧X` strike, `⌘H` ==highlight==, Enter continues lists, Tab/⇧Tab indents.
- Double-click on a node = `store.openInWindow`; on empty canvas = create note.
- Multiple windows: `App.svelte` reads `?note=`/`?path=` and renders just
  `NotePanel` (`standalone` prop) full-window. Every window has its own `store`;
  writes broadcast `note` / `note-removed` / `meta` messages and `store.applySync`
  applies them (skipping notes with a pending local save). `save_meta` takes a
  `MetaPatch` and merges on disk, so a popup saving tag colours can't clobber the
  main window's viewport — `saveViewport()` and `saveMeta()` mark separate dirty
  flags. Capability `windows` includes `note-*`.
- Right pane width: `panelW` in `App.svelte`, persisted in localStorage
  (`dagobert.panelWidth`), dragged via `.resizer`; `--panel-w` is set on `.main`.
- Empty notes (no title/body/tags/links — `store.isEmpty`) are hard-deleted via
  `store.discard` → `discard_note` (no trash entry) whenever they're deselected
  (`select()`), which covers Esc, ✕, and clicking the canvas. Guards against
  accidental double-clicks.
- Multi-select: `store.multi` (string[]); `store.select(id)` resets it to `[id]`.
  Shift+drag on the background is a marquee (live, additive), shift+click toggles a
  node, ⌘A selects all. Dragging a node inside the group moves the group. Right-click
  on a grouped node opens the `group` context menu (bulk done/undone, tag checklist
  with all/some/none state, delete). `NodeCard`'s `grouped` prop draws the ring.
- Node width: optional `width` in frontmatter (omitted = default 220, see
  `NODE_W`/`widthOf` in `Canvas.svelte`). Resized via the bottom-right grip
  (`[data-resize]`), clamped 140–640; "Reset width" in the context menu clears it.
- Canvas clipboard: `⌘C` copies the selected node to `store.clipboard` (plus a
  plain-text version to the system clipboard), `⌘V` pastes under the cursor (or view
  centre), `⌘D` duplicates at +30/+30. Clones get a new id and no deps (`cloneAt`).
- Note links are by title, case-insensitive (`resolve` in `wikilinks.ts`). Clicks
  go through `store.jump`, which App overrides to also centre the canvas.
- Tag mutations go through `store.addTag/removeTag/toggleTag` (shared by the panel
  and the context menu).
- macOS window uses `titleBarStyle: Overlay`; toolbar has 84px left padding for the
  traffic lights and `data-tauri-drag-region` (only elements carrying the attribute
  drag, not their children; needs `core:window:allow-start-dragging` in the
  capability, which the default set omits).
- Svelte a11y warnings on the canvas/markdown containers are intentionally
  silenced with `svelte-ignore`; keep `npm run check` clean rather than disabling globally.
- Lint conventions: `svelte/prefer-svelte-reactivity` is off (plain Set/Map are used
  for non-reactive scratch state on purpose); declare an `$effect` dependency you
  don't otherwise use with `void dep;`; `{@html}` is only ever DOMPurify output and
  carries an eslint-disable comment saying so. Clippy runs with `-D warnings`.

## Not done / ideas

- Fonts (Inter, Fira Code) are used only if installed locally; nothing is fetched.
