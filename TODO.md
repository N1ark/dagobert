# Roadmap

Tracked work. Move items to CHANGELOG.md (Unreleased) as they land.

## In progress (v0.2.0)

- [ ] Undo / redo (`⌘Z` / `⇧⌘Z`) for moves, deletes, links, tags, status, bulk edits
- [x] File watching: pick up external edits to `notes/` and `dagobert.json`
- [x] Auto-layout: "Tidy" arranges the DAG topologically (deps left → dependents right)
- [x] Highlight the chain: selected node's ancestors/descendants, everything else dimmed
- [x] Keyboard navigation on the canvas (arrows between neighbours, Enter opens, Tab to dependent)
- [x] Note templates: per-workflow default body for new notes
- [x] Minimap
- [x] Quick open (`⌘K`)

## Later

- Due dates
- Search operators (`tag:`, `is:ready`, …)
- Collapse subtrees
- Export subgraph / project to markdown
