# App shell, UI components and infrastructure

Read this when touching `App.svelte`, `menu.ts`, `keys.ts`, `i18n.ts`, `history.ts`,
multi-window code, the smaller dialogs/popovers, icons, or CI/release.

## Shortcuts and menu

- `keys.ts` — every shortcut in display form (`keys["new-note"]` = `⌘N`); locale strings
  take a placeholder for them, never spell them out (the i18n test enforces it).
  `matches(hint, e)` checks a `KeyboardEvent`; the window handler (`WINDOW_KEYS` in
  `App.svelte`), `Canvas` and `editor.ts` all go through it, and `menu.ts` derives
  accelerators from the same hints, so rebinding means changing one entry. Test:
  `tests/keys.test.mjs`. Global handlers ignore events from inputs/textareas.
- `menu.ts` — builds the native app menu from `paletteActions` in `App.svelte` (each
  `Action` has `id`, `menu` section, optional `menuLabel`, `hint` → accelerator). Rebuilt
  only when `menuSignature` changes; menu closures must read live state
  (`store.selected`) rather than captured values. A menu accelerator and the window
  `keydown` handler can both fire for one key, so actions run through `once(id, fn)`
  (150 ms dedupe) and `store.undo/redo` dedupe themselves. The Edit menu keeps the native
  Cut/Copy/Paste/SelectAll items; menu Undo/Redo call `execCommand` inside text fields and
  the store elsewhere.
- Menu bar icons are SF Symbols: `Action.symbol` lists candidate names; the Rust
  `sf_symbol` command (`symbols.rs`, objc2-app-kit) renders the first that exists to PNG,
  and `sfsymbol.ts` centres/tints it on a canvas for the current appearance (menu rebuilt
  when appearance flips). Phosphor icons are only used in-app.

## i18n

`i18n.ts` + `locales/en.ts` hold every user-facing string. `t(key, vars)` fills `{name}`
placeholders; `plural(key, n)` picks `key.one` / `key.other` via `Intl.PluralRules`. Keys
are typed (`Key`), so a typo fails `npm run check`; the undo-history labels passed to
`touch` are `HistoryLabel` = `history.*` keys. Strings with inline markdown (help
paragraphs, marked "markdown" in the catalogue) render through `InlineMd`.
`tests/i18n.test.mjs` fails on any catalogue key nothing uses. Rust error messages reach
toasts untranslated. No locale switching yet.

## Undo (`history.ts`)

Pure undo stack (`History`, `NoteDiff`, `sameNote`). Every `touch` / `create` / `remove` /
`restoreNote` calls `#record`, which batches all diffs recorded in the same microtask into
one entry (a loop over a group is one undo step) and keeps `#last` (per-note baseline
snapshot) current. `#apply` replays `before` / `after`: deleted notes come back via their
`trashFile` (recreated from the snapshot if the trash was emptied); notes that must vanish
go through `remove()`. `#applying` suppresses recording during replay; `applySync` /
`applyExternal` update `#last` without recording. `modified` / `file` changes never count
as edits (`sameNote`). Pass `label` to `touch` for a readable "Undid: …" toast
(`store.notice`).

## Multiple windows

`backend.ts` wraps `invoke` and falls back to an in-memory mock when
`window.__TAURI_INTERNALS__` is absent; all Tauri calls go through it, including
cross-window sync (`broadcast` / `subscribe`: Tauri events, BroadcastChannel in the
browser) and `openNoteWindow` (a `note-<id>` WebviewWindow loading
`index.html?note=<id>&path=<project>`). `App.svelte` reads `?note=` / `?path=` and renders
just `NotePanel` (`standalone` prop) full-window. Every window has its own `store`; writes
broadcast `note` / `note-removed` / `meta` messages and `store.applySync` applies them
(skipping notes with a pending local save). Capability `windows` includes `note-*`.
Last-opened path is in localStorage and restored on startup (`restore`).

macOS window uses `titleBarStyle: Overlay`; the toolbar has 84px left padding for the
traffic lights and `data-tauri-drag-region` (only elements carrying the attribute drag,
not their children; needs `core:window:allow-start-dragging` in the capability).

## Dialogs and popovers

- `QuickOpen.svelte` — `⌘K` palette, `mode: "notes" | "commands"` (`⇧⌘K`); App owns
  `showQuickOpen`; not in standalone windows. Matching lives in `fuzzy.ts` (`fuzzyMatch`:
  prefix > word-start > substring > subsequence; `parseQuery`: `#tag` filter, `>` command
  mode). Commands come from App's `paletteActions` prop so the palette stays dumb.
- `WorkflowEditor.svelte` — settings dialog; `section` picks "workflows", "github" or
  "git". `workflows.ts` has `DEFAULT_WORKFLOW` (todo → done, id `""`, never stored) and
  `stageColor`.
- `TrashDialog.svelte` — modal listing `trash/` with restore / delete forever / empty.
- `GitDialog.svelte` — no-repo prompt and post-merge conflict list.
- `ColorPicker.svelte` — shared swatch popover (tag and stage colours; `allowAuto` adds an
  "Automatic" swatch: dashed ring + lightning bolt). `tags.ts` holds the built-in palette
  (index 0 is the default) and `normalizeColor`; users extend it with `Meta.palette`
  (`store.palette`, `addPaletteColor` / `removePaletteColor`): the "+" swatch opens a hidden
  native `<input type="color">` (live preview on `input`, added and picked on `change`);
  custom swatches are removed by right-click. `TagColorPicker.svelte` wraps it;
  `TagMenu.svelte` is the toolbar popover listing all tags (click name = toggle filter,
  click dot = recolour). Tag chips share the global `.tag-chip` class with `--tag` set.
- `tooltip.ts` — `use:tooltip={"text"}`: an instant tooltip (one shared `.tooltip` element
  on `<body>`, styled in `app.css`). Also takes `{ html }` (must be DOMPurify output, e.g.
  `inlineHtml` from `inline.ts`) or a function evaluated per hover. Prefer it over `title`
  on icon-only controls.
- `ProgressRing.svelte` is fed by `store.progress(note)` for tracking issues.

## Icons and assets

Icons are `phosphor-svelte` (https://phosphoricons.com), imported per icon as
`import X from "phosphor-svelte/lib/X"`. No hand-drawn glyphs or unicode symbols for UI
icons. `assets/` holds the source SVGs: `logo.svg` (rounded background; the app icon) and
`icon.svg` (transparent glyph). Regenerate `src-tauri/icons/` with
`npm run tauri icon assets/logo.svg` (then delete the android/ios folders it adds).
`public/` holds copies served by Vite for the favicon, toolbar and welcome screen.
`app.css` has the theme tokens (from n1ark.com's dark mode) and `.markdown` styles. Fonts
(Inter, Fira Code) are used only if installed locally; nothing is fetched.

## CI and releases

`.github/workflows/ci.yml` runs format:check, lint, check, test and the Vite build on
every PR and on main (concurrency-cancelled per ref, macOS runner because of AppKit).
`release.yml` runs on main when version files change: if no GitHub release exists for
`package.json`'s version it builds DMGs (arm64 + x86_64) with `tauri-action` and publishes
one, using that version's CHANGELOG section as notes. Builds are unsigned.

## Updates

`tauri-plugin-updater` (desktop only) reads `latest.json` from the latest GitHub release.
CI signs the updater archive with the `TAURI_SIGNING_PRIVATE_KEY` secret (minisign key, no
password; public half in `tauri.conf.json`) and `tauri.updater.conf.json` turns on
`createUpdaterArtifacts` there only, so local builds need no key. Losing the key means
shipping a new pubkey, which installed copies won't accept: they'd need a manual reinstall.
`update.rs` checks and downloads (skipped in debug builds) and keeps the bytes until
`update_install` installs and calls `request_restart`, whose `ExitRequested` skips the git
quit hold. `updater.svelte.ts` checks on launch and every 6 h from the main window; when one
is ready the toolbar shows "Restart to update" and the app-menu item switches to it.
Installing runs `store.suspend()` (flush + sync) first.
