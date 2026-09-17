# Dagobert — notes for Claude

DAG-shaped note-taking/task app. Tauri 2 + Svelte 5 (runes) + Vite, no SvelteKit.
Keep it lightweight: avoid adding dependencies unless they clearly pay for themselves.

## Commands

```sh
npm run tauri dev                              # desktop app (compiles Rust, opens window)
npm run dev                                    # UI only in a browser, in-memory backend
npm run check                                  # svelte-check (must be 0 errors / 0 warnings)
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
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
- `src/lib/wikilinks.ts` — `[[Title]]` links: `renderWikilinks` (pre-pass before
  marked, skips code; resolved → `<a class="wikilink" href="#note-<id>">`, missing →
  `.wikilink.missing`), `wikilinkTarget` for click handling, `mentions` (backlinks),
  `renameLinks` (rewrites bodies when a title is committed in the panel), and
  `caretCoords` (mirror-div caret measurement for the `@` popup). Test `blocks.ts`
  and `editor.ts` with a node script (`node file.mjs` importing the .ts works).
- `src/lib/MentionPopup.svelte` — the `@` autocomplete in `LiveEditor`; parent
  forwards keys via `handleKey`. Offers "Create …" when no title matches.
- `src/lib/InlineMd.svelte` — renders a title as inline markdown (`marked.parseInline`
  + DOMPurify). Used wherever a title is displayed (card, dep lists, picker, trash);
  the panel's title field stays a raw `<input>`.
- `src/lib/TrashDialog.svelte` — modal listing `trash/` with restore / delete forever / empty.
- `src/lib/LinkPicker.svelte` — search dropdown used for adding deps/dependents.
- `src/lib/workflows.ts` — `DEFAULT_WORKFLOW` (todo → done, id `""`, never stored)
  and `stageColor`. `WorkflowEditor.svelte` is the modal for managing custom workflows.
- `src/lib/tags.ts` — tag colour palette (site's code-hue colours; index 0 is the default).
- `src/lib/TagColorPicker.svelte` — swatch popover; `TagMenu.svelte` — toolbar
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
  custom ones show a status pill (click = `store.advance`, wraps around). Switching
  workflow maps done → first done stage, else first stage. Editing a workflow repairs
  notes whose stage vanished (`updateWorkflow`); deleting one reverts its notes to Todo.
- Templates: `Workflow.template` and `Meta.default_template` (for Todo), edited in
  `WorkflowEditor`. `store.create` fills `body` from `templateFor(workflow)` via
  `renderTemplate` only when `init.body` is undefined (clones/pastes pass a body).
  `isEmpty` treats a body equal to its template as blank so accidental notes are still
  discarded; `setWorkflow` swaps in the new template only when the body is blank by
  that definition.
- "Ready" = not done and every dep is done. Shown with a purple ring; counted in toolbar.
- Canvas dimming: `App.svelte` computes `matches` = search terms AND tag filter
  (tag filter is OR across selected tags); `null` means nothing is filtered.
- Tag colours are project-wide (`tag_colors` in `dagobert.json`), not per note.
  The default colour is not stored (`setTagColor` deletes the entry).
- Timestamps are ISO strings generated in the frontend; Rust treats them as opaque.
- Filenames derive from the title (`slugify` in `store.rs`); collisions get `-<id>`.
  The backend owns `note.file` — the frontend never sets it.
- Wheel: plain scroll pans, `ctrl`/`meta`+wheel (pinch) zooms. Wheel listener is
  attached manually with `passive: false`.
- Keyboard: `⌘N` new note, `⌘F` search, `⌘O` open folder, `Esc` deselect,
  `⌫` removes a selected edge. Global handlers ignore events from inputs/textareas.
  In the body editor: `⌘B` bold, `⌘I` italic, `⌘E`/`` ⌘` `` code, `⌘K` link,
  `⌘⇧X` strike, `⌘H` ==highlight==, Enter continues lists, Tab/⇧Tab indents.
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

- No multi-select, undo, or auto-layout.
- Fonts (Inter, Fira Code) are used only if installed locally; nothing is fetched.
