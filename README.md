# Dagobert

A lightweight note-taking app where notes form a DAG. Each note is also a task:
it can depend on other notes, and it is "ready" once everything it depends on is done.

Built with Tauri 2 + Svelte 5.

## Usage

- **Open a folder** — any folder works (à la Obsidian). Notes are stored as
  `notes/<slug>.md` with YAML frontmatter; canvas state lives in `dagobert.json`.
- **Double-click** the canvas (or `⌘N` / `+ Note`) to create a note.
- **Drag** a note to move it; drag the background (or two-finger scroll) to pan;
  `⌘`/`ctrl` + scroll (or pinch) to zoom. Positions and viewport are remembered.
- **Link notes** by dragging from a note's right-hand handle onto another note —
  the target then depends on the source. Or search for dependencies/dependents
  from the note panel. Cycles are refused.
- **Click an edge** to select it, then `⌫` to remove it (or double-click it).
- `⌘F` searches title, tags and body; `Enter` jumps to the first match.

## Note format

```markdown
---
id: 3f2a9c1d0e
title: Design the schema
tags: [backend, design]
created: 2026-09-16T10:00:00.000Z
modified: 2026-09-16T10:00:00.000Z
opened: 2026-09-16T10:00:00.000Z
done: false
x: 120
y: 80
deps: [a1b2c3d4e5]   # ids of notes this one depends on
---
Markdown body…
```

## Development

```sh
npm install
npm run tauri dev     # desktop app
npm run dev           # UI only, in a browser (in-memory backend)
npm run check         # svelte-check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build   # release bundle
```
