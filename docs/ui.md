# App shell, UI components and infrastructure

Read this when touching `App.svelte`, `menu.ts`, `keys.ts`,
`i18n.ts`, `history.ts`, `updater.svelte.ts`, multi-window code, the smaller
dialogs/popovers, icons, or CI/release.

## Shortcuts and menu

- `keys.ts` — every shortcut in display form (`keys["new-note"]` = `⌘N`). purr's
  `matches(hint, e)` checks a `KeyboardEvent` (`⌘` also accepts Ctrl); the window handler
  (`WINDOW_KEYS` in `App.svelte`, main window only), `Canvas` and `LiveEditor` all go through
  it, and `menu.ts` derives accelerators from the same hints (purr's `accelerator`), so
  rebinding means changing one entry. `Canvas`'s and `NotePanel`'s key handlers skip text
  fields, and `Canvas` leaves plain keys to an open menu or dialog (`hasOverlay`); the window
  handler doesn't, so its shortcuts work while typing. Escape and a click outside close
  overlays through purr's `registerOverlay`, topmost first; `Kbd` and tooltip `hint`s render
  the hints.
- `menu.ts` — builds the native app menu from `paletteActions` in `App.svelte` (each
  `Action` has `id`, `menu` section, optional `menuLabel`, `hint` → accelerator,
  `enabled`). Updated only when `menuSignature` or the appearance changes: when just
  labels or enabled flags differ the live items are patched (`setText` / `setEnabled`),
  otherwise it's rebuilt and the old menu's native resources are closed. Items run the
  latest action with their id, and closures must read live state (`store.selected`)
  rather than captured values. A menu accelerator
  and the window `keydown` handler can both fire for one key, so actions run through
  `once(id, fn)` (150 ms dedupe) and `store.undo/redo` dedupe themselves. The Edit menu
  keeps the native Cut/Copy/Paste/SelectAll items; menu Undo/Redo call `execCommand`
  inside text fields and the store elsewhere.
- Menu bar icons are SF Symbols: `Action.symbol` lists candidate names; the Rust
  `sf_symbol` command (`symbols.rs`, objc2-app-kit) renders the first that exists to PNG,
  and `sfsymbol.ts` centres/tints it on a canvas for the current appearance. Phosphor
  icons (`purr/icons`) are only used in-app, in the `regular`, `bold` and `fill` weights:
  the `purr()` plugin in `vite.config.js` strips the others from each icon (pass `weights`
  to it before using another).

## i18n

`t(key, vars)` fills `{name}` placeholders; `plural(key, n)` picks `key.one` / `key.other`
via `Intl.PluralRules` and fills `{n}`. Keys are typed (`Key`), so a typo fails
`npm run check`; undo labels passed to `touch` are `HistoryLabel`, the suffix of a
`history.*` key. Strings with inline markdown (tagged `// markdown` in `en.ts`) render
through `InlineMd`. `tests/i18n.test.mjs` fails on a catalogue key nothing uses (a
`history.*` key counts as used via its suffix), a `.one` without `.other`, or a spelled-out
shortcut. Rust error messages reach toasts untranslated. No locale switching yet.

## Undo (`history.ts`)

Pure undo stack (`History`, `NoteDiff`, `sameNote`; capped at 200). Every `touch` /
`create` / `remove` / `restoreNote` calls `#record`, which batches all diffs recorded in
the same microtask into one entry (a loop over a group is one undo step) and keeps `#last`
(per-note baseline snapshot) current. Consecutive typing (title/body only) on one note
within 1.5 s merges into the previous entry. `#apply` replays `before` / `after`: deleted
notes come back via their `trashFile` (recreated from the snapshot if the trash was
emptied); notes that must vanish go through `remove()`. `#applying` suppresses recording
during replay; `applySync` / `applyExternal` update `#last` without recording.
`modified` / `file` changes never count as edits (`sameNote`). The entry's label
(`touch`'s `label`, default `edit`) becomes the "Undid: …" toast.

## Multiple windows

`backend.ts` routes cross-window sync too (`broadcast` / `subscribe`: Tauri events,
BroadcastChannel in the browser) and `openNoteWindow` (a `note-<id>` WebviewWindow,
focused if it already exists; `window.open` in the browser). A standalone window renders
just `NotePanel` (`standalone` prop) full-window, sets `store.syncs = false` and skips the
menu, window shortcuts and updater. `touch` broadcasts the note immediately (not after the
debounced save); other messages are `note-file`, `note-removed` and `meta`. In Tauri a message
is only emitted when another window is open (`peers`, recounted on a `dagobert-hello`
from each new window and at most every 5 s while broadcasting), so typing in a single
window doesn't round-trip every edit through Rust.
`store.applySync` applies them as-is — the latest message wins — ignoring notes this window
deleted. Capability `windows` includes `note-*`. The last-opened project is in
localStorage and reopened on startup (`store.restore`).

macOS window uses `titleBarStyle: Overlay`; the toolbar has 84px left padding for the
traffic lights and `data-tauri-drag-region` (only elements carrying the attribute drag,
not their children; needs `core:window:allow-start-dragging` in the capability).

## Panels

Note, pull requests, trash, settings, the media gallery and the calendar are **panes** (`Pane` in `tiles.ts`), and every one
lives in the same container: `Dock.svelte` on the desktop, purr's `Sheet` on a phone. A
component renders only its content (a `.pane` with purr's `PanelHeader`); App's `pane`
snippet picks it, so the same markup goes into either container. `isOpen` / `close` in
`App.svelte` map each pane to its state (`store.selected`, `showPRs`, …).

On the desktop the canvas and the panes are **tiled**, as in Zed: `Layout.tree` is a tree of
row / column splits whose leaves are the canvas and the panes, each `size` a weight against
its siblings; `Layout.popups` holds the panes shown as a centred modal instead (Escape closes
the topmost). `panes.svelte.ts` keeps it in localStorage. Closed panes stay in the tree:
`visible` prunes them and folds a split left with one tile, so a pane reopens where it was.
`arrange` turns the visible tree into rects (1px gaps show `.main`'s border colour as the
dividers, and no tile is laid out below `MIN`) and the dividers, which `resize` drags.

`Tiles.svelte` owns `.main`: the canvas and every open `Dock` are absolutely positioned
siblings, so moving a pane (or popping it up) never remounts it or the canvas. A pane is
dragged by its header (not its controls) or by `DockButton` in it, which also opens the menu
of the layout's four edges and "Pop up". `dropAt` resolves the pointer to a side of the
tile under it, a side of the whole layout within 24px of its edge, or a popup from the
middle of the canvas; `place` detaches the pane and splits there. When the canvas's corner
moves for any reason but a pane moving, `onshift` shifts the viewport so the graph stays put.
`DockButton` finds its `Dock` through context and renders nothing outside `Tiles` (in a
sheet, or the settings popup of a standalone window).

To add a pane: extend `Pane`, `DEFAULT_LAYOUT` (`repair` adds it to a stored layout as a
closed popup) and `POPUP`, the `LABEL` in `Dock.svelte`, the `pane` snippet, `isOpen` / `close` and `mobilePanel`, and put `<DockButton />`
beside its close button.

## Media gallery

`Gallery.svelte` lists `store.assets` (`list_assets`, newest first; loaded when the pane
opens, reloaded on the watcher's `assets` event, after adding media and on a phone after a
pull). Which notes use a file comes from `store.assetInfo` (per note, bodies are rescanned
only when they change), so it follows edits live; the trash's bodies (`loadTrash`) mark
"In trash". A file neither uses is "Unused" and can be deleted (`delete_asset`, two presses),
or all of them from the footer; unlike emptying the trash this ignores the undo history.
Filter chips, a search over file names, alt texts and note titles, a large view (purr's
`Lightbox`: ← → step through, Escape or a click outside closes it; reveal in Finder). A tile
dragged out (pointer events, since Tauri keeps HTML5 drags for files) dispatches `media-drop`
with its embed at the element under the pointer, looking through a popped-up pane's `.scrim`.

## Calendar

`Calendar.svelte` is a pane (popup by default) with a month view (purr's `MonthScroller`: weeks
in one scroll that snaps to each month, `year`/`month` bound to the title, filled through its
`day` / `actions` snippets) and an agenda (overdue, then each day from today); the
view and "show done" are remembered per machine, and a phone starts on the agenda. Due-date
maths is `calendar.ts` (pure, tested, so it keeps its own few day-key helpers rather than
importing purr's): `parseDue` / `joinDue`, `dueState`, `groupByDay`, `isLater` (the note panel
warns about dependencies due after the note, `store.lateDeps`). Labels (`Tomorrow`, `Friday`,
`Thu, Oct 15`) are purr's `formatDay` with our strings, via `formatDay` / `formatDue` in
`time.ts`. A chip dragged onto another day (`data-day`, which `MonthScroller` puts on each) keeps
its time (`moveDue`); the `+` on a day creates a note due then.
Due dates are set in the note panel (a calendar button beside the workflow's gear; once set, the
day and a clock open purr's `DatePicker` / `TimePicker` in a popover), from the
canvas menu's "Due date" submenu, or the palette's "Make due today"; all go through
`store.setDue` (undoable).

## Dialogs and popovers

- Anything shown only on demand (QuickOpen, WorkflowEditor, PullRequests, TrashDialog,
  GitDialog, CloneDialog) is mounted through `{#await import(…) then m}<m.default …/>`,
  so it's a separate chunk that launch doesn't load; add new dialogs the same way.
- `QuickOpen.svelte` — purr's `CommandPalette` in `mode: "notes"` (`quick-open`) or
  `"commands"` (`commands`); App owns `showQuickOpen`; not in standalone windows. Ranking is
  purr's `rank` (exact > prefix > word start > substring > subsequence, the same in the mention
  and link pickers); `query.ts`'s `parseQuery` makes a leading `#tag` filter notes. Commands
  come from App's `paletteActions` (`Action`, in `menu.ts`) so the palette stays dumb.
- `ContextMenu.svelte` — the canvas's menu: builds purr menu entries for a note, a
  selection, a link or the background and opens them with `menu.showAt`; purr's
  `ContextMenuHost` in `App.svelte` renders it (an action sheet on a phone). The entries are
  a builder re-read while it is open, so kept-open tag toggles show their new state.
- `WorkflowEditor.svelte` — the settings pane; `section` picks "workflows", "tracking",
  "github" or "git". `workflows.ts` has `DEFAULT_WORKFLOW` (todo → done, id `""`, never
  stored, name from the locale) and `stageColor`.
- `TrashDialog.svelte` — the trash pane; lists `trash/` with restore / reveal file / delete forever /
  empty. `GitDialog.svelte` — see [storage-and-sync.md](storage-and-sync.md).
- `ColorPicker.svelte` — shared swatch popover, purr's `ColorGrid` in a `Popover` hung off
  the swatch that opened it (tag and stage colours; `allowAuto` adds an "Automatic" swatch). `tags.ts` holds the built-in palette (index 0 is the default) and
  `normalizeColor`; users extend it with `Meta.palette` (`store.palette`,
  `addPaletteColor` / `removePaletteColor`): the "+" swatch opens a hidden native
  `<input type="color">` (live preview on `input`, added and picked on `change`); custom
  swatches are removed by right-click. `TagColorPicker.svelte` wraps it; `TagMenu.svelte`
  is the toolbar popover listing all tags (click name = toggle filter, click dot =
  recolour).
- purr's `tooltip` action — `use:tooltip={"text"}`: an instant tooltip. Also takes
  `{ text, hint }`, `{ html }` (must be DOMPurify output, e.g. `inlineHtml`) or a function
  evaluated per hover. `IconButton` shows its label as one.
- Bare `button` / `input` / `select` are unstyled (purr's reset). Use purr's classes and
  components instead of restyling: `.btn` (`--primary`, `--ghost`, `--danger`, `--link`,
  `--icon`, `--sm`, `--lg`) or `Button` / `IconButton`, `.field-input`, `.row-item`,
  `.surface`, `.tag` (set `--tag`) or `Tag`, `.checkbox`, `.swatch`, `.spin`; `Modal` for
  dialogs (`GitDialog`, `CloneDialog`), `Popover`, `ConfirmButton` for two-press deletes,
  `toast()` for notices. `app.css` holds only what is Dagobert's (`.pane`, wikilinks, repo
  refs, media in `.md`, the phone overrides).

## Icons and assets

Icons take their size from the button they sit in (purr's `--icon-*`, larger on a phone). `assets/` holds the source
SVGs: `logo.svg` (the app icon) and `icon.svg` (the glyph alone, for the toolbar). Both come
from purr's family icons, where Dagobert's glyph lives (`src/app-icons/dagobert.svg`). With
the renderer added for the session (`npm i --no-save @resvg/resvg-js`), `npx purr-icon dagobert --out src-tauri/icons --mark "#c264cf"` writes the icon, its 1024
`source.png` and `mark.svg`; `npx tauri icon src-tauri/icons/source.png -o src-tauri/icons`
makes every size (it writes the iOS ones into `gen/apple`; copy them to `icons/ios/`, delete
the android folder it adds, see [mobile.md](mobile.md)); then copy `icon.svg` to `logo.svg`
and `mark.svg` to `icon.svg` here and in `public/`, and delete the three generated files. `public/` holds
copies served by Vite for the favicon, toolbar and welcome screen. The theme tokens are
purr's (`main.ts` applies its dark theme; `app.css` only sets the 14px `--font-size` and the
toolbar's sizes); rendered markdown is purr's `.md`. Fonts (Inter Variable, Fira Code) are
bundled by `purr/fonts.css`; nothing is fetched.

## CI and releases

`.github/workflows/ci.yml` runs format:check, lint, check, test, the Vite build and an iOS
clippy check on every PR and on main (concurrency-cancelled per ref, macOS runner because
the Rust tests link AppKit). `release.yml` runs on main when version files or the
CHANGELOG change: if no GitHub release exists for `package.json`'s version, a first job
creates one with that version's CHANGELOG section as notes, then `tauri-action` builds the
Apple Silicon `.app` + DMG and uploads it with the updater artifacts. Builds are not
code-signed.

## Updates

`tauri-plugin-updater` (desktop only) reads `latest.json` from the latest GitHub release.
CI signs the updater archive with the `TAURI_SIGNING_PRIVATE_KEY` secret (minisign key, no
password; public half in `tauri.conf.json`) and `tauri.updater.conf.json` turns on
`createUpdaterArtifacts` there only, so local builds need no key. Losing the key means
shipping a new pubkey, which installed copies won't accept: they'd need a manual reinstall.
`update.rs` checks and downloads (skipped in debug builds, which would replace themselves
with the release) and keeps the archive in the app cache dir (not in memory) until
`update_install` installs and calls
`request_restart`, whose `ExitRequested` skips the git quit hold. `updater.svelte.ts` is
purr's `createUpdater` over those two commands: it checks a minute after launch and every 6 h
from the main window; when one is ready the toolbar shows
"Restart to update" and the app-menu item switches to it. Installing runs
`store.suspend()` (flush + sync) first.
