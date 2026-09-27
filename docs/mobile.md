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

- `state.rs` holds `Recent` and `AppState` and is compiled everywhere. `watch.rs` and
  `update.rs` are `#[cfg(desktop)]`, because `notify` and the updater plugin are declared
  only for the desktop targets; `keyboard.rs` is iOS-only.
- `watch_project` / `unwatch_project` / `update_check` / `update_install` are commands on
  **every** target with no-op bodies on mobile: `generate_handler!` won't take `cfg` on
  its entries.
- Quit interception (`on_window_event`, `ExitRequested`, `sync::intercept_quit`) is
  desktop-only; `git_quit` and `sync::finish_quit` still compile everywhere, and nothing
  emits `git-quit` on mobile, so the frontend listener is inert.
- `capabilities/default.json` is `"platforms": ["macOS", "windows", "linux"]` — without
  that, a capability with no `platforms` applies to every target and `mobile.json` would
  add permissions rather than replace them. `mobile.json` keeps `core:default` (the event
  permissions `broadcast` / `subscribe` need), `opener:default` (`openUrl`) and
  `dialog:allow-open` ("Insert media…" opens the photo picker), and drops the window
  permissions. Anything dropped must also be branched in
  `backend.ts`, or the call rejects at runtime.

## Projects

There is no folder picker, so projects live in `app_data_dir()/projects`:
`list_projects` (the welcome screen), `project_path` and `clone_project`. The phone only
ever **clones** — a project is always created on the Mac. `CloneDialog` needs a sign-in,
lists the repos the GitHub App can reach (`listRepos`), clones with the session's token
and writes its name / email into the new repository as `user.name` / `user.email` (there
is no `~/.gitconfig` to fall back on), then turns tracking on.

`store.recent` and the last-open key hold the project **name** on mobile (the container
path carries a UUID that changes on reinstall); `openRef` resolves it through
`project_path`. Desktop keeps absolute paths.

Credentials work as on the desktop ([storage-and-sync.md](storage-and-sync.md),
[github.md](github.md)).

## Lifecycle

There is no quit on iOS. `App.svelte` listens on `visibilitychange`:

- **Foreground** → `store.resume()`: re-arm the tick timer (the OS froze the thread) and
  run a full sync. This is the reliable one.
- **Background** → `store.suspend()`: flush saves, then a full sync. Best-effort — iOS
  suspends JS within about a second and neither step is synchronous. Nothing is lost:
  the commit happens on the next foreground.

The file watcher is gone, so a pull's rewrites are read back by `store.reloadFromDisk()`,
called from `syncNow` when `SyncReport.pulled` is `fast-forward` or `merging`. It re-reads
the project and routes every note through `applyExternal` — **not** `store.open`, which
would clear the undo history, the selection and the viewport and ignore in-flight saves.

## Panels

A phone shows **one** panel at a time and it is always `Sheet.svelte`: the same
container, the same thumb, the same drag and the same stops. `mobilePanel` in `App.svelte`
picks which — settings, trash, pull requests or the selected note, in that order — and
`closePanel` closes whichever it is. The panels themselves are the desktop's: App's `pane`
snippet renders each one bare, into a `Sheet` here and a `Dock` on the desktop (see
[ui.md](ui.md#panels)). Their close buttons are `{#if !isMobile}`: the thumb is the way out.

The sheet settles on the stop a flick throws it at rather than the nearest one, gives a
little above its top stop and springs back, and dims what it covers with a `.scrim` whose
opacity follows the drag. It reads its own position out of the live transform, so a
gesture that starts mid-animation picks the sheet up where it is. Below its top stop,
any drag on the contents moves the sheet in either direction (a non-passive `touchmove`
keeps iOS from starting a scroll, which would cancel the pointer); at the top, the
contents scroll first and only a downward drag from their top takes the sheet.
`--sheet-top` is registered with `@property` because `getComputedStyle` hands an
unregistered custom property its `calc()` back unevaluated.

The floating bottom bar follows the sheet frame by frame through `--sheet-lift` /
`--sheet-dim`, which `Sheet.svelte` sets on the root, and drops away under a full one
(`.tucked`). The grabber (`.grab`) and `.scrim` are shared classes in `app.css`, used by
`Sheet.svelte` and by the context menu's action sheet alike.

`.dialog.bare` is the no-chrome form a sheet renders (`app.css` also strips the safe-area
padding it would otherwise inherit from the full-screen dialog rule). Dialogs that aren't
panels — `GitDialog`, `CloneDialog` — stay ordinary dialogs.

## Touch

`Canvas.svelte` tracks live pointers in `touches`:

- Two pointers → `pinch`: zoom about the midpoint and follow it, so the two-finger pan
  comes free. `gesturestart` / `gesturechange` are claimed on the container, or Safari
  zooms the page instead.
- A plain drag on a note **pans the canvas**; holding it (`HOLD_MS`) arms the drag.
  Holding and lifting without moving opens the context menu, which is rendered as a
  bottom action sheet. Holding the background opens it directly.
- A flick leaves momentum behind: `flickVelocity` reads the last few pointer samples and
  `stepGlide` decays it once per frame, stopping early when the viewport clamp refuses
  the move. Touch only — a mouse drag is expected to stop where it was let go.
- An armed hold lifts the note it picked up (`lifted`), which is the only feedback a
  phone gets that the drag has taken over from the pan.
- Marquee and shift-click multi-select have no touch equivalent yet. Nothing needs
  hiding: `store.select` already sets `multi` to `[id]`, so every action that reads it
  acts on the one selected note.

## Layout

The toolbar keeps git, tags, the minimap toggle and a button for the commands palette
(`paletteActions`), which holds everything else; search, new note and PRs sit in the
floating bottom bar. The palette docks to the bottom edge, field last, and rides up with
the keyboard. Dialogs go full-screen and the context menu becomes an action sheet from
`app.css`. The grain shader is off by default (battery). Safe areas come from `--safe-*`,
the software keyboard from `--kb` (below); fields are forced to 16px, below which Safari
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

Without `Simulator.app` (a partial Xcode install may lack it even though the SDKs work),
`xcrun simctl boot`, `install`, `launch` and `io … screenshot` drive the simulator
headlessly.

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

`xcrun devicectl list devices` gives the udid. **`npm run install:ios`** is all of the
above in one step: it reads the team out of the provisioning profile, picks the first
paired device (`-- --device <udid>` to choose), builds, installs from the archive at
`src-tauri/gen/apple/build/dagobert_iOS.xcarchive` and launches. `-- --skip-build`
installs what is already there.

It builds `--debug` because a release build doesn't link: every Swift symbol swift-rs
supplies (`_register_plugin`, `_on_webview_created`, `_init_plugin_dialog`, …) comes out
undefined. What fails is the incidental `cdylib` crate-type — the `staticlib` Xcode
actually consumes is archived, not linked, and the same cdylib links fine in debug — so
the release profile is somehow losing swift-rs's `libTauri.a`. Unresolved; `-- --release`
is left in for when it stops. The device must be unlocked, have Developer Mode on (Settings → Privacy & Security → Developer Mode, which only appears after an
install has been attempted, and needs a restart), and the certificate trusted once under
Settings → General → VPN & Device Management. Each of those surfaces as its own install
or launch error.

Signing is a free Apple ID: builds run for 7 days and are re-deployed with
`npm run install:ios`; `release.yml` ships the Mac app only. CI runs
`cargo clippy --target aarch64-apple-ios -- -D warnings`, which needs no Xcode project,
no CocoaPods and no signing, so the `cfg` gating can't rot.

Still to do: a keychain plugin behind `secrets.ts`, and a `beginBackgroundTask` plugin so
the background sync is reliable rather than best-effort.

## The software keyboard

WKWebView never tells the web layer about the keyboard — `visualViewport` doesn't shrink,
so every web-only trick for keeping a field visible is guesswork. `keyboard.rs` observes
`UIKeyboardWillChangeFrameNotification` and `UIKeyboardWillHideNotification` and emits the
end frame's height, which in points is the same unit as a CSS pixel. `main.ts` puts it in
`--kb` and toggles `body.keyboard`; `body.mobile .app` and the panels shrink by it.

While the keyboard is up the phone is compact: a sheet climbs to the status bar
(`--sheet-top`) and drops the home-indicator inset the keyboard already covers; a field
taking focus in a sheet opens it fully; and the note panel hides its details and footer
while the body is being typed in. The details are capped at 40% of the panel otherwise,
scrolling on their own. `LiveEditor` keeps the caret in view (`revealCaret`) on input and
whenever the editor resizes, since nothing scrolls it there for us.

Hide fires after the frame change that comes with it, so it has the last word — a
dismissing keyboard still reports its full height on the way out.

WKWebView's own keyboard handling is switched off (`detach_webview`), as Capacitor's
keyboard plugin does: it is removed as an observer of the keyboard notifications and its
scroll view is made unscrollable. Left alone, it insets its scroll view by the keyboard
and scrolls the page to reveal the focused field, so the whole shell rides up with the
keyboard, and a drag while typing scrolls the page instead of reaching the sheet.

Nothing in the shell scrolls, and nothing should: with `--kb` correct there is nothing to
scroll out of the way, and a scrolling shell can put the focused field back under the
keyboard; `main.ts` scrolls the window back to 0 as a net. In the browser dev loop there
is no UIKit, so `main.ts` falls back to `visualViewport`, which does shrink there.
