# iOS

Read this when touching anything gated on `isMobile`, `state.rs`, the mobile capability,
or the iOS build.

The phone runs the same Rust crate and the same Vite bundle as the Mac: `store.rs`,
`merge.rs` and `sync.rs` come along unchanged, and git is the sync channel. What is
adapted is everything that assumed a desktop.

## The platform flag

`isMobile` in `backend.ts` is `matchMedia("(pointer: coarse)").matches && innerWidth < 700`
— deliberately not the OS, so it needs no plugin and behaves identically in the browser
dev loop. `main.ts` puts a `mobile` class on `<body>` from it; markup branches on the
flag, CSS on the class (the phone-only rules live at the end of `app.css`, because they
override component styles). In `npm run dev`, `?mobile` forces it on, so the layout can
be worked on without a device. An iPad falls on the desktop side: out of scope, not
broken.

## Rust

- `state.rs` holds `Recent` and `AppState` and is compiled everywhere. `watch.rs` is
  `#[cfg(desktop)]`, because `notify` is declared only for the desktop targets.
- `watch_project` / `unwatch_project` / `github_cli_token` are commands on **every**
  target with no-op bodies on mobile: `generate_handler!` won't take `cfg` on its
  entries, and a no-op also means `backend.ts` needs no branch.
- Quit interception (`on_window_event`, `ExitRequested`, `sync::intercept_quit`) is
  desktop-only; `git_quit` and `sync::finish_quit` still compile everywhere, and nothing
  emits `git-quit` on mobile, so the frontend listener is inert.
- `git2` drops the `ssh` feature for `aarch64-apple-ios` (HTTPS only), which also drops
  libssh2 from the cross-compile. Desktop keeps it for existing ssh remotes.
- `capabilities/default.json` is `"platforms": ["macOS", "windows", "linux"]` — without
  that, a capability with no `platforms` applies to every target and `mobile.json` would
  add permissions rather than replace them. `mobile.json` keeps `core:default` (the event
  permissions `broadcast` / `subscribe` need) and `opener:default` (`openUrl`), and drops
  the dialog and window permissions. Anything dropped must also be branched in
  `backend.ts`, or the call rejects at runtime.

## Projects and credentials

There is no folder picker, so projects live in `app_data_dir()/projects`:
`list_projects`, `project_path` and `clone_project`. The phone only ever **clones** — a
project is always created on the Mac. `clone_project` writes `user.name` / `user.email`
into the new repository, since there is no `~/.gitconfig` to fall back on.

`store.recent` and the last-open key hold the project **name** on mobile (the container
path carries a UUID that changes on reinstall); `openRef` resolves it through
`project_path`. Desktop keeps absolute paths.

Credentials: `pick_cred` decides what `callbacks` offers on each attempt — the token
first for `USER_PASS_PLAINTEXT`, then the credential helper; ssh-agent and key files are
unchanged and a token never displaces them. The token is threaded from the frontend
through `git_sync` / `git_quit` → `sync::cycle` → `git::fetch` / `git::push` and is never
written to disk by Rust. `secrets.ts` is the one place it and the GitHub API token live
(`localStorage` for now; a keychain plugin would replace the backing there alone).

## Lifecycle

There is no quit on iOS. `App.svelte` listens on `visibilitychange`:

- **Foreground** → `store.resume()`: re-arm the tick timer (the OS froze the thread) and
  run a full sync. This is the reliable one.
- **Background** → `store.suspend()`: flush saves, then push. Best-effort — iOS suspends
  JS within about a second and neither step is synchronous. Nothing is lost: the commit
  happens on the next foreground.

The file watcher is gone, so a pull's rewrites are read back by `store.reloadFromDisk()`,
called from `syncNow` when `SyncReport.pulled` is `fast-forward` or `merging`. It re-reads
the project and routes every note through `applyExternal` — **not** `store.open`, which
would clear the undo history, the selection and the viewport and ignore in-flight saves.

## Touch

`Canvas.svelte` tracks live pointers in `touches`:

- Two pointers → `pinch`: zoom about the midpoint and follow it, so the two-finger pan
  comes free. `gesturestart` / `gesturechange` are claimed on the container, or Safari
  zooms the page instead.
- A plain drag on a note **pans the canvas**; holding it (`HOLD_MS`) arms the drag.
  Holding and lifting without moving opens the context menu, which is rendered as a
  bottom action sheet. Holding the background opens it directly.
- Double-tap is paired in `onTap` rather than left to `dblclick`, which is unreliable
  under pointer capture with `touch-action: none`.
- Marquee and shift-click multi-select have no touch equivalent yet. Nothing needs
  hiding: `store.select` already sets `multi` to `[id]`, so every action that reads it
  acts on the one selected note.

## Layout

The note panel is a bottom sheet (`.panel-wrap.sheet`, peek or `.full`, dragged by the
grabber in `App.svelte`); on desktop the same wrapper is `display: contents` so the flex
row is unchanged. The toolbar keeps new note, search, tags and git and sends the rest to
the commands palette — the same `paletteActions` registry an overflow menu would read.
Dialogs, the PR pane and the context menu go full-width from `app.css`. The grain shader
is off by default (battery). Safe areas come from `--safe-*`, the software keyboard from
`--kb` (`visualViewport`, set in `main.ts`); fields are forced to 16px, below which Safari
zooms the page on focus.

## Building

Not set up in the repo: it needs full Xcode (not just the Command Line Tools), the iOS
targets (`rustup target add aarch64-apple-ios aarch64-apple-ios-sim`) and CocoaPods
(`tauri ios init` runs `pod install`). Then `npm run tauri ios init`, and
`TAURI_DEV_HOST=<lan-ip> npm run tauri ios dev` for a physical device — which also needs
`bundle.iOS.developmentTeam` in `tauri.conf.json` (or `TAURI_APPLE_DEVELOPMENT_TEAM`).
The simulator needs neither a team nor signing.

Signing is a free Apple ID: builds run for 7 days and are re-deployed from Xcode, so
`npm run tauri ios build` is never the delivery step and `release.yml` keeps shipping the
Mac app only. CI does run `cargo check --target aarch64-apple-ios`, which needs no Xcode
project, no CocoaPods and no signing, so the `cfg` gating can't rot.

Still to do: a keychain plugin behind `secrets.ts`, and a `beginBackgroundTask` plugin so
the background push is reliable rather than best-effort.
