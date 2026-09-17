# Changelog

All notable changes to Dagobert are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
