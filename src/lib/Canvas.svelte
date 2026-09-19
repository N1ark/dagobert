<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "./store.svelte";
  import NodeCard from "./NodeCard.svelte";
  import ContextMenu, { type MenuTarget } from "./ContextMenu.svelte";
  import type { Note } from "./types";
  import { layout } from "./layout";
  import Minimap from "./Minimap.svelte";

  let { matches = null, focus = true }: { matches?: Set<string> | null; focus?: boolean } = $props();

  const NODE_W = 220;
  const MIN_W = 140;
  const MAX_W = 640;

  function widthOf(n: { width?: number | null }) {
    return n.width ?? NODE_W;
  }
  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 2.5;

  let container: HTMLDivElement;
  // Canvas size in screen px (for the minimap's viewport rectangle).
  let viewW = $state(0);
  let viewH = $state(0);
  let heights = $state<Record<string, number>>({});
  let selectedEdge = $state<{ from: string; to: string } | null>(null);
  let linking = $state<{ from: string; x: number; y: number; over: string | null } | null>(null);
  let isPanning = $state(false);
  let menu = $state<{ x: number; y: number; target: MenuTarget } | null>(null);
  // Last pointer position over the canvas (screen coords), for paste placement.
  let lastPointer: { x: number; y: number } | null = null;

  // Pointer interaction state (not reactive on purpose).
  let drag: {
    clicked: string;
    ids: string[];
    startX: number;
    startY: number;
    origins: Map<string, { x: number; y: number }>;
    moved: boolean;
  } | null = null;
  /** Shift+drag rubber band, in screen coords relative to the container. */
  let marquee = $state<{ x0: number; y0: number; x1: number; y1: number; base: string[] } | null>(null);
  let pan: { startX: number; startY: number; vx: number; vy: number } | null = null;
  let resize: { id: string; startX: number; ow: number; moved: boolean } | null = null;

  const vp = $derived(store.viewport);

  /** The selected node plus everything upstream and downstream of it. */
  const chain = $derived.by(() => {
    if (!focus || !store.selectedId || store.multi.length > 1) return null;
    const set = new Set<string>([store.selectedId]);
    const up = [store.selectedId];
    while (up.length) {
      const n = store.byId(up.pop()!);
      for (const d of n?.deps ?? [])
        if (!set.has(d)) {
          set.add(d);
          up.push(d);
        }
    }
    const down = [store.selectedId];
    while (down.length) {
      const id = down.pop()!;
      for (const n of store.notes)
        if (n.deps.includes(id) && !set.has(n.id)) {
          set.add(n.id);
          down.push(n.id);
        }
    }
    return set;
  });

  /** Search/tag filter wins; otherwise the focus chain; null = nothing dimmed. */
  const visible = $derived(matches ?? chain);
  const softDim = $derived(matches === null && chain !== null);

  const edges = $derived.by(() => {
    const out: { from: string; to: string; d: string; dim: boolean; chain: boolean }[] = [];
    for (const n of store.notes) {
      for (const dep of n.deps) {
        const s = store.byId(dep);
        if (!s) continue;
        const inSet = visible === null || (visible.has(dep) && visible.has(n.id));
        out.push({
          from: dep,
          to: n.id,
          d: path(rightOf(s), leftOf(n)),
          dim: !inSet,
          chain: chain !== null && inSet && matches === null,
        });
      }
    }
    return out;
  });

  function h(id: string) {
    return heights[id] || 60;
  }
  function rightOf(n: Note) {
    return { x: n.x + widthOf(n), y: n.y + h(n.id) / 2 };
  }
  function leftOf(n: Note) {
    return { x: n.x, y: n.y + h(n.id) / 2 };
  }
  function path(a: { x: number; y: number }, b: { x: number; y: number }) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }

  function toWorld(sx: number, sy: number) {
    const r = container.getBoundingClientRect();
    return { x: (sx - r.left - vp.x) / vp.zoom, y: (sy - r.top - vp.y) / vp.zoom };
  }

  /** Centre the viewport on a note. */
  export function focusNode(id: string) {
    const n = store.byId(id);
    if (!n) return;
    const r = container.getBoundingClientRect();
    vp.x = r.width / 2 - (n.x + widthOf(n) / 2) * vp.zoom;
    vp.y = r.height / 2 - (n.y + h(id) / 2) * vp.zoom;
    store.saveViewport();
  }

  /** Pan just enough that the note is fully on screen (with a margin). */
  export function ensureVisible(id: string) {
    const n = store.byId(id);
    if (!n) return;
    const r = container.getBoundingClientRect();
    const m = 40;
    const left = n.x * vp.zoom + vp.x;
    const top = n.y * vp.zoom + vp.y;
    const right = left + widthOf(n) * vp.zoom;
    const bottom = top + h(id) * vp.zoom;
    let dx = 0,
      dy = 0;
    if (left < m) dx = m - left;
    else if (right > r.width - m) dx = r.width - m - right;
    if (top < m) dy = m - top;
    else if (bottom > r.height - m) dy = r.height - m - bottom;
    if (!dx && !dy) return;
    vp.x += dx;
    vp.y += dy;
    store.saveViewport();
  }

  // ---- keyboard navigation -------------------------------------------------

  function centerOf(n: Note) {
    return { x: n.x + widthOf(n) / 2, y: n.y + h(n.id) / 2 };
  }

  /** Of `candidates`, the one whose centre is closest in y to `from`. */
  function closestByY(from: Note, candidates: Note[]): Note | null {
    const cy = centerOf(from).y;
    let best: Note | null = null,
      bestD = Infinity;
    for (const c of candidates) {
      const d = Math.abs(centerOf(c).y - cy);
      if (d < bestD) ((best = c), (bestD = d));
    }
    return best;
  }

  /** Nearest node strictly above/below; overlapping x ranges are preferred. */
  function verticalNeighbour(from: Note, dir: -1 | 1): Note | null {
    const c = centerOf(from);
    let best: Note | null = null,
      bestScore = Infinity;
    for (const n of store.notes) {
      if (n.id === from.id) continue;
      const nc = centerOf(n);
      if ((nc.y - c.y) * dir <= 0) continue;
      const overlaps = n.x < from.x + widthOf(from) && n.x + widthOf(n) > from.x;
      // Overlapping columns score by vertical distance; others pay a penalty.
      const score = Math.abs(nc.y - c.y) + (overlaps ? 0 : 100000 + Math.abs(nc.x - c.x));
      if (score < bestScore) ((best = n), (bestScore = score));
    }
    return best;
  }

  /** Node nearest the viewport centre. */
  function nearestToCenter(): Note | null {
    const r = container.getBoundingClientRect();
    const w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    let best: Note | null = null,
      bestD = Infinity;
    for (const n of store.notes) {
      const c = centerOf(n);
      const d = Math.hypot(c.x - w.x, c.y - w.y);
      if (d < bestD) ((best = n), (bestD = d));
    }
    return best;
  }

  function go(n: Note | null) {
    if (!n) return;
    store.select(n.id);
    selectedEdge = null;
    ensureVisible(n.id);
  }

  /** Arrow/Tab navigation between nodes. Returns true when handled. */
  function navigate(e: KeyboardEvent): boolean {
    const cur = store.selectedId ? store.byId(store.selectedId) : null;
    const byY = (a: Note, b: Note) => centerOf(a).y - centerOf(b).y;
    if (!cur) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        go(nearestToCenter());
        return true;
      }
      return false;
    }
    switch (e.key) {
      case "ArrowLeft":
        go(closestByY(cur, store.dependencies(cur.id)));
        return true;
      case "ArrowRight":
        go(closestByY(cur, store.dependents(cur.id)));
        return true;
      case "ArrowUp":
        go(verticalNeighbour(cur, -1));
        return true;
      case "ArrowDown":
        go(verticalNeighbour(cur, 1));
        return true;
      case "Tab": {
        // Cycle through dependents (⇧: dependencies) in vertical order.
        const list = (e.shiftKey ? store.dependencies(cur.id) : store.dependents(cur.id)).sort(byY);
        if (!list.length) return true;
        const cy = centerOf(cur).y;
        const i = list.findIndex((n) => centerOf(n).y > cy);
        go(list[i === -1 ? 0 : i]);
        return true;
      }
      case "Enter":
        store.focusTitle++;
        return true;
    }
    return false;
  }

  /** Create a note at the centre of the current view. */
  export function createAtCenter() {
    const r = container.getBoundingClientRect();
    const w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    createAt(w.x - NODE_W / 2 + (Math.random() - 0.5) * 40, w.y - 30 + (Math.random() - 0.5) * 40);
  }

  function createAt(x: number, y: number) {
    const n = store.create(Math.round(x), Math.round(y));
    store.select(n.id);
    selectedEdge = null;
  }

  export function fitAll() {
    if (!store.notes.length) return;
    const r = container.getBoundingClientRect();
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of store.notes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + widthOf(n));
      maxY = Math.max(maxY, n.y + h(n.id));
    }
    const pad = 60;
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY), 1)),
    );
    vp.zoom = zoom;
    vp.x = (r.width - (maxX - minX) * zoom) / 2 - minX * zoom;
    vp.y = (r.height - (maxY - minY) * zoom) / 2 - minY * zoom;
    store.saveViewport();
  }

  /**
   * Auto-layout. With a multi-selection, only that subgraph is tidied,
   * anchored at its current top-left; otherwise everything is.
   */
  export function tidy() {
    const subset = store.multi.length > 1 ? store.notes.filter((n) => store.multi.includes(n.id)) : store.notes;
    if (!subset.length) return;
    const ids = new Set(subset.map((n) => n.id));
    const originX = Math.min(...subset.map((n) => n.x));
    const originY = Math.min(...subset.map((n) => n.y));
    const positions = layout(
      subset.map((n) => ({ id: n.id, deps: n.deps.filter((d) => ids.has(d)), width: widthOf(n), height: h(n.id) })),
      { originX, originY },
    );
    for (const n of subset) {
      const p = positions.get(n.id);
      if (!p || (p.x === n.x && p.y === n.y)) continue;
      n.x = p.x;
      n.y = p.y;
      store.touch(n.id, { immediate: true, silent: true, label: "tidy" });
    }
    fitAll();
  }

  // ---- pointer handling ----------------------------------------------------

  function nodeIdAt(el: EventTarget | null): string | null {
    return (el as HTMLElement | null)?.closest?.("[data-node]")?.getAttribute("data-node") ?? null;
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, a")) return; // links: let the click through (no capture)
    const id = nodeIdAt(target);
    container.setPointerCapture(e.pointerId);

    if (id && target.closest("[data-resize]")) {
      resize = { id, startX: e.clientX, ow: widthOf(store.byId(id)!), moved: false };
      return;
    }
    if (id && target.closest("[data-port]")) {
      const w = toWorld(e.clientX, e.clientY);
      linking = { from: id, x: w.x, y: w.y, over: null };
      return;
    }
    if (id) {
      if (e.shiftKey) {
        // Toggle membership; don't start a drag.
        store.multi = store.multi.includes(id) ? store.multi.filter((x) => x !== id) : [...store.multi, id];
        if (store.multi.includes(id) && store.selectedId !== id) {
          store.selectedId = id;
          const n = store.byId(id);
          if (n) store.touch(id, { immediate: true, silent: true });
        }
        return;
      }
      // Dragging a node in the group moves the whole group.
      const ids = store.multi.includes(id) ? store.multi : [id];
      const origins = new Map<string, { x: number; y: number }>();
      for (const gid of ids) {
        const n = store.byId(gid);
        if (n) origins.set(gid, { x: n.x, y: n.y });
      }
      drag = { clicked: id, ids, startX: e.clientX, startY: e.clientY, origins, moved: false };
      return;
    }
    if (target.closest("[data-edge]")) return; // handled by edge click
    if (e.shiftKey) {
      const r = container.getBoundingClientRect();
      marquee = { x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top, base: store.multi };
      return;
    }
    pan = { startX: e.clientX, startY: e.clientY, vx: vp.x, vy: vp.y };
    isPanning = true;
  }

  function onPointerMove(e: PointerEvent) {
    lastPointer = { x: e.clientX, y: e.clientY };
    if (linking) {
      const w = toWorld(e.clientX, e.clientY);
      linking.x = w.x;
      linking.y = w.y;
      const over = nodeIdAt(document.elementFromPoint(e.clientX, e.clientY));
      linking.over = over && over !== linking.from ? over : null;
      return;
    }
    if (resize) {
      const n = store.byId(resize.id);
      if (n) {
        const w = Math.round(Math.max(MIN_W, Math.min(MAX_W, resize.ow + (e.clientX - resize.startX) / vp.zoom)));
        if (w !== widthOf(n)) {
          n.width = w;
          resize.moved = true;
        }
      }
      return;
    }
    if (marquee) {
      const r = container.getBoundingClientRect();
      marquee.x1 = e.clientX - r.left;
      marquee.y1 = e.clientY - r.top;
      // Live-select everything the rectangle touches (plus what was selected before).
      const a = toWorld(Math.min(marquee.x0, marquee.x1) + r.left, Math.min(marquee.y0, marquee.y1) + r.top);
      const b = toWorld(Math.max(marquee.x0, marquee.x1) + r.left, Math.max(marquee.y0, marquee.y1) + r.top);
      const hit = store.notes.filter((n) => n.x < b.x && n.x + widthOf(n) > a.x && n.y < b.y && n.y + h(n.id) > a.y).map((n) => n.id);
      store.multi = [...new Set([...marquee.base, ...hit])];
      return;
    }
    if (drag) {
      const dx = (e.clientX - drag.startX) / vp.zoom;
      const dy = (e.clientY - drag.startY) / vp.zoom;
      if (!drag.moved && Math.hypot(dx, dy) * vp.zoom < 3) return;
      drag.moved = true;
      for (const [id, o] of drag.origins) {
        const n = store.byId(id);
        if (n) {
          n.x = Math.round(o.x + dx);
          n.y = Math.round(o.y + dy);
        }
      }
      return;
    }
    if (pan) {
      vp.x = pan.vx + (e.clientX - pan.startX);
      vp.y = pan.vy + (e.clientY - pan.startY);
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (resize) {
      if (resize.moved) store.touch(resize.id, { immediate: true, silent: true, label: "resize" });
      resize = null;
      return;
    }
    if (linking) {
      if (linking.over) store.addDependency(linking.over, linking.from);
      linking = null;
      return;
    }
    if (marquee) {
      marquee = null;
      return;
    }
    if (drag) {
      if (drag.moved) {
        for (const id of drag.ids) store.touch(id, { immediate: true, silent: true, label: "move" });
      } else {
        const group = drag.ids;
        store.select(drag.clicked);
        if (group.length > 1) store.multi = group; // a plain click inside a group keeps it
        selectedEdge = null;
      }
      drag = null;
      return;
    }
    if (pan) {
      const moved = Math.hypot(e.clientX - pan.startX, e.clientY - pan.startY) > 3;
      if (moved) store.saveViewport();
      else {
        store.select(null);
        selectedEdge = null;
      }
      pan = null;
      isPanning = false;
    }
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const id = nodeIdAt(target);
    let t: MenuTarget;
    if (id) {
      if (store.multi.length > 1 && store.multi.includes(id)) t = { kind: "group", ids: [...store.multi] };
      else {
        if (!store.multi.includes(id)) store.select(id);
        t = { kind: "node", id };
      }
    } else {
      const edgeEl = target.closest("[data-edge]") as HTMLElement | null;
      if (edgeEl) {
        t = { kind: "edge", from: edgeEl.dataset.from!, to: edgeEl.dataset.to! };
      } else {
        const w = toWorld(e.clientX, e.clientY);
        t = { kind: "background", wx: w.x - NODE_W / 2, wy: w.y - 20 };
      }
    }
    menu = { x: e.clientX, y: e.clientY, target: t };
  }

  function onDblClick(e: MouseEvent) {
    // Pointer capture (set on pointerdown) makes the browser target the
    // container, not what's under the cursor — hit-test by position instead.
    const target = (document.elementFromPoint(e.clientX, e.clientY) ?? e.target) as HTMLElement;
    const id = nodeIdAt(target);
    if (id) {
      // Double-clicking a node opens it in its own window (not a control inside it).
      if (target.closest("button, input, textarea, a, [data-port], [data-resize]")) return;
      store.openInWindow(id);
      return;
    }
    if (target.closest("[data-edge]")) return;
    const w = toWorld(e.clientX, e.clientY);
    createAt(w.x - NODE_W / 2, w.y - 20);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.01);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor));
      const r = container.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      // Keep the point under the cursor fixed.
      vp.x = mx - ((mx - vp.x) / vp.zoom) * zoom;
      vp.y = my - ((my - vp.y) / vp.zoom) * zoom;
      vp.zoom = zoom;
    } else {
      vp.x -= e.deltaX;
      vp.y -= e.deltaY;
    }
    store.saveViewport();
  }

  /** Where a pasted note should land: under the cursor if it's over the canvas, else view centre. */
  function pasteTarget() {
    const r = container.getBoundingClientRect();
    const inside =
      lastPointer && lastPointer.x >= r.left && lastPointer.x <= r.right && lastPointer.y >= r.top && lastPointer.y <= r.bottom;
    const p = inside ? lastPointer! : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const w = toWorld(p.x, p.y);
    return { x: w.x - NODE_W / 2, y: w.y - 20 };
  }

  function pasteHere() {
    const t = pasteTarget();
    const n = store.paste(t.x, t.y);
    if (n) store.select(n.id);
  }

  function duplicateSelected() {
    if (!store.selectedId) return;
    const n = store.duplicate(store.selectedId);
    if (n) store.select(n.id);
  }

  function onKeyDown(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, [contenteditable]")) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      store.multi = store.notes.map((n) => n.id);
      return;
    }
    if (mod && e.key.toLowerCase() === "c" && store.selectedId && !window.getSelection()?.toString()) {
      e.preventDefault();
      store.copy(store.selectedId);
      return;
    }
    if (mod && e.key.toLowerCase() === "v" && store.clipboard) {
      e.preventDefault();
      pasteHere();
      return;
    }
    if (mod && e.key.toLowerCase() === "d" && store.selectedId) {
      e.preventDefault();
      duplicateSelected();
      return;
    }
    if (!mod && !e.altKey && navigate(e)) {
      e.preventDefault();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selectedEdge) {
      store.removeDependency(selectedEdge.to, selectedEdge.from);
      selectedEdge = null;
    } else if (e.key === "Escape") {
      store.select(null);
      selectedEdge = null;
    }
  }

  onMount(() => {
    container.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  const linkPath = $derived.by(() => {
    if (!linking) return "";
    const s = store.byId(linking.from);
    if (!s) return "";
    const a = rightOf(s);
    const b = linking.over ? leftOf(store.byId(linking.over)!) : { x: linking.x, y: linking.y };
    return path(a, b);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="canvas"
  class:panning={isPanning}
  class:linking={!!linking}
  class:soft-dim={softDim}
  bind:this={container}
  bind:clientWidth={viewW}
  bind:clientHeight={viewH}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  ondblclick={onDblClick}
  oncontextmenu={onContextMenu}
  style="--vx:{vp.x}px; --vy:{vp.y}px; --zoom:{vp.zoom}"
>
  <div class="grid"></div>
  <div class="world">
    <svg class="edges" overflow="visible">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#555" />
        </marker>
        <marker id="arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#b045ab" />
        </marker>
      </defs>
      {#each edges as edge (edge.from + ">" + edge.to)}
        {@const sel = selectedEdge?.from === edge.from && selectedEdge?.to === edge.to}
        {@const near = edge.chain || store.selectedId === edge.from || store.selectedId === edge.to}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <g
          class="edge"
          class:sel
          class:near
          class:dim={edge.dim}
          data-edge
          data-from={edge.from}
          data-to={edge.to}
          role="button"
          tabindex="-1"
          onclick={(e) => {
            e.stopPropagation();
            selectedEdge = { from: edge.from, to: edge.to };
            store.select(null);
          }}
          ondblclick={(e) => {
            e.stopPropagation();
            store.removeDependency(edge.to, edge.from);
            selectedEdge = null;
          }}
        >
          <path class="hit" d={edge.d} />
          <path class="line" d={edge.d} marker-end={sel || near ? "url(#arrow-sel)" : "url(#arrow)"} />
        </g>
      {/each}
      {#if linking}
        <path class="link-preview" d={linkPath} marker-end="url(#arrow-sel)" />
      {/if}
    </svg>

    {#each store.notes as note (note.id)}
      <NodeCard
        {note}
        width={widthOf(note)}
        selected={store.selectedId === note.id}
        grouped={store.multi.length > 1 && store.multi.includes(note.id)}
        dim={visible !== null && !visible.has(note.id)}
        linkTarget={linking?.over === note.id}
        onresize={(h) => (heights[note.id] = h)}
      />
    {/each}
  </div>

  {#if marquee}
    <div
      class="marquee"
      style="left:{Math.min(marquee.x0, marquee.x1)}px; top:{Math.min(marquee.y0, marquee.y1)}px; width:{Math.abs(
        marquee.x1 - marquee.x0,
      )}px; height:{Math.abs(marquee.y1 - marquee.y0)}px"
    ></div>
  {/if}

  {#if store.notes.length > 1}
    <Minimap {widthOf} heightOf={h} {viewW} {viewH} />
  {/if}

  {#if menu}
    <ContextMenu
      x={menu.x}
      y={menu.y}
      target={menu.target}
      onclose={() => (menu = null)}
      oncreate={createAt}
      onpaste={(wx, wy) => {
        const n = store.paste(wx, wy);
        if (n) store.select(n.id);
      }}
    />
  {/if}

  {#if !store.notes.length}
    <div class="empty">
      <p>Double-click anywhere to create a note.</p>
      <p class="sub">Drag from a note's <span class="dot"></span> handle onto another note to make that one depend on it.</p>
      <p class="sub">Arrow keys walk the graph (← dependencies, → dependents), Enter edits the title.</p>
    </div>
  {/if}
</div>

<style>
  .canvas {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    cursor: default;
    touch-action: none;
  }
  .canvas.panning {
    cursor: grabbing;
  }
  .canvas.linking {
    cursor: crosshair;
  }
  .canvas.linking :global(.node) {
    cursor: crosshair;
  }
  .grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: radial-gradient(#ffffff12 1px, transparent 1px);
    background-size: calc(24px * var(--zoom)) calc(24px * var(--zoom));
    background-position: var(--vx) var(--vy);
  }
  .world {
    position: absolute;
    left: 0;
    top: 0;
    transform: translate(var(--vx), var(--vy)) scale(var(--zoom));
    transform-origin: 0 0;
  }
  .edges {
    position: absolute;
    left: 0;
    top: 0;
    width: 1px;
    height: 1px;
    overflow: visible;
    pointer-events: none;
  }
  .edge {
    pointer-events: auto;
    cursor: pointer;
    outline: none;
  }
  .edge .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 14;
  }
  .edge .line {
    fill: none;
    stroke: #444;
    stroke-width: 1.5;
    transition:
      stroke 0.15s,
      opacity 0.15s;
  }
  .edge:hover .line,
  .edge.near .line {
    stroke: var(--accent2);
  }
  .edge.sel .line {
    stroke: var(--accent2);
    stroke-width: 2.5;
  }
  .edge.dim {
    opacity: 0.15;
  }
  /* Focus-chain dimming is gentler than search dimming. */
  .soft-dim .edge.dim {
    opacity: 0.3;
  }
  .soft-dim :global(.node.dim) {
    opacity: 0.3;
  }
  .link-preview {
    fill: none;
    stroke: var(--accent2);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
  }
  .marquee {
    position: absolute;
    pointer-events: none;
    border: 1px solid var(--accent2);
    background: #8a2aa21a;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #555;
    pointer-events: none;
    text-align: center;
  }
  .empty p {
    margin: 4px 0;
  }
  .empty .sub {
    font-size: 12px;
  }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid #555;
    vertical-align: middle;
  }
</style>
