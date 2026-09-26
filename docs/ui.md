# App shell, UI components and infrastructure

Read this when touching `App.svelte`, `menu.ts`, `keys.ts`,
`i18n.ts`, `history.ts`, `updater.svelte.ts`, multi-window code, the smaller
dialogs/popovers, icons, or CI/release.

## Shortcuts and menu

- `keys.ts` — every shortcut in display form (`keys["new-note"]` = `⌘N`). `matches(hint, e)`
  checks a `KeyboardEvent` (`⌘` also accepts Ctrl); the window handler (`WINDOW_KEYS` in
  `App.svelte`, main window only), `Canvas` and `editor.ts` all go through it, and
  `menu.ts` derives accelerators from the same hints, so rebinding means changing one
  entry. `Canvas`'s and `NotePanel`'s key handlers skip text fields; the window handler
  doesn't, so its shortcuts work while typing. `onEscape` is the shared Escape-to-close for
  dialogs. Test: `tests/keys.test.mjs`.
- `menu.ts` — builds the native app menu from `paletteActions` in `App.svelte` (each
  `Action` has `id`, `menu` section, optional `menuLabel`, `hint` → accelerator,
  `enabled`). Rebuilt only when `menuSignature` or the appearance changes; menu closures
  must read live state (`store.selected`) rather than captured values. A menu accelerator
  and the window `keydown` handler can both fire for one key, so actions run through
  `once(id, fn)` (150 ms dedupe) and `store.undo/redo` dedupe themselves. The Edit menu
  keeps the native Cut/Copy/Paste/SelectAll items; menu Undo/Redo call `execCommand`
  inside text fields and the store elsewhere.
- Menu bar icons are SF Symbols: `Action.symbol` lists candidate names; the Rust
  `sf_symbol` command (`symbols.rs`, objc2-app-kit) renders the first that exists to PNG,
  and `sfsymbol.ts` centres/tints it on a canvas for the current appearance. Phosphor
  icons are only used in-app, in the `regular`, `bold` and `fill` weights: the
  `phosphor-weights` plugin in `vite.config.js` strips the others from each icon (add a
  weight there before using it).

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
debounced save); other messages are `note-file`, `note-removed` and `meta`.
`store.applySync` applies them as-is — the latest message wins — ignoring notes this window
deleted. Capability `windows` includes `note-*`. The last-opened project is in
localStorage and reopened on startup (`store.restore`).

macOS window uses `titleBarStyle: Overlay`; the toolbar has 84px left padding for the
traffic lights and `data-tauri-drag-region` (only elements carrying the attribute drag,
not their children; needs `core:window:allow-start-dragging` in the capability).

## Dialogs and popovers

- `QuickOpen.svelte` — `mode: "notes"` (`quick-open`) or `"commands"` (`commands`); App
  owns `showQuickOpen`; not in standalone windows. Matching lives in `fuzzy.ts`
  (`fuzzyMatch`: prefix > word-start > substring > subsequence; `parseQuery`: a leading
  `#tag` filters notes). Commands come from App's `paletteActions` prop so the palette
  stays dumb.
- `WorkflowEditor.svelte` — settings dialog; `section` picks "workflows", "tracking",
  "github" or "git". `workflows.ts` has `DEFAULT_WORKFLOW` (todo → done, id `""`, never
  stored, name from the locale) and `stageColor`.
- `TrashDialog.svelte` — lists `trash/` with restore / reveal file / delete forever /
  empty. `GitDialog.svelte` — see [storage-and-sync.md](storage-and-sync.md).
- `ColorPicker.svelte` — shared swatch popover (tag and stage colours; `allowAuto` adds an
  "Automatic" swatch). `tags.ts` holds the built-in palette (index 0 is the default) and
  `normalizeColor`; users extend it with `Meta.palette` (`store.palette`,
  `addPaletteColor` / `removePaletteColor`): the "+" swatch opens a hidden native
  `<input type="color">` (live preview on `input`, added and picked on `change`); custom
  swatches are removed by right-click. `TagColorPicker.svelte` wraps it; `TagMenu.svelte`
  is the toolbar popover listing all tags (click name = toggle filter, click dot =
  recolour).
- `tooltip.ts` — `use:tooltip={"text"}`: an instant tooltip (one shared `.tooltip` element
  on `<body>`). Also takes `{ html }` (must be DOMPurify output, e.g. `inlineHtml`) or a
  function evaluated per hover. Prefer it over `title` on icon-only controls.
- Shared styles live in `app.css`; reuse them instead of restyling: `.backdrop` + `.dialog`
  (`.dialog.bare` full-screen), `.popover`, `button.icon`, `button.link` (acts elsewhere),
  `button.swatch`, `.tag-chip` (set `--tag`), `.checkbox`, `@keyframes spin`. Chrome is
  `user-select: none` (buttons globally, containers per component); inputs, textareas and
  contenteditable re-enable it.

## Icons and assets

`icons.ts` `ICON` is the in-app icon size (larger on a phone). `assets/` holds the source
SVGs: `logo.svg` (rounded background; the app icon) and `icon.svg` (transparent glyph).
Regenerate `src-tauri/icons/` with `npm run tauri icon assets/logo.svg` (then delete the
android folder it adds; `ios/` is used, see [mobile.md](mobile.md)). `public/` holds
copies served by Vite for the favicon, toolbar and welcome screen. `app.css` has the theme
tokens (dark only) and `.markdown` styles. Fonts (Inter, Fira Code) are used only if
installed locally; nothing is fetched.

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
`request_restart`, whose `ExitRequested` skips the git quit hold. `updater.svelte.ts`
checks a minute after launch and every 6 h from the main window; when one is ready the toolbar shows
"Restart to update" and the app-menu item switches to it. Installing runs
`store.suspend()` (flush + sync) first.
