# Canvas, rendering and performance

Read this when touching `Canvas.svelte`, `Grain.svelte` / `grainGL.ts`, `Minimap.svelte`,
`NodeCard.svelte`, `layout.ts` or `viewport.ts`.

## Canvas.svelte

Pan / zoom / drag / link interactions and edge rendering. Exposes `focusNode`,
`createAtCenter`, `fitAll`, `tidy` via `bind:this`. Wheel: plain scroll pans,
`ctrl`/`meta`+wheel (pinch) zooms; the listener is attached manually with
`passive: false`. Touch gestures are in [mobile.md](mobile.md).

The world is a square of half-width `WORLD` (20000, small enough for float32 in the grain
shader) in `viewport.ts`: a `$effect.pre` clamps every viewport write (`clampViewport`,
`MARGIN` px of overscroll so the rim shows) and dragged nodes are clamped (`clampNode`).

Performance rules (profile in Safari, not Chrome — Chrome is fine either way):

- Arrowheads are plain `<path class="head">` triangles (`head()`), never SVG `<marker>`s:
  WebKit re-renders markers on every paint, and a few hundred on screen dropped panning
  to ~25 fps.
- Wheel events are queued and applied once per animation frame (`applyWheel`), and pointer
  pans / pinches likewise (`scheduleGesture`): input fires far more often than the display
  refreshes, and WebKit re-flushes style and hit-tests the world after each event.
- `.world` carries `will-change: transform` so it's a compositor layer from the start
  (otherwise WebKit promotes it mid-gesture with a ~65 ms hitch), and its transform is
  inline rather than via custom properties on `.canvas` (changing an inherited property
  re-resolves every descendant).
- The world edge (shade outside the square + dashed rim) is drawn as screen-space bands
  clamped to the view (`worldEdge`), never as world-sized shapes inside `.world`: WebKit
  repaints a shape that large for every tile it rasterises.
- Nothing per drag frame scans the graph: notes are looked up with `store.byId` (an id
  index), and graph walks (`selectedChain`) are `$derived` so they rerun only when the
  graph changes.
- `main.ts` exposes `window.store` in dev builds so a script can seed a big graph;
  simulate panning with dispatched `WheelEvent`s, not by writing `store.viewport`.

`NodeCard.svelte` reports its height via `onresize` so edges can anchor at mid-height
(don't use `bind:` with a fallback — Svelte 5 throws). Node width is an optional `width`
in frontmatter (omitted = `NODE_W` 220, see `widthOf`), resized via the bottom-right grip
(`[data-resize]`), clamped 140–640; "Reset width" in the context menu clears it.

`ContextMenu.svelte` is rendered as a sibling of `.canvas`, not inside it: a
`position: fixed` element inside the `overflow: hidden` canvas makes WebKit drop the
canvas clip and paint the graph over the note panel. Targets: a node, a multi-selection
(bulk done/undone, tag checklist with all/some/none state, delete), an edge (remove
link) or the background (new note here, paste). Closes on outside pointerdown, Esc or
window blur.

## Selection, navigation, clipboard

- Multi-select: `store.multi` (string[]); `store.select(id)` resets it to `[id]`.
  Shift+drag on the background is a marquee (live, additive), shift+click toggles a node,
  ⌘A selects all. Dragging a node inside the group moves the group. `NodeCard`'s
  `grouped` prop draws the ring.
- Navigation (`navigate`, `nav-*` keys): ←/→ = closest-by-y dependency/dependent, ↑/↓ =
  nearest node above/below (overlapping x preferred), Tab/⇧Tab = next dependent/dependency
  in y order; `edit-title` (↩) bumps `store.focusTitle` (NotePanel focuses the title).
  With nothing selected, any arrow picks the node nearest the view centre. `ensureVisible` pans minimally.
- Double-click on a node = `store.openInWindow`; on empty canvas = create note; on an edge
  = remove it. Double-clicks are paired by hand (`onTap`) as well as `dblclick`, which is
  unreliable under pointer capture (touch included). Dragging from a node's right-hand port onto another
  node makes the _target_ depend on the _source_. `⌫`/`⌦` removes a selected edge.
- Clipboard: copy puts the selected node in `store.clipboard` (plus plain text on the
  system clipboard) unless text is selected; paste lands under the cursor (or view
  centre); duplicate offsets by +30/+30. Clones get a new id and no deps (`cloneAt`).
- Dimming: `App.svelte` computes `matches` = search terms AND tag filter (OR across
  selected tags); `null` means nothing is filtered. When `matches` is null and Focus is on
  (`focus` prop, localStorage `dagobert.focus`), Canvas dims everything outside the single
  selected note's chain (ancestors + descendants) at a softer opacity (`.soft-dim`).
  `visible = matches ?? chain`.
- Opening, closing or resizing the PR sidebar moves the canvas's left edge; `absorb(dx)` in
  `App.svelte` shifts the viewport to match so the graph stays put, and `Canvas` cancels
  the matching background parallax shift (`comp`).

## layout.ts

Pure layered layout (`layout(nodes, opts)`): longest-path layering, barycenter ordering
sweeps, columns centred on the tallest, components stacked vertically (largest first).
`Canvas.tidy()` applies it (selection-only when `store.multi.length > 1`, anchored at the
selection's top-left) as one undo step, then fits the view.

## Minimap.svelte

Bottom-right overview (180×120). Bounds = all notes ∪ the viewport, padded, so the view
box always stays inside the map; the notes' bounds are derived apart from the viewport so
panning doesn't walk every note. Click/drag pans (stopPropagation keeps the canvas from
panning too). Open state lives in `minimapState.svelte.ts` (localStorage
`dagobert.minimap`, shared because the phone's toggle sits in the toolbar). Hidden when
fewer than 2 notes.

## Grain.svelte + grainGL.ts

Decorative WebGL layer under the canvas (`z-index: -1` inside `.canvas`, which is
`isolation: isolate`). The component owns props, the fade-in bookkeeping and the frame
loop; `grainGL.ts` is plain WebGL1 (`createGrain(canvas)` → `render(w, h, frame)`), so
`scripts/grain-bench.mjs` can drive it headlessly (timings on the real GPU;
`node scripts/grain-bench.mjs <ref>` also pixel-compares against that git ref). Shaders
are `.glsl/.frag/.vert` files imported with Vite `?raw`; `precision`, `MAX_RECTS` /
`MAX_CURVES` `#define`s and the shared `grain.glsl` (hash, bez) are prepended.

Two passes: `travellers.vert/.frag` draw one small quad per sand grain riding an edge into
an offscreen RGBA8 texture (MAX blending via `EXT_blend_minmax`, additive fallback), then
`grain.frag` runs full-screen and samples it once — cost scales with grain count, not
screen area (a per-fragment loop over 30 long edges cost ~200 ms/frame at 2× full screen).

`grain.frag`: 1–2 _device_-pixel specks that twinkle in place (per-cell phase; frozen
under `prefers-reduced-motion`), masked by a 24px rounded-rect vignette along the frame
and a halo around the selected nodes (`glowRects` in `Canvas.svelte`, up to 16, faded in
over 160 ms, scaled by zoom, tinted `--accent2`). Cells live in world space so the sand
sticks to the graph; the cell size is chosen per power-of-two zoom band (crossfaded
between bands) to stay ~1–2 device px. It also draws the dot grid per pixel (`dots()`,
lattice 16 + 32k; radius/opacity taper with zoom via `grid` in `Canvas.svelte`); the CSS
`.bg` grid is only the fallback when the shader is off, since repeating backgrounds get
pixel-snapped per tile and flicker while panning.

The sand and the dot grid use a parallax'd camera (`bg` in `Canvas.svelte`: the
foreground camera scaled by 0.7 about the view centre; `comp` cancels the translation a
resize would otherwise cause) so they read as further away than the nodes; the halo and
edge travellers stay in the foreground camera. Every edge in the selected node's chain
(`flowCurves`, the same cubic as the SVG `path()`, up to 48) gets sand grains travelling
dependency → dependent (`travellerCount(len)`: one per ~14 world px, 6–48). The buffer is
resized inside a `ResizeObserver` and drawn synchronously on input changes so a stretched
or lagging frame never shows. `Grain`'s loop skips a frame the input effect already drew.
Toggled by the "background grain" palette action (localStorage `dagobert.grain`).
