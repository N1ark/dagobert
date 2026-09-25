# Changelog

All notable changes to Dagobert are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Checkboxes in the note panel look like the ones on the graph.
- Dragging and editing stay smooth in large projects.
- The GitHub rate-limit message only suggests signing in when you aren't.
- References a repo can't load are listed under its error once, not each with its own copy.

### Fixed

- A note sharing its title with another no longer changes file name every time it's saved.
- On a phone, the issue popup fits the screen and the dependency picker lines up with the panel.
- Emptying the trash also removes notes it couldn't list.

## [0.8.0] - 2026-09-25

### Added

- Sign in with GitHub from settings or the welcome screen: you approve a code in your
  browser, and the same sign-in authenticates git over HTTPS. No more pasting tokens.
- Adding a project picks from a searchable list of your repositories instead of asking
  for a URL.
- A phone layout: panels become draggable bottom sheets, the toolbar collapses to an
  overflow menu, actions move to a bottom bar, and search opens from the bottom edge.
- Touch input on the canvas: pinch to zoom, two-finger pan, flick to scroll, long-press
  for the context menu, hold a note to drag it, and double-tap to create or open one.
- A file name in the trash reveals the file, like the one in the note panel.
- Issue references get state icons like pull requests: open, done and closed.

### Changed

- Notes, pull requests and settings all open in the same panel, one at a time.
- Unreachable repos are listed at the bottom of the pull requests panel, under their own
  separator, instead of replacing the whole list with one error.
- Git sync and the GitHub API only ever use the signed-in GitHub account: no ssh keys, no
  credential helper, no `gh` CLI token. An ssh remote is moved onto HTTPS.
- Pull request titles and file names read as links, not as buttons, and closed and
  not-yet-loaded pull requests get their own icons.
- Dragging across buttons, labels and dialogs no longer selects their text.
- On a phone, typing in a note gives the editor most of the screen above the keyboard.

### Fixed

- Losing the network no longer signs you out of GitHub.
- The editor and search keep clear of the software keyboard, and autocorrect no longer
  rewrites markdown as it is typed.
- The mention picker follows the caret in a newly added block, as it does in every other.
- The note panel's title renders its markdown, like the node card, until you edit it.

## [0.7.1] - 2026-09-21

### Added

- Git tracking (File → Enable git tracking): the project is committed every few minutes,
  on `⌘S`, on open and on quit; with an `origin` remote it also pulls and pushes.
- Edits from another machine are merged automatically; true conflicts show up in the
  editor as "mine / theirs" panes with Keep mine / Keep theirs / Keep both.
- A branch icon in the toolbar shows the sync state and counts unresolved conflicts.

### Changed

- Settings is a proper page (`⌘,`, also in the app menu and command palette), with
  General, GitHub, Git tracking and Workflows sections.
- Toolbar buttons are icon-only with tooltips.
- Refreshing pull requests keeps the sidebar and inline icons in place while the new
  status loads.
- The canvas viewport is saved per machine (`dagobert.local.json`) instead of in the
  shared project file.
- Opening a note no longer rewrites its file, so git history only carries real edits.
- Groundwork for translations and rebindable shortcuts.

## [0.6.0] - 2026-09-21

### Added

- Syntax highlighting in fenced code blocks for the common languages.
- Standalone note windows show status, dates, tags and links on the left and a
  clickable table of contents on the right.

### Changed

- A note open in its own window and in the main panel stays in sync as you type.
- Shift-clicking a status pill on the graph moves it back a stage.

## [0.5.1] - 2026-09-21

### Fixed

- PR state icons also show in node previews and wherever `alias#123` is rendered.

## [0.5.0] - 2026-09-21

### Added

- Tag and workflow colours can be customised beyond the built-in palette.
- `alias#123` references show the pull request's state as an inline icon, fetched in
  the background.

### Changed

- The canvas is bounded in size to avoid rendering issues far from the origin.

## [0.4.0] - 2026-09-20

### Added

- Background grain shader on the graph: subtle grain, sand travelling along the
  selected chain, and parallax. Toggle it from the View menu or command palette.
- Custom palette colours: the "+" swatch in any colour picker opens the system colour
  panel; right-click a custom swatch to remove it.

### Changed

- The dot grid no longer swims at fractional zoom levels.

## [0.3.0] - 2026-09-19

### Added

- macOS menu bar with shortcuts and icons; `⇧⌘K` opens the command palette.
- Tracking issues: a note kind that shows a `done/total` ring of its dependencies and
  is done once they all are.
- GitHub integration: configure repo aliases, then type `alias#` to pick an issue or
  PR; `alias#123` links to GitHub.
- Custom colours for workflow stages.
- "Reveal in Finder" for notes.
- Pasting a URL over selected text turns it into a link.

### Changed

- Quick open (`⌘K`) and the command palette (`⇧⌘K`) are separate panes.
- Double-clicking a node opens it in its own window.
- "Depends on" / "Blocks" in the note panel are compact chip rows.

### Fixed

- Links in a card's title or preview open in the browser again.
- `[[Links]]` to titles containing backticks resolve.
- Task-list checkboxes in the rendered body can be ticked.
- Deleting a freshly created note no longer races its first save.

## [0.2.0] - 2026-09-17

### Added

- Undo / redo (`⌘Z` / `⇧⌘Z`) for everything, with grouped actions undoing as one step.
- Quick open (`⌘K`): fuzzy-jump to any note, `#tag` to narrow, "Create …" when
  nothing matches.
- **Tidy**: automatic layered layout of the graph (or of the current selection).
- **Focus**: dims everything not upstream or downstream of the selected note.
- Keyboard navigation on the canvas with the arrow keys and `Tab`.
- Minimap in the canvas corner.
- Edits made outside the app (another editor, git, sync) show up live.
- Note templates per workflow, with `{{date}}` and `{{title}}` placeholders.

## [0.1.0] - 2026-09-17

Initial version.

### Added

- Canvas of notes forming a DAG: pan, zoom, drag, drag-to-link, positions saved per
  project folder.
- Notes as markdown files with YAML frontmatter; project settings in `dagobert.json`.
- Note panel with title, tags, dependencies, and a live-preview markdown editor with
  `[[wikilinks]]` and backlinks.
- Customisable workflows with a "ready" state when all dependencies are done.
- Search and tag filter.
- Soft delete to `trash/` with restore.
- Multi-select, group drag, context menus, copy / paste / duplicate.
- Open a note in its own window with live sync.
- Dark theme, Phosphor icons.
