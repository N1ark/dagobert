<script lang="ts">
  import { setContext, untrack, type Component, type Snippet } from "svelte";
  import { fade } from "svelte/transition";
  import { TILES, layout, saveLayout, setLayout, type TilesHandle } from "./panes.svelte";
  import {
    POPUP,
    arrange,
    dropAt,
    moves,
    place,
    previewOf,
    resize,
    visible,
    type Drop,
    type Handle,
    type Id,
    type Pane,
    type Rect,
  } from "./tiles";
  import Dock from "./Dock.svelte";
  import { menu } from "purr";
  import { t, type Key } from "./i18n";
  import { ArrowLineLeft, ArrowLineRight, ArrowLineUp, ArrowLineDown, AppWindow } from "purr/icons";

  /** The canvas and the open panels, tiled; a panel is dragged by its header to any side of any tile. */
  let {
    open,
    children,
    pane,
    onclose,
    onshift,
  }: {
    open: Pane[];
    /** The canvas. */
    children: Snippet;
    pane: Snippet<[Pane]>;
    onclose: (p: Pane) => void;
    /** The canvas's corner moved by (dx, dy) on screen, other than by a panel moving. */
    onshift: (dx: number, dy: number) => void;
  } = $props();

  let el = $state<HTMLDivElement | null>(null);
  let w = $state(0);
  let h = $state(0);

  const isOpen = (id: Id) => id === "canvas" || open.includes(id);
  const arranged = $derived(arrange(visible(layout.tree, isOpen)!, { x: 0, y: 0, w, h }));
  const rectOf = (id: Id) => (layout.popups.includes(id as Pane) ? null : (arranged.rects.get(id) ?? null));
  const at = (r: Rect) => `left:${r.x}px; top:${r.y}px; width:${r.w}px; height:${r.h}px`;

  let moved = false;
  function move(p: Pane, d: Drop) {
    moved = true;
    setLayout(place($state.snapshot(layout), p, d, isOpen));
  }

  // The graph stays put on screen as panels open, close or resize; a panel moving isn't that.
  let before: Rect | null = null;
  $effect(() => {
    const c = arranged.rects.get("canvas");
    if (!c || !w || !h) return;
    untrack(() => {
      if (before && !moved && (c.x !== before.x || c.y !== before.y)) onshift(c.x - before.x, c.y - before.y);
    });
    before = c;
    moved = false;
  });

  let drag: { pane: Pane; id: number; x: number; y: number; box: DOMRect } | null = null;
  let drop = $state.raw<Drop | null>(null);
  /** Past the threshold, whether or not it's over somewhere the pane would move to. */
  let moving = $state(false);
  /** A drag on the dock button ends in a click, which isn't a request for the menu. */
  let dragged = false;

  let sizing = $state.raw<{ id: number; h: Handle; at: number; total: number } | null>(null);

  function grab(e: PointerEvent, p: Pane) {
    if (e.button !== 0 || !el) return;
    e.preventDefault(); // otherwise the drag also starts a text selection
    dragged = false;
    drag = { pane: p, id: e.pointerId, x: e.clientX, y: e.clientY, box: el.getBoundingClientRect() };
  }

  function sizeDown(e: PointerEvent, hd: Handle) {
    if (e.button !== 0) return;
    e.preventDefault();
    sizing = { id: e.pointerId, h: hd, at: hd.row ? e.clientX : e.clientY, total: hd.a.size + hd.b.size };
  }

  function onMove(e: PointerEvent) {
    if (sizing && e.pointerId === sizing.id) {
      resize(sizing.h, (sizing.h.row ? e.clientX : e.clientY) - sizing.at, sizing.total);
    } else if (drag && e.pointerId === drag.id) {
      if (!moving && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      dragged = moving = true;
      const d = dropAt(e.clientX - drag.box.left, e.clientY - drag.box.top, w, h, arranged.rects, drag.pane);
      drop = d && moves($state.snapshot(layout), drag.pane, d, isOpen) ? d : null;
    }
  }

  function onUp(e: PointerEvent) {
    if (sizing && e.pointerId === sizing.id) {
      sizing = null;
      saveLayout();
    } else if (drag && e.pointerId === drag.id) {
      if (drop) move(drag.pane, drop);
      drag = null;
      drop = null;
      moving = false;
    }
  }

  $effect(() => {
    if (!sizing && !moving) return;
    const b = document.body;
    b.classList.add("tiles-dragging");
    b.style.cursor = moving ? "grabbing" : sizing!.h.row ? "col-resize" : "row-resize";
    return () => {
      b.classList.remove("tiles-dragging");
      b.style.cursor = "";
    };
  });

  /** Where the dragged pane would land, in the window's coordinates. */
  const preview = $derived.by(() => {
    if (!drop || !drag) return null;
    if (drop === "popup") {
      const s = POPUP[drag.pane];
      const pw = Math.min(s.w, innerWidth - 40);
      const ph = Math.min(s.h, innerHeight - 80);
      return { x: (innerWidth - pw) / 2, y: (innerHeight - ph) / 2, w: pw, h: ph };
    }
    const r = previewOf(drop, w, h, arranged.rects);
    return { ...r, x: r.x + drag.box.left, y: r.y + drag.box.top };
  });

  const PLACES: { drop: Drop; label: Key; icon: Component }[] = [
    { drop: { side: "left", at: null }, label: "dock.left", icon: ArrowLineLeft },
    { drop: { side: "right", at: null }, label: "dock.right", icon: ArrowLineRight },
    { drop: { side: "top", at: null }, label: "dock.top", icon: ArrowLineUp },
    { drop: { side: "bottom", at: null }, label: "dock.bottom", icon: ArrowLineDown },
    { drop: "popup", label: "dock.popup", icon: AppWindow },
  ];

  const handle: TilesHandle = {
    grab,
    toggle(button, p) {
      if (dragged) dragged = false;
      else if (menu.open && menu.anchor === button) menu.close();
      else
        menu.showFor(
          button,
          PLACES.map((it) => ({
            label: t(it.label),
            icon: it.icon,
            checked: it.drop === "popup" ? layout.popups.includes(p) : undefined,
            run: () => move(p, it.drop),
          })),
        );
    },
  };
  setContext(TILES, handle);
</script>

<svelte:window onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp} />

<div class="main" bind:this={el} bind:clientWidth={w} bind:clientHeight={h}>
  <div class="tile" style={at(arranged.rects.get("canvas") ?? { x: 0, y: 0, w, h })}>{@render children()}</div>
  {#each open as p (p)}
    <Dock pane={p} rect={rectOf(p)} onclose={() => onclose(p)}>{@render pane(p)}</Dock>
  {/each}
  {#each arranged.handles as hd, i (i)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="resizer"
      class:row={hd.row}
      class:active={sizing?.h.a.src === hd.a.src && sizing?.h.b.src === hd.b.src}
      style={at(hd.rect)}
      onpointerdown={(e) => sizeDown(e, hd)}
    ></div>
  {/each}
</div>

{#if preview}
  <div class="drop" style={at(preview)} transition:fade={{ duration: 100 }}></div>
{/if}

<style>
  .main {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    background: var(--border);
  }
  .tile {
    position: absolute;
    display: flex;
  }
  .resizer {
    position: absolute;
    z-index: var(--z-resize);
    transition: background var(--dur);
  }
  .resizer.row {
    cursor: col-resize;
    margin-left: -2px;
    padding: 0 2px;
  }
  .resizer:not(.row) {
    cursor: row-resize;
    margin-top: -2px;
    padding: 2px 0;
  }
  .resizer:hover,
  .resizer.active {
    background: var(--theme);
  }
  .drop {
    position: fixed;
    z-index: var(--z-menu);
    pointer-events: none;
    border: 2px solid var(--theme);
    border-radius: var(--radius-lg);
    background: var(--theme-soft);
    transition:
      left var(--dur) var(--ease),
      top var(--dur) var(--ease),
      width var(--dur) var(--ease),
      height var(--dur) var(--ease);
  }
  :global(body.tiles-dragging) {
    -webkit-user-select: none;
    user-select: none;
  }
</style>
