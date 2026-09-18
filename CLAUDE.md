# Dagobert — notes for Claude

DAG-shaped note-taking/task app. Tauri 2 + Svelte 5 (runes) + Vite, no SvelteKit.
Keep it lightweight: avoid adding dependencies unless they clearly pay for themselves.

## Commands

```sh
npm run tauri dev                              # desktop app (compiles Rust, opens window)
npm run dev                                    # UI only in a browser, in-memory backend
npm run check                                  # svelte-check (must be 0 errors / 0 warnings)
npm test                                       # tests/*.test.mjs (pure TS modules) + cargo test
npm run tauri build
npm run install:app                            # release build → quit running app → replace in /Applications → relaunch
npm run version -- X.Y.Z                       # sync versions, roll CHANGELOG, commit + tag
```

Verifying UI changes: `npm run dev`, open http://localhost:1420 in a browser, click
"Open a folder…" (returns a mock project). The native window can't be screenshotted
from the CLI, so the browser shim is the practical way to check interactions.

## Layout

- `src-tauri/src/store.rs` — all disk I/O. Project = folder; `notes/<slug>.md` per
  note (YAML frontmatter + markdown body); `dagobert.json` holds `Meta`
  (viewport, `tag_colors`, `workflows`). A legacy `done: true` in frontmatter is
  migrated to `status: done` on read and never written back. Deletes are soft:
  `delete_note` moves the file to `trash/` (stamping `deleted`), never overwriting
  (`free_name` adds `-<id>[-n]` suffixes); `list_trash`/`restore_note`/`purge_trash`
  round it out. Commands: `open_project`, `save_note`, `delete_note`, `list_trash`,
  `restore_note`, `purge_trash`, `save_meta`. Has round-trip tests. `lib.rs` just exposes these commands.

- `src-tauri/src/watch.rs` — file watcher (`notify` + `notify-debouncer-mini`, 300 ms).
  `watch_project`/`unwatch_project` commands; emits `project-changed` events
  (`{kind: "note", note} | {kind: "note-removed", file} | {kind: "meta"}`). `AppState`
  (Tauri managed state) holds the watcher and `Recent`: every writing command marks the
  path it touched, and events for paths marked < 1 s ago are dropped so our own saves
  don't echo. The frontend applies events in `store.applyExternal` (matching notes by
  id, so external renames just update `file`; a pending local save wins over disk).
- `src/lib/backend.ts` — wraps `invoke`; falls back to an in-memory mock when
  `window.__TAURI_INTERNALS__` is absent. All Tauri calls go through here, including
  cross-window sync (`broadcast`/`subscribe`: Tauri events, BroadcastChannel in the
  browser) and `openNoteWindow` (a `note-<id>` WebviewWindow loading
  `index.html?note=<id>&path=<project>`).
- `src/lib/store.svelte.ts` — single `store` instance (class with `$state` fields):
  notes, viewport, tag colours/filter, selection, recent folders, graph helpers
  (`wouldCycle`, `dependents`, `isReady`), debounced saves (`touch`/`save`, 500 ms;
  `immediate` for structural changes; `silent` to skip bumping `modified`;
  `saveMeta` for viewport/tag colours). Last-opened path is in localStorage and
  restored on startup (`restore`). Writes are serialised per note (`#inflight`) and
  `remove` awaits them before trashing; `#deleted` stops late writes resurrecting a
  note. Trash state: `trash`, `loadTrash`, `restoreNote`, `purge`.
- `src/lib/Canvas.svelte` — pan/zoom/drag/link interactions and edge rendering.
  Exposes `focusNode`, `createAtCenter`, `fitAll` via `bind:this`.
- `src/lib/layout.ts` — pure layered layout (`layout(nodes, opts)`): longest-path
  layering, barycenter ordering sweeps, columns centred on the tallest, components
  stacked vertically (largest first). `Canvas.tidy()` applies it (selection-only
  when `store.multi.length > 1`, anchored at the selection's top-left). Test:
  `node tests/layout.test.mjs`.
- `src/lib/Minimap.svelte` — bottom-right overview (180×120). Bounds = all notes ∪
  the viewport, padded, so the view box always stays inside the map. Click/drag
  pans (stopPropagation keeps the canvas from panning too). Collapsed state in
  localStorage `dagobert.minimap`. Hidden when fewer than 2 notes.
- `src/lib/NodeCard.svelte` — a node. Reports its height via `onresize` so edges
  can anchor at mid-height (don't use `bind:` with a fallback — Svelte 5 throws).
- `src/lib/NotePanel.svelte` — right-hand editor. Re-keyed per note id in `App.svelte`
  so local state resets on selection change. The body is edited by `LiveEditor`.
- `src/lib/LiveEditor.svelte` — Obsidian-style live preview, per block. `blocks.ts`
  splits the body on blank lines (fenced code kept whole; blank-line runs collapse on
  re-join). Every block renders via `Markdown.svelte` except the `active` one, which
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
  (class `.ghref`), so the raw markdown stays plain.
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
- `src/lib/InlineMd.svelte` — renders a title as inline markdown (`marked.parseInline`
  + DOMPurify). Used wherever a title is displayed (card, dep lists, picker, trash);
  the panel's title field stays a raw `<input>`.
- `src/lib/QuickOpen.svelte` — `⌘K` (`⇧⌘K` = command mode) palette (App owns `showQuickOpen`; not in
  standalone windows). Matching lives in `fuzzy.ts` (`fuzzyMatch`: prefix > word-start
  > substring > subsequence; `parseQuery`: `#tag` filter, `>` command mode). Commands
  come from App's `paletteActions` prop so the palette stays dumb.
- `src/lib/TrashDialog.svelte` — modal listing `trash/` with restore / delete forever / empty.
- `src/lib/LinkPicker.svelte` — search dropdown used for adding deps/dependents.
- `src/lib/workflows.ts` — `DEFAULT_WORKFLOW` (todo → done, id `""`, never stored)
  and `stageColor`. `WorkflowEditor.svelte` is the modal for managing custom workflows.
- `src/lib/tags.ts` — tag colour palette (site's code-hue colours; index 0 is the default).
- `src/lib/WorkflowEditor.svelte` doubles as the settings dialog: `section` prop
  picks "workflows" or "github".
- `src/lib/ColorPicker.svelte` — shared swatch popover (tag colours and workflow
  stage colours; `allowAuto` adds a "clear" swatch). `TagColorPicker.svelte` wraps it; `TagMenu.svelte` — toolbar
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

## Conventions & decisions

- Graph direction: `note.deps` lists what the note depends on. Edges/arrows are
  drawn dependency → dependent ("this unlocks that"). Dragging from a node's
  right-hand port onto another node makes the *target* depend on the *source*.
- Cycles are rejected in `store.addDependency`; pickers pre-filter with `wouldCycle`.
- Progress: a note has `workflow` (id, `null` = built-in Todo) and `status` (stage
  name). Done-ness is derived — `store.isDone(note)` checks whether the current stage
  has `done: true` — never read a `done` field. Default-workflow notes show a checkbox;
  custom ones show a status pill (click = `store.advance`, wraps around). Pill colour:
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
- Timestamps are ISO strings generated in the frontend; Rust treats them as opaque.
- Filenames derive from the title (`slugify` in `store.rs`); collisions get `-<id>`.
  The backend owns `note.file` — the frontend never sets it.
- Wheel: plain scroll pans, `ctrl`/`meta`+wheel (pinch) zooms. Wheel listener is
  attached manually with `passive: false`.
- Keyboard: `⌘N` new note, `⌘K` quick open, `⌘F` search, `⌘O` open folder, `Esc` deselect,
  `⌫` removes a selected edge. Global handlers ignore events from inputs/textareas.
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
  traffic lights and `data-tauri-drag-region`.
- Svelte a11y warnings on the canvas/markdown containers are intentionally
  silenced with `svelte-ignore`; keep `npm run check` clean rather than disabling globally.

## Not done / ideas

- Fonts (Inter, Fira Code) are used only if installed locally; nothing is fetched.
