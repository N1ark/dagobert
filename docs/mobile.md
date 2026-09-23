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

## Panels

A phone shows **one** panel at a time and it is always `Sheet.svelte`: the same
container, the same thumb, the same drag and the same stops. `mobilePanel` in `App.svelte`
picks which — settings, trash, pull requests or the selected note, in that order — and
`closePanel` closes whichever it is.

Anything that is a full-screen dialog on the desktop must join that list rather than grow
its own mobile treatment. To add one:

1. Give the component a `sheet` prop. Put its contents in a `{#snippet}` and render either
   the snippet alone (in the sheet) or the snippet wrapped in its usual
   `.backdrop` / `.dialog` (on the desktop) — never two copies of the markup.
2. Hide its own close button when `sheet` is set. The thumb is the way out; a second
   affordance in the corner is what the title bar covers.
3. Add it to `mobilePanel` and `closePanel`, and gate its desktop mount with
   `{#if ... && !isMobile}` — otherwise it renders **twice** on a phone, and the invisible
   copy's backdrop eats every tap.

The sheet settles on the stop a flick throws it at rather than the nearest one, gives a
little above its top stop and springs back, and dims what it covers with a `.scrim` whose
opacity follows the drag. It reads its own position out of the live transform, so a
gesture that starts mid-animation picks the sheet up where it is. `--sheet-top` is
registered with `@property` because `getComputedStyle` hands an unregistered custom
property its `calc()` back unevaluated.

The floating actions ride above a peeking sheet (`.bottombar.raised`) and drop away under
a full one (`.tucked`); the grabber styling and the scrim are shared classes in
`app.css`, used by `Sheet.svelte` and by the context menu's action sheet alike.

`.dialog.bare` is the no-chrome form (`app.css` also strips the safe-area padding it would
otherwise inherit from the full-screen dialog rule). Small confirmations that don't fill
the screen — `GitDialog`, `CloneDialog` — stay ordinary dialogs.

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
- A flick leaves momentum behind: `flickVelocity` reads the last few pointer samples and
  `stepGlide` decays it once per frame, stopping early when the viewport clamp refuses
  the move. Touch only — a mouse drag is expected to stop where it was let go.
- An armed hold lifts the note it picked up (`lifted`), which is the only feedback a
  phone gets that the drag has taken over from the pan.
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

Set up once: full Xcode (not just the Command Line Tools) with
`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` and
`sudo xcodebuild -license accept`, the targets
(`rustup target add aarch64-apple-ios aarch64-apple-ios-sim`), and CocoaPods
(`brew install cocoapods`, needed by `tauri ios init`). The simulator also needs a
**runtime** whose version matches the SDK — Tauri reports a mismatch as the misleading
"Simulator SDK not installed"; `xcodebuild -downloadPlatform iOS` fetches one.

`src-tauri/gen/apple` is the generated Xcode project and is committed. Regenerate it with
**`npm run ios:init`**, not `tauri ios init` directly: init writes Tauri's own default
icons into `Assets.xcassets` and ignores `src-tauri/icons/ios/`, so the script copies ours
back over them. It builds from `src-tauri/ios-project.yml`
(`bundle.iOS.template`, a path relative to the **repo root**, not to `tauri.conf.json`).
That template is Tauri's own with two changes, both of which the built-in one can't
express:

- `- sdk: libz.tbd` / `- sdk: libiconv.tbd`. libgit2 needs both, and Xcode links the Rust
  staticlib itself without ever seeing cargo's `rustc-link-lib` directives.
  `bundle.iOS.frameworks` looks like the right hook but is dead: Tauri guards that block
  on a `this.`-prefixed name that never resolves, so entries are silently dropped.
- `UIApplicationSceneManifest` with `UIApplicationSupportsMultipleScenes: true`. The
  iOS 26+ SDK refuses to launch an app that declares no manifest at all ("UIScene life
  cycle is required for apps built with this SDK"), and tao keys its entire scene path
  off that one flag: with it false it installs no scene delegate, never calls
  `setWindowScene:`, and the window is never drawn — a black screen with a perfectly
  healthy WebView behind it. True is right even on an iPhone, which cannot show multiple
  scenes: tao then moves its window to the main connected scene itself
  (`platform_impl/ios/view.rs`). No `UISceneConfigurations` is declared, because tao
  supplies the configuration from `application:configurationForConnectingSceneSession:`.

`npm run tauri ios build` / `ios dev` drive the build: Xcode's "Build Rust Code" phase
calls back into the Tauri CLI over a socket the CLI opens, so a bare `xcodebuild` on the
project fails — always go through the CLI. `TAURI_DEV_HOST=<lan-ip> npm run tauri ios dev`
for a physical device, which also needs `bundle.iOS.developmentTeam` in `tauri.conf.json`
(or `APPLE_DEVELOPMENT_TEAM`); the simulator needs neither a team nor signing.

The app builds, installs, launches and renders in the simulator. GUI interaction needs
`Simulator.app`, which a partial Xcode install may not have shipped yet even though the
SDKs and `simctl` work; `xcrun simctl boot`, `install`, `launch` and `io … screenshot`
drive it headlessly either way.

### Onto a phone

Signing needs an Apple ID added in Xcode (Settings → Accounts) and the team picked once
in the generated project's Signing & Capabilities — that is what issues the certificate
and the first provisioning profile. Afterwards the team lives in the environment, not in
the repo: Xcode writes `DEVELOPMENT_TEAM` into `project.pbxproj`, which is generated and
must not carry a personal id.

The team id is the profile's `TeamIdentifier`, **not** the value in the certificate's
name — those differ, and using the wrong one fails with "No Account for Team":

```sh
security cms -D -i ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision \
  | plutil -p - | grep -A2 TeamIdentifier
APPLE_DEVELOPMENT_TEAM=<team> npm run tauri ios build --debug --target aarch64
```

That builds and signs a `.app`. The `.ipa` export step may still fail on a stale team;
it isn't needed — install the `.app` directly:

```sh
xcrun devicectl device install app --device <udid> <path to Dagobert.app>
xcrun devicectl device process launch --device <udid> com.n1ark.dagobert
```

`xcrun xctrace list devices` gives the udid. **`npm run install:ios`** is all of the
above in one step: it reads the team out of the provisioning profile, picks the first
paired device (`-- --device <udid>` to choose), builds, installs from the archive at
`src-tauri/gen/apple/build/dagobert_iOS.xcarchive` and launches. `-- --skip-build`
installs what is already there.

It builds `--debug` because a release build doesn't link: every Swift symbol swift-rs
supplies (`_register_plugin`, `_on_webview_created`, `_init_plugin_dialog`, …) comes out
undefined. What fails is the incidental `cdylib` crate-type — the `staticlib` Xcode
actually consumes is archived, not linked, and the same cdylib links fine in debug — so
the release profile is somehow losing swift-rs's `libTauri.a`. Unresolved; `-- --release`
is left in for when it stops. The device must be unlocked, have Developer
Mode on (Settings → Privacy & Security → Developer Mode, which only appears after an
install has been attempted, and needs a restart), and the certificate trusted once under
Settings → General → VPN & Device Management. Each of those surfaces as its own install
or launch error.

Signing is a free Apple ID: builds run for 7 days and are re-deployed from Xcode, so
`npm run tauri ios build` is never the delivery step and `release.yml` keeps shipping the
Mac app only. CI runs `cargo clippy --target aarch64-apple-ios -- -D warnings`, which
needs no Xcode project, no CocoaPods and no signing, so the `cfg` gating can't rot.

Still to do: a keychain plugin behind `secrets.ts`, and a `beginBackgroundTask` plugin so
the background push is reliable rather than best-effort.

## The software keyboard

WKWebView never tells the web layer about the keyboard — `visualViewport` doesn't shrink,
so every web-only trick for keeping a field visible is guesswork. `keyboard.rs` observes
`UIKeyboardWillChangeFrameNotification` and `UIKeyboardWillHideNotification` and emits the
end frame's height, which in points is the same unit as a CSS pixel. `main.ts` puts it in
`--kb`; `body.mobile .app` and the panels shrink by it, and `body.mobile.typing` drops the
home-indicator inset the keyboard already covers.

Hide fires after the frame change that comes with it, so it has the last word — a
dismissing keyboard still reports its full height on the way out.

Nothing in the shell scrolls, and nothing should: with `--kb` correct there is nothing to
scroll out of the way, and a scrolling shell can put the focused field back under the
keyboard. In the browser dev loop there is no UIKit, so `main.ts` falls back to
`visualViewport`, which does shrink there.
