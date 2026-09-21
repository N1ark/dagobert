# Changelog

All notable changes to Dagobert are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Git tracking (File → Enable git tracking, or Tools → Git tracking…): the project is
  committed on a timer (default every 5 minutes), on `⌘S`, right after opening and
  when the app quits; with an `origin` remote it also pulls and pushes. Conflicting
  edits from another machine are merged by rule (later edit wins the frontmatter,
  tags and links from both sides, bodies merged line by line) and listed in a popup;
  a note whose body kept git's conflict markers shows a warning badge, and the
  toolbar counts them. The toolbar's branch icon shows the sync state.

### Changed

- The canvas viewport now lives in `dagobert.local.json` (per machine) instead of
  `dagobert.json`; an existing viewport is migrated on the next open.

## [0.6.0] - 2026-09-21

### Added

- Syntax highlighting in fenced code blocks (` ```lang `), for the common languages
  (JS/TS, Python, Rust, Go, C/C++, Java, Kotlin, Swift, Ruby, shell, SQL, JSON, YAML,
  TOML, HTML/Svelte, CSS, Markdown, diff and a few more).
- Standalone note windows split the area under the title in two: the note's status,
  dates, tags and links on the left, and a clickable table of contents on the right.

### Changed

- A note edited in its own window and in the main window's panel now stays in sync
  as you type, instead of only after each save; an edit arriving while you're in a
  block reloads that block without losing your caret.

- Shift-clicking a node's status pill on the graph moves it back a stage instead of forward.

## [0.5.1] - 2026-09-21

### Fixed

- PR state icons also show in node previews on the graph, and anywhere else an
  `alias#123` reference is rendered inline (titles, dependency lists, pickers).

## [0.5.0] - 2026-09-21

### Added

- The colour of tags and workflows can now be customised past the builtin palette.
- `alias#123` references in note bodies show the pull request's state (open, draft,
  closed, merged) as a small inline icon. PR details are now fetched in the
  background even when the Pull requests pane is closed.

### Changed

- The world is now bounded in size, to avoid rendering issues or the graph going very far away.

## [0.4.0] - 2026-09-20

### Added

- Background grain shader on the graph view: a discreet sandy grain along the frame
  edges and around the selected node, sand grains travelling along every edge of the
  selected node's chain, and a subtle parallax that puts the dot grid and grain behind
  the nodes. Toggle it with "Enable/Disable background grain" in the command palette
  or the View menu (it respects `prefers-reduced-motion`).
- Custom palette colours: the "+" swatch in any colour picker (tag colours, workflow
  stage colours) opens the system colour panel; the chosen colour is added to a
  project-wide palette stored in `dagobert.json`. Right-click a custom swatch to remove it.

### Changed

- The dot grid is drawn per pixel (in the shader, or as a CSS fallback when the grain
  is off), so it no longer swims when zooming at fractional zoom levels; dots shrink
  slightly when zoomed out.

## [0.3.0] - 2026-09-19

### Added

- macOS menu bar (File / Edit / Note / View / Tools) built from the same action list as
  the command palette, with shortcuts and SF Symbol icons.
- Command palette actions have icons; `⇧⌘K` opens the command palette directly.
- Tracking issues: set a note's kind to "Tracking issue" (panel dropdown) and it has
  no checkbox/status — it shows a radial ring with `done/total` of its dependencies
  and counts as done once they all are. They have their own template.
- GitHub integration: configure repo aliases (⚙ → GitHub, or the command palette),
  then type `alias#` in a note to pick an issue/PR by title or number; `alias#123`
  renders as a link to GitHub. Uses the `gh` CLI login or a pasted token for private
  repos.
- Workflow stages can have a custom colour (workflow editor → click the dot next to a
  stage); "automatic" keeps the grey / yellow / green default.
- "Reveal in Finder" in the node context menu; the file name in the panel footer
  reveals the file too.
- Pasting a URL over selected text in the editor turns the selection into a link.
- `npm run install:app` builds and replaces the installed app; Prettier, ESLint and
  clippy; CI and release workflows.

### Changed

- Quick open (`⌘K`) and the command palette (`⇧⌘K`) are separate panes; the `>` prefix
  is gone. Rows no longer shift on hover.
- Double-clicking a node opens it in its own window instead of creating a note on top of it.
- Note panel: "Depends on" / "Blocks" are compact chip rows (longest-first packing),
  stacked instead of side by side; for tracking issues the first reads "Tracks".
- The issue picker substring-matches the repo's recent items and accepts spaces.

### Fixed

- Links in a card's title/preview open in the browser again (the drag handler was
  swallowing the click).
- `[[Links]]` to notes whose title contains backticks now resolve.
- Task-list checkboxes in the rendered body can be ticked by clicking them.
- Deleting a freshly created note no longer races its first save.

## [0.2.0] - 2026-09-17

### Added

- Undo / redo (`⌘Z` / `⇧⌘Z`, also in the ⌘K palette) for moves, resizes, links,
  tags, status/workflow changes, edits, creates, deletes and restores. Actions done
  together (group drag, Tidy, bulk tag/status) undo as one step; typing coalesces.
- Quick open (`⌘K`): fuzzy-jump to any note, `#tag` to narrow, `>` for commands,
  `⌘↩` opens the note in a new window, "Create …" when nothing matches.
- **Tidy** toolbar button: layered auto-layout of the DAG (dependencies left,
  dependents right); with a multi-selection only that subgraph is arranged.
- **Focus** toggle: selecting a note softly dims everything that isn't upstream or
  downstream of it, and highlights the chain's edges. Remembered across launches.
- Keyboard navigation on the canvas: `←`/`→` move to a dependency/dependent, `↑`/`↓`
  to the nearest note above/below, `Tab`/`⇧Tab` cycle dependents/dependencies,
  `Enter` edits the title. The view pans only when the target is off screen.
- Minimap in the canvas corner showing every note and the current viewport; click
  or drag it to pan. Collapsible; shown once there are two or more notes.
- File watching: edits made to `notes/*.md` or `dagobert.json` outside the app (another
  editor, git, sync) show up live. The app's own writes are ignored for one second so
  they don't echo back.
- Note templates: each workflow (and the built-in Todo) can define a default body for
  new notes, with `{{date}}` and `{{title}}` placeholders. Switching a note's workflow
  while its body is untouched swaps in the new template. Edit them in the workflow
  editor (⚙ in the note panel).

## [0.1.0] - 2026-09-17

Initial version.

### Added

- Canvas of notes forming a DAG: pan, zoom, drag, drag-to-link with cycle rejection,
  positions and viewport persisted per project folder.
- Notes as markdown files with YAML frontmatter (`notes/<slug>.md`), project settings
  in `dagobert.json`.
- Note panel with title, tags (project-wide colours), dependencies/dependents pickers,
  timestamps, and an Obsidian-style live-preview markdown editor with `⌘B/I/E/K`
  shortcuts, list continuation and `@` autocomplete for `[[wikilinks]]` (backlinks shown).
- Customisable workflows (todo → … → done) with a default Todo checkbox; "ready" state
  when all dependencies are done.
- Search + tag filter that dims non-matching nodes.
- Soft delete to `trash/` with restore / delete forever; empty notes are discarded.
- Multi-select (shift-drag / shift-click / ⌘A), group drag, group context menu.
- Context menus for nodes, edges and background; copy / paste / duplicate nodes.
- Resizable panel and per-node width; open a note in its own window with live sync.
- Dark theme after n1ark.com, Phosphor icons, app icon.
