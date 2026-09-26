<script lang="ts">
  import { store } from "./store.svelte";
  import CaretDown from "phosphor-svelte/lib/CaretDown";
  import MapTrifold from "phosphor-svelte/lib/MapTrifold";
  import { t } from "./i18n";
  import { ICON } from "./icons";
  import { minimap, toggleMinimap } from "./minimapState.svelte";
  import { isMobile } from "./backend";
  import { notesBounds, edgeHandle } from "./viewport";

  /** Overview of the whole graph with the viewport drawn on top; click or drag to pan. */
  let {
    widthOf,
    heightOf,
    viewW,
    viewH,
  }: {
    widthOf: (n: { width?: number | null }) => number;
    heightOf: (id: string) => number;
    /** Canvas size in screen pixels. */
    viewW: number;
    viewH: number;
  } = $props();

  const W = 180;
  const H = 120;
  const PAD = 40;
  let dragging = false;
  const collapsed = $derived(!minimap.open);

  const vp = $derived(store.viewport);

  /** Apart from the viewport, so panning doesn't walk every note. */
  const notes = $derived(notesBounds(store.notes, widthOf, heightOf));

  /** World bounds of all notes plus the viewport, so the view box never leaves the map. */
  const bounds = $derived.by(() => {
    let { minX, minY, maxX, maxY } = notes;
    const vx0 = -vp.x / vp.zoom,
      vy0 = -vp.y / vp.zoom;
    minX = Math.min(minX, vx0) - PAD;
    minY = Math.min(minY, vy0) - PAD;
    maxX = Math.max(maxX, vx0 + viewW / vp.zoom) + PAD;
    maxY = Math.max(maxY, vy0 + viewH / vp.zoom) + PAD;
    const scale = Math.min(W / (maxX - minX), H / (maxY - minY));
    // Centre the drawing inside the map.
    const ox = (W - (maxX - minX) * scale) / 2;
    const oy = (H - (maxY - minY) * scale) / 2;
    return { minX, minY, scale, ox, oy };
  });

  const toMap = (x: number, y: number) => ({
    x: bounds.ox + (x - bounds.minX) * bounds.scale,
    y: bounds.oy + (y - bounds.minY) * bounds.scale,
  });

  /** Notes and edges are drawn in world units under one transform, so panning rewrites a single attribute. */
  const transform = $derived(`translate(${bounds.ox} ${bounds.oy}) scale(${bounds.scale}) translate(${-bounds.minX} ${-bounds.minY})`);
  /** Two map pixels, in world units: the smallest a note is drawn. */
  const minSize = $derived(2 / bounds.scale);

  /** Every edge in one path, the same beziers as the canvas. */
  const edges = $derived.by(() => {
    let d = "";
    for (const n of store.notes)
      for (const id of n.deps) {
        const s = store.byId(id);
        if (!s) continue;
        const a = { x: s.x + widthOf(s), y: s.y + heightOf(s.id) / 2 };
        const b = { x: n.x, y: n.y + heightOf(n.id) / 2 };
        const dx = edgeHandle(a, b);
        d += `M${a.x} ${a.y}C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`;
      }
    return d;
  });

  const view = $derived.by(() => {
    const a = toMap(-vp.x / vp.zoom, -vp.y / vp.zoom);
    return { x: a.x, y: a.y, w: (viewW / vp.zoom) * bounds.scale, h: (viewH / vp.zoom) * bounds.scale };
  });

  /** Centre the viewport on the map point under the pointer. */
  function panTo(e: PointerEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const wx = bounds.minX + (e.clientX - r.left - bounds.ox) / bounds.scale;
    const wy = bounds.minY + (e.clientY - r.top - bounds.oy) / bounds.scale;
    vp.x = viewW / 2 - wx * vp.zoom;
    vp.y = viewH / 2 - wy * vp.zoom;
  }

  function onDown(e: PointerEvent) {
    e.stopPropagation();
    dragging = true;
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    panTo(e);
  }
  function onMove(e: PointerEvent) {
    if (dragging) panTo(e);
  }
  function onUp(e: PointerEvent) {
    e.stopPropagation();
    if (!dragging) return;
    dragging = false;
    store.saveViewport();
  }
</script>

<!-- Swallow pointer events so the canvas underneath doesn't pan or create notes. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="minimap" class:collapsed onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()}>
  {#if !isMobile}
    <button
      class="ghost toggle"
      onclick={toggleMinimap}
      title={t(collapsed ? "minimap.show" : "minimap.hide")}
      aria-label={t("minimap.toggle")}
    >
      {#if collapsed}<MapTrifold size={ICON} />{:else}<CaretDown size={ICON} />{/if}
    </button>
  {/if}
  {#if !collapsed}
    <svg width={W} height={H} onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp} role="presentation">
      <g {transform}>
        <path class="edges" d={edges} />
        {#each store.notes as n (n.id)}
          <rect
            x={n.x}
            y={n.y}
            width={Math.max(minSize, widthOf(n))}
            height={Math.max(minSize, heightOf(n.id))}
            rx={minSize / 2}
            class="node"
            class:selected={store.selectedId === n.id || (store.multi.length > 1 && store.multi.includes(n.id))}
            class:done={store.isDone(n)}
          />
        {/each}
      </g>
      <rect class="view" x={view.x} y={view.y} width={view.w} height={view.h} />
    </svg>
  {/if}
</div>

<style>
  .minimap {
    position: absolute;
    z-index: 3;
    right: 12px;
    bottom: 12px;
    background: var(--bg2);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
  }
  .minimap.collapsed {
    background: transparent;
    box-shadow: none;
  }
  .toggle {
    position: absolute;
    top: 2px;
    right: 2px;
    padding: 2px 4px;
    z-index: 1;
    opacity: 0.5;
  }
  .collapsed .toggle {
    position: static;
    opacity: 0.7;
    background: var(--bg2);
    box-shadow: var(--shadow);
  }
  .minimap:hover .toggle {
    opacity: 1;
  }
  svg {
    display: block;
    cursor: pointer;
  }
  .edges {
    fill: none;
    stroke: #333;
    stroke-width: 0.75;
    vector-effect: non-scaling-stroke;
  }
  .node {
    fill: #3a3a3a;
  }
  .node.done {
    fill: #262626;
  }
  .node.selected {
    fill: var(--accent2);
  }
  .view {
    fill: #8a2aa214;
    stroke: var(--accent2);
    stroke-width: 1;
    pointer-events: none;
  }
</style>
