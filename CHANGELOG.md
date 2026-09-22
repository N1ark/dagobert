# Changelog

All notable changes to Dagobert are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Git settings take an access token and a commit identity, for remotes over HTTPS.
- A phone layout: the note panel becomes a bottom sheet, the toolbar collapses to an
  overflow menu, and projects are cloned from a URL instead of picked from a folder.
- Touch input on the canvas: pinch to zoom, two-finger pan, long-press for the context
  menu, hold a note to drag it, and double-tap to create or open one.
- The editor keeps clear of the software keyboard, and autocorrect no longer rewrites
  markdown as it is typed.

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
