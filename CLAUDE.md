# Dagobert — notes for Claude

DAG-shaped note-taking/task app. Tauri 2 + Svelte 5 (runes) + Vite, no SvelteKit.
Keep it lightweight: avoid adding dependencies unless they clearly pay for themselves.

## Commands

```sh
npm run tauri dev          # desktop app (compiles Rust, opens window)
npm run dev                # UI only in a browser, in-memory backend
npm run check              # svelte-check (must be 0 errors / 0 warnings)
npm test                   # tests/*.test.mjs (pure TS modules) + cargo test
npm run format             # prettier (+svelte plugin) and cargo fmt; run before committing
npm run lint               # eslint (ts + svelte) and cargo clippy -D warnings; must be clean
npm run install:app        # release build → replace in /Applications → relaunch
npm run version -- X.Y.Z   # sync versions, roll CHANGELOG, commit + tag (push to main → release)
```

Verifying UI changes: `npm run dev`, open http://localhost:1420, click "Open a folder…"
(returns a mock project). The native window can't be screenshotted from the CLI.

## Working rules

- **Comments: as few as possible, 1 line max.**
- Every **user-facing change** gets a line in `CHANGELOG.md` under Unreleased. Keep the line short, and simple, without getting into details.
- Always commit, one commit per feature. A fix to the previous commit is amended, not
  added.
- **Every user-facing string lives in `src/lib/locales/en.ts`** (`t(key)`); shortcuts come
  from `keys.ts` and are never spelled out in strings.
- Icons are `phosphor-svelte`, imported per icon. No hand-drawn glyphs or unicode symbols.
- Lint: `svelte/prefer-svelte-reactivity` is off on purpose (plain Set/Map for scratch
  state); declare an `$effect` dependency you don't otherwise use with `void dep;`;
  `{@html}` is only ever DOMPurify output and carries an eslint-disable comment saying so.
  a11y warnings on the canvas/markdown containers are silenced with `svelte-ignore`, never
  globally.

## Layout

- `src-tauri/src/` — `store.rs` (all disk I/O), `watch.rs` (file watcher, desktop only),
  `state.rs` (managed state), `git.rs` / `merge.rs` / `sync.rs` (git tracking),
  `symbols.rs` (SF Symbols), `lib.rs` (commands).
- `src/lib/backend.ts` — wraps `invoke`; in-memory mock in the browser; `isMobile`.
- `src/lib/secrets.ts` — the GitHub API token and the git push/pull token.
- `src/lib/store.svelte.ts` — the single `store` instance: notes, viewport, selection,
  graph helpers (`wouldCycle`, `dependents`, `isReady`), debounced saves, undo, git slice.
- `src/lib/App.svelte` — shell, window keys, palette actions, panel sizes.
- `Canvas.svelte`, `NodeCard.svelte`, `Minimap.svelte`, `Grain.svelte` — the graph.
- `NotePanel.svelte`, `LiveEditor.svelte`, `blocks.ts`, `editor.ts`, `wikilinks.ts` —
  the editor.
- `github.ts`, `prs.svelte.ts`, `PullRequests.svelte` — GitHub integration.
- Pure modules with tests in `tests/`: `layout.ts`, `keys.ts`, `i18n.ts`, `highlight.ts`,
  `fuzzy.ts`, `history.ts`.

Details per area (read the one you're working in):

- [docs/storage-and-sync.md](docs/storage-and-sync.md) — on-disk format, file watcher,
  git primitives, merge rules, the sync cycle, quit handling.
- [docs/canvas.md](docs/canvas.md) — WebKit performance rules, navigation, multi-select,
  clipboard, layout, minimap, the WebGL grain layer.
- [docs/editor.md](docs/editor.md) — live-preview block editor, conflict blocks,
  wikilinks / mentions, rendering & highlighting, templates.
- [docs/github.md](docs/github.md) — repo aliases, PR cache, sidebar, icons.
- [docs/ui.md](docs/ui.md) — shortcuts & native menu, i18n, undo, multiple windows,
  dialogs/popovers, icons & assets, CI/release.
- [docs/mobile.md](docs/mobile.md) — the `isMobile` flag, `cfg(desktop)` gating, sandboxed
  projects, token credentials, the foreground/background lifecycle, touch, phone layout.

## Core conventions

- Graph direction: `note.deps` lists what the note depends on. Edges are drawn
  dependency → dependent ("this unlocks that"). Cycles are rejected in
  `store.addDependency`; pickers pre-filter with `wouldCycle`.
- Progress: a note has `workflow` (id, `null` = built-in Todo) and `status` (stage name).
  Done-ness is derived — `store.isDone(note)` checks whether the stage has `done: true` —
  never read a `done` field. Default-workflow notes show a checkbox; custom ones a status
  pill (click = `store.advance`, shift-click = back, wraps). Pill colour: `Stage.color`,
  else `stageColor`. Switching workflow maps done → first done stage, else first stage;
  editing a workflow repairs notes whose stage vanished (`updateWorkflow`); deleting one
  reverts its notes to Todo.
- Tracking issues (`note.tracking`, frontmatter `tracking: true`, omitted when false):
  `isDone` = all direct deps done (and at least one); `setDone` / `advance` are no-ops;
  never "ready". "Ready" = not done and every dep is done (purple ring, counted in toolbar).
- Tag colours are project-wide (`tag_colors` in `dagobert.json`); the default colour is
  not stored. Tag mutations go through `store.addTag/removeTag/toggleTag`.
- Empty notes (`store.isEmpty`) are hard-deleted via `store.discard` whenever deselected.
- Timestamps are ISO strings from the frontend; Rust treats them as opaque. Filenames
  derive from the title; the backend owns `note.file`.
- Git tracking is per project (`Meta.git`), off by default; only the main window syncs.
  Merge conflicts in bodies keep git's markers as content and are resolved in the editor.
- Multiple windows: `?note=<id>&path=<project>` renders a standalone `NotePanel`; every
  window has its own `store`, kept in sync via broadcast messages.
- Mobile (iOS): markup branches on `isMobile`, CSS on `body.mobile`; desktop-only Rust is
  `#[cfg(desktop)]` but its commands stay compiled with no-op bodies. See docs/mobile.md.
