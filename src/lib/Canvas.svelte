<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "./store.svelte";
  import { isMobile } from "./backend";
  import NodeCard from "./NodeCard.svelte";
  import ContextMenu, { type MenuTarget } from "./ContextMenu.svelte";
  import type { Note } from "./types";
  import { layout } from "./layout";
  import Minimap from "./Minimap.svelte";
  import { WORLD, clampViewport, clampNode } from "./viewport";
  import Grain, { type Rect, type Curve } from "./Grain.svelte";
  import { t } from "./i18n";
  import { keys, matches as pressed } from "./keys";

  let { matches = null, focus = true, grain = true }: { matches?: Set<string> | null; focus?: boolean; grain?: boolean } = $props();

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
  /** Edge under the pointer, so it can be drawn last (see `orderedEdges`). */
  let hoveredEdge = $state<{ from: string; to: string } | null>(null);
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
  let pan: { startX: number; startY: number; vx: number; vy: number; touch: boolean } | null = null;
  let resize: { id: string; startX: number; ow: number; moved: boolean } | null = null;

  // ---- touch state ---------------------------------------------------------
  /** Live touch/pen pointers, for pinch-zoom and two-finger pan. */
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; cx: number; cy: number } | null = null;
  /** Container rect, read once per gesture: reading it per event forces layout. */
  let gestureRect: DOMRect | null = null;
  /** Latest pointer of a one-finger pan, applied once per frame (see `flushGesture`). */
  let panAt: { x: number; y: number } | null = null;
  let gestureRaf = 0;
  /**
   * A touch waiting to become something else. On a node, holding arms the drag
   * (a plain drag pans the canvas instead, so the graph scrolls); lifting
   * without moving opens the context menu, which is what a right-click does.
   */
  let hold: { timer: number; x: number; y: number; id: string | null; armed: boolean } | null = null;
  let lastTap: { at: number; x: number; y: number } | null = null;
  /** The node a long press has picked up, which draws it lifted off the canvas. */
  let lifted = $state<string | null>(null);
  const HOLD_MS = 450;
  const TAP_SLOP = 12;

  function cancelHold() {
    if (hold) clearTimeout(hold.timer);
    hold = null;
    lifted = null;
  }

  // ---- momentum ------------------------------------------------------------
  /** Recent pan positions, newest last, for the velocity a flick leaves behind. */
  let panTrail: { t: number; x: number; y: number }[] = [];
  /** A flick still running: screen px per ms, decayed every frame. */
  let glide: { vx: number; vy: number; at: number; x: number; y: number } | null = null;
  let glideRaf = 0;
  /** Halves the speed about every 150 ms, which is roughly how iOS lists coast. */
  const GLIDE_DECAY = 0.0046;
  const GLIDE_STOP = 0.02;

  function stopGlide() {
    glide = null;
    if (glideRaf) {
      cancelAnimationFrame(glideRaf);
      glideRaf = 0;
    }
  }

  /** Velocity over the last few pointer samples, in screen px per ms. */
  function flickVelocity() {
    const now = performance.now();
    const recent = panTrail.filter((s) => now - s.t < 90);
    if (recent.length < 2) return null;
    const a = recent[0];
    const b = recent[recent.length - 1];
    const dt = b.t - a.t;
    if (dt < 8) return null;
    const cap = (v: number) => Math.max(-4, Math.min(4, v));
    return { x: cap((b.x - a.x) / dt), y: cap((b.y - a.y) / dt) };
  }

  function stepGlide(now: number) {
    glideRaf = 0;
    if (!glide) return;
    // The viewport clamp can refuse the last frame's move; there is nothing to
    // coast into in that direction then.
    if (Math.abs(vp.x - glide.x) > 0.5) glide.vx = 0;
    if (Math.abs(vp.y - glide.y) > 0.5) glide.vy = 0;
    const dt = Math.min(48, now - glide.at);
    glide.at = now;
    const decay = Math.exp(-GLIDE_DECAY * dt);
    vp.x = glide.x = vp.x + glide.vx * dt;
    vp.y = glide.y = vp.y + glide.vy * dt;
    glide.vx *= decay;
    glide.vy *= decay;
    if (Math.hypot(glide.vx, glide.vy) < GLIDE_STOP) {
      glide = null;
      store.saveViewport();
      return;
    }
    glideRaf = requestAnimationFrame(stepGlide);
  }

  const vp = $derived(store.viewport);

  // Every writer (wheel, pan, minimap, fitAll, restore) goes through the same clamp so the
  // camera can never leave the world square. Pre-effect: the clamped value is what renders.
  $effect.pre(() => {
    if (!viewW || !viewH) return;
    const c = clampViewport(vp, viewW, viewH);
    if (c.x !== vp.x) vp.x = c.x;
    if (c.y !== vp.y) vp.y = c.y;
  });

  /** A node plus everything upstream and downstream of it. */
  function connected(id: string) {
    const set = new Set<string>([id]);
    const up = [id];
    while (up.length) {
      const n = store.byId(up.pop()!);
      for (const d of n?.deps ?? [])
        if (!set.has(d)) {
          set.add(d);
          up.push(d);
        }
    }
    const down = [id];
    while (down.length) {
      const cur = down.pop()!;
      for (const n of store.notes)
        if (n.deps.includes(cur) && !set.has(n.id)) {
          set.add(n.id);
          down.push(n.id);
        }
    }
    return set;
  }

  /** The selected node's chain, when focus mode should dim everything else. */
  const chain = $derived.by(() => {
    if (!focus || !store.selectedId || store.multi.length > 1) return null;
    return connected(store.selectedId);
  });

  /** Search/tag filter wins; otherwise the focus chain; null = nothing dimmed. */
  const visible = $derived(matches ?? chain);
  const softDim = $derived(matches === null && chain !== null);

  const edges = $derived.by(() => {
    const out: { from: string; to: string; d: string; head: string; dim: boolean; chain: boolean }[] = [];
    for (const n of store.notes) {
      for (const dep of n.deps) {
        const s = store.byId(dep);
        if (!s) continue;
        const inSet = visible === null || (visible.has(dep) && visible.has(n.id));
        out.push({
          from: dep,
          to: n.id,
          d: path(rightOf(s), leftOf(n)),
          head: head(leftOf(n)),
          dim: !inSet,
          chain: chain !== null && inSet && matches === null,
        });
      }
    }
    return out;
  });

  const sameEdge = (e: { from: string; to: string } | null, edge: { from: string; to: string }) =>
    e?.from === edge.from && e?.to === edge.to;
  const isNear = (edge: { from: string; to: string; chain: boolean }) =>
    edge.chain || store.selectedId === edge.from || store.selectedId === edge.to;

  const orderedEdges = $derived.by(() => {
    const top = (e: (typeof edges)[number]) => (sameEdge(hoveredEdge, e) ? 2 : isNear(e) || sameEdge(selectedEdge, e) ? 1 : 0);
    return edges
      .map((e, i) => ({ e, i }))
      .sort((a, b) => top(a.e) - top(b.e) || a.i - b.i)
      .map((x) => x.e);
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
  function handle(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.max(40, Math.abs(b.x - a.x) * 0.5);
  }
  /** The edge line. It stops inside the arrowhead so its square cap never pokes past the tip. */
  function path(a: { x: number; y: number }, b: { x: number; y: number }) {
    const dx = handle(a, b);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x - 5} ${b.y}`;
  }
  /**
   * Arrowhead at the end of an edge: a plain triangle path, not an SVG `<marker>`.
   * WebKit re-renders markers from scratch on every paint, and with a few hundred
   * edges on screen (zoomed out) that alone dropped panning to ~25 fps; plain paths
   * are essentially free. The curve always arrives horizontally (its last handle is
   * `(b.x - dx, b.y)`), so the head always points +x.
   */
  function head(b: { x: number; y: number }) {
    return `M ${b.x - 7} ${b.y - 3.5} L ${b.x} ${b.y} L ${b.x - 7} ${b.y + 3.5} z`;
  }

  /** World-space cubic beziers of every edge in the selected node's chain, for the grain flow. */
  const flowCurves = $derived.by((): Curve[] => {
    const id = store.selectedId;
    if (!id || store.multi.length > 1) return [];
    const out: Curve[] = [];
    const set = connected(id);
    for (const n of store.notes) {
      if (!set.has(n.id)) continue;
      for (const d of n.deps) {
        if (!set.has(d)) continue;
        const dep = store.byId(d);
        if (!dep) continue;
        const a = rightOf(dep);
        const b = leftOf(n);
        const dx = handle(a, b);
        out.push({ id: d + ">" + n.id, p0: a, p1: { x: a.x + dx, y: a.y }, p2: { x: b.x - dx, y: b.y }, p3: b });
      }
    }
    return out;
  });

  function toWorld(sx: number, sy: number) {
    const r = container.getBoundingClientRect();
    return { x: (sx - r.left - vp.x) / vp.zoom, y: (sy - r.top - vp.y) / vp.zoom };
  }

  /** Centre the viewport on a note. */
  export function focusNode(id: string) {
    const n = store.byId(id);
    if (!n) return;
    stopGlide();
    const r = container.getBoundingClientRect();
    vp.x = r.width / 2 - (n.x + widthOf(n) / 2) * vp.zoom;
    vp.y = r.height / 2 - (n.y + h(id) / 2) * vp.zoom;
    store.saveViewport();
  }

  /** Pan just enough that the note is fully on screen (with a margin). */
  export function ensureVisible(id: string) {
    const n = store.byId(id);
    if (!n) return;
    stopGlide();
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
      if (d < bestD) {
        best = c;
        bestD = d;
      }
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
      if (score < bestScore) {
        best = n;
        bestScore = score;
      }
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
      if (d < bestD) {
        best = n;
        bestD = d;
      }
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
    const arrows = ["nav-deps", "nav-dependents", "nav-up", "nav-down"] as const;
    if (!cur) {
      if (arrows.some((k) => pressed(keys[k], e))) {
        go(nearestToCenter());
        return true;
      }
      return false;
    }
    if (pressed(keys["nav-deps"], e)) go(closestByY(cur, store.dependencies(cur.id)));
    else if (pressed(keys["nav-dependents"], e)) go(closestByY(cur, store.dependents(cur.id)));
    else if (pressed(keys["nav-up"], e)) go(verticalNeighbour(cur, -1));
    else if (pressed(keys["nav-down"], e)) go(verticalNeighbour(cur, 1));
    else if (pressed(keys["nav-next"], e) || pressed(keys["nav-prev"], e)) {
      // Cycle through dependents (⇧: dependencies) in vertical order.
      const list = (pressed(keys["nav-prev"], e) ? store.dependencies(cur.id) : store.dependents(cur.id)).sort(byY);
      if (!list.length) return true;
      const cy = centerOf(cur).y;
      const i = list.findIndex((n) => centerOf(n).y > cy);
      go(list[i === -1 ? 0 : i]);
    } else if (pressed(keys["edit-title"], e)) store.focusTitle++;
    else return false;
    return true;
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
    stopGlide();
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
    stopGlide();
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, a")) return; // links: let the click through (no capture)
    const id = nodeIdAt(target);
    const touch = e.pointerType !== "mouse";
    if (touch) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // A second finger turns whatever was happening into a pinch.
      if (touches.size === 2) {
        cancelHold();
        drag = marquee = linking = resize = null;
        pan = null;
        isPanning = false;
        pinch = pinchFrom();
        gestureRect = container.getBoundingClientRect();
        return;
      }
      if (touches.size > 2) return;
    }
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
      if (touch) {
        startHold(e, id);
        pan = { startX: e.clientX, startY: e.clientY, vx: vp.x, vy: vp.y, touch };
        isPanning = true;
        panTrail = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
        return;
      }
      drag = startDrag(id, e);
      return;
    }
    if (target.closest("[data-edge]")) return; // handled by edge click
    if (e.shiftKey) {
      const r = container.getBoundingClientRect();
      marquee = { x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top, base: store.multi };
      return;
    }
    if (touch) startHold(e, null);
    pan = { startX: e.clientX, startY: e.clientY, vx: vp.x, vy: vp.y, touch };
    isPanning = true;
    panTrail = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
  }

  function startDrag(id: string, e: { clientX: number; clientY: number }) {
    const ids = store.multi.includes(id) ? store.multi : [id];
    const origins = new Map<string, { x: number; y: number }>();
    for (const gid of ids) {
      const n = store.byId(gid);
      if (n) origins.set(gid, { x: n.x, y: n.y });
    }
    return { clicked: id, ids, startX: e.clientX, startY: e.clientY, origins, moved: false };
  }

  /** Arms the long press: on a node it becomes a drag, on the background a menu. */
  function startHold(e: PointerEvent, id: string | null) {
    const { clientX: x, clientY: y } = e;
    const timer = window.setTimeout(() => {
      if (!hold) return;
      hold.armed = true;
      pan = null;
      isPanning = false;
      if (id) {
        if (store.selectedId !== id && !store.multi.includes(id)) store.select(id);
        drag = startDrag(id, { clientX: x, clientY: y });
        lifted = id;
      } else {
        openMenuAt(x, y, document.elementFromPoint(x, y) as HTMLElement | null);
        cancelHold();
      }
    }, HOLD_MS);
    hold = { timer, x, y, id, armed: false };
  }

  function pinchFrom() {
    const [a, b] = [...touches.values()];
    return { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  /**
   * Pointer-driven viewport changes are applied once per animation frame, for
   * the same reason `applyWheel` exists: WebKit re-flushes style and hit-tests
   * the world after each one, and a finger reports far faster than the display
   * refreshes.
   */
  function scheduleGesture() {
    gestureRaf ||= requestAnimationFrame(flushGesture);
  }

  function flushGesture() {
    gestureRaf = 0;
    if (pinch && touches.size >= 2) applyPinch();
    else if (pan && panAt) {
      vp.x = pan.vx + (panAt.x - pan.startX);
      vp.y = pan.vy + (panAt.y - pan.startY);
    }
  }

  /** Zoom about the midpoint, then follow it — the two-finger pan comes free. */
  function applyPinch() {
    if (!pinch) return;
    const next = pinchFrom();
    const rect = (gestureRect ??= container.getBoundingClientRect());
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * (next.dist / pinch.dist)));
    const mx = pinch.cx - rect.left;
    const my = pinch.cy - rect.top;
    vp.x = mx - ((mx - vp.x) / vp.zoom) * zoom + (next.cx - pinch.cx);
    vp.y = my - ((my - vp.y) / vp.zoom) * zoom + (next.cy - pinch.cy);
    vp.zoom = zoom;
    pinch = next;
  }

  function onPointerMove(e: PointerEvent) {
    lastPointer = { x: e.clientX, y: e.clientY };
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (touches.size >= 2) scheduleGesture();
      return;
    }
    // Moving before the hold fires means the finger is panning, not pressing.
    if (hold && !hold.armed && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > TAP_SLOP) cancelHold();
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
          const c = clampNode(Math.round(o.x + dx), Math.round(o.y + dy), widthOf(n), h(id));
          n.x = c.x;
          n.y = c.y;
        }
      }
      return;
    }
    if (pan) {
      panAt = { x: e.clientX, y: e.clientY };
      panTrail.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
      if (panTrail.length > 6) panTrail.shift();
      scheduleGesture();
    }
  }

  function onPointerUp(e: PointerEvent) {
    const wasPinching = !!pinch;
    if (touches.delete(e.pointerId) && touches.size < 2 && pinch) {
      if (gestureRaf) {
        cancelAnimationFrame(gestureRaf);
        flushGesture();
      }
      pinch = null;
      gestureRect = null;
      store.saveViewport();
    }
    // The finger that ends a pinch must not also count as a tap.
    if (wasPinching) {
      cancelHold();
      pan = null;
      isPanning = false;
      return;
    }
    const held = hold;
    cancelHold();
    // Held on a node and lifted without moving: that's the right-click.
    if (held?.armed && held.id && drag && !drag.moved) {
      drag = null;
      openMenuAt(held.x, held.y, document.elementFromPoint(held.x, held.y) as HTMLElement | null);
      return;
    }
    if (e.pointerType !== "mouse" && !held?.armed && !resize && !linking && onTap(e)) return;
    // A tap on a node selects it and opens the sheet; holding is what drags.
    if (held?.id && !held.armed && Math.abs(e.clientY - held.y) < TAP_SLOP && Math.abs(e.clientX - held.x) < TAP_SLOP) {
      pan = null;
      isPanning = false;
      store.select(held.id);
      store.sheetFull = true;
      selectedEdge = null;
      return;
    }
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
      // A gesture can end before its last queued frame runs.
      if (gestureRaf) {
        cancelAnimationFrame(gestureRaf);
        flushGesture();
      }
      const moved = Math.hypot(e.clientX - pan.startX, e.clientY - pan.startY) > 3;
      if (moved) {
        // A flick keeps going: a canvas that stops dead under the finger reads
        // as broken on a phone. A mouse drag has no such expectation.
        const v = pan.touch ? flickVelocity() : null;
        if (v && Math.hypot(v.x, v.y) > 0.15) {
          glide = { vx: v.x, vy: v.y, at: performance.now(), x: vp.x, y: vp.y };
          glideRaf = requestAnimationFrame(stepGlide);
        } else store.saveViewport();
      } else {
        if (isMobile) store.dismissPanel();
        store.select(null);
        selectedEdge = null;
      }
      pan = null;
      panAt = null;
      gestureRect = null;
      isPanning = false;
    }
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY, e.target as HTMLElement);
  }

  function openMenuAt(x: number, y: number, target: HTMLElement | null) {
    const id = nodeIdAt(target);
    let t: MenuTarget;
    if (id) {
      if (store.multi.length > 1 && store.multi.includes(id)) t = { kind: "group", ids: [...store.multi] };
      else {
        if (!store.multi.includes(id)) store.select(id);
        t = { kind: "node", id };
      }
    } else {
      const edgeEl = target?.closest("[data-edge]") as HTMLElement | null;
      if (edgeEl) {
        t = { kind: "edge", from: edgeEl.dataset.from!, to: edgeEl.dataset.to! };
      } else {
        const w = toWorld(x, y);
        t = { kind: "background", wx: w.x - NODE_W / 2, wy: w.y - 20 };
      }
    }
    menu = { x, y, target: t };
  }

  function onDblClick(e: MouseEvent) {
    activateAt(e.clientX, e.clientY, e.target as HTMLElement);
  }

  /**
   * A tap that lands within `TAP_SLOP` of the last one, soon enough, is a
   * double-tap: WebKit's own `dblclick` is unreliable under pointer capture
   * with `touch-action: none`.
   */
  function onTap(e: PointerEvent): boolean {
    const now = Date.now();
    const prev = lastTap;
    lastTap = { at: now, x: e.clientX, y: e.clientY };
    if (!prev || now - prev.at > 320 || Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > TAP_SLOP * 2) return false;
    // A double-tap replaces the single tap that would otherwise have landed.
    lastTap = null;
    drag = marquee = linking = resize = null;
    pan = null;
    isPanning = false;
    activateAt(e.clientX, e.clientY, e.target as HTMLElement);
    return true;
  }

  function activateAt(x: number, y: number, fallback: HTMLElement | null) {
    // Pointer capture (set on pointerdown) makes the browser target the
    // container, not what's under the cursor — hit-test by position instead.
    const target = (document.elementFromPoint(x, y) ?? fallback) as HTMLElement;
    const id = nodeIdAt(target);
    if (id) {
      // Double-clicking a node opens it in its own window (not a control inside it).
      if (target.closest("button, input, textarea, a, [data-port], [data-resize]")) return;
      void store.openInWindow(id);
      return;
    }
    if (target.closest("[data-edge]")) return;
    const w = toWorld(x, y);
    createAt(w.x - NODE_W / 2, w.y - 20);
  }

  /**
   * Wheel input is coalesced and applied once per animation frame. A trackpad fires
   * wheel events far more often than the display refreshes, and WebKit flushes style
   * and re-hit-tests the world after each one (it refreshes hover state on wheel
   * input); applying the viewport per event made every one of those flushes real work,
   * which halved the frame rate when zoomed out. Queued events replay in order, so the
   * zoom-about-cursor maths is unchanged.
   */
  let wheelQueue: { dx: number; dy: number; zoom: boolean; cx: number; cy: number }[] = [];
  let wheelRaf = 0;

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    stopGlide();
    wheelQueue.push({ dx: e.deltaX, dy: e.deltaY, zoom: e.ctrlKey || e.metaKey, cx: e.clientX, cy: e.clientY });
    if (!wheelRaf) wheelRaf = requestAnimationFrame(applyWheel);
  }

  function applyWheel() {
    wheelRaf = 0;
    const queue = wheelQueue;
    wheelQueue = [];
    let rect: DOMRect | null = null;
    for (const w of queue) {
      if (w.zoom) {
        const factor = Math.exp(-w.dy * 0.01);
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor));
        rect ??= container.getBoundingClientRect();
        const mx = w.cx - rect.left;
        const my = w.cy - rect.top;
        // Keep the point under the cursor fixed.
        vp.x = mx - ((mx - vp.x) / vp.zoom) * zoom;
        vp.y = my - ((my - vp.y) / vp.zoom) * zoom;
        vp.zoom = zoom;
      } else {
        vp.x -= w.dx;
        vp.y -= w.dy;
      }
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
    if (pressed(keys.undo, e) || pressed(keys.redo, e)) {
      e.preventDefault();
      if (pressed(keys.redo, e)) store.redo();
      else store.undo();
      return;
    }
    if (pressed(keys["select-all"], e)) {
      e.preventDefault();
      store.multi = store.notes.map((n) => n.id);
      return;
    }
    if (pressed(keys.copy, e) && store.selectedId && !window.getSelection()?.toString()) {
      e.preventDefault();
      store.copy(store.selectedId);
      return;
    }
    if (pressed(keys.paste, e) && store.clipboard) {
      e.preventDefault();
      pasteHere();
      return;
    }
    if (pressed(keys.duplicate, e) && store.selectedId) {
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

  /**
   * iOS Safari zooms the whole page on a pinch unless the gesture is claimed.
   * Mobile only: macOS WebKit is the same engine, and a trackpad pinch arrives
   * as these very events, so swallowing them there kills zooming instead.
   */
  const stopGesture = (e: Event) => e.preventDefault();

  /**
   * A pointer can end somewhere that never reaches our handler (capture moved,
   * the gesture was taken over, the app was backgrounded). Left in `touches` it
   * reads as a finger still down, and the next one starts a phantom pinch.
   */
  function forgetPointer(e: PointerEvent) {
    if (!touches.delete(e.pointerId)) return;
    if (touches.size < 2 && pinch) {
      pinch = null;
      gestureRect = null;
    }
  }
  function forgetAll() {
    touches.clear();
    pinch = null;
    gestureRect = null;
  }

  onMount(() => {
    window.addEventListener("pointerup", forgetPointer, true);
    window.addEventListener("pointercancel", forgetPointer, true);
    window.addEventListener("blur", forgetAll);
    document.addEventListener("visibilitychange", forgetAll);
    container.addEventListener("wheel", onWheel, { passive: false });
    if (isMobile) {
      container.addEventListener("gesturestart", stopGesture);
      container.addEventListener("gesturechange", stopGesture);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(wheelRaf);
      cancelAnimationFrame(gestureRaf);
      stopGlide();
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("gesturestart", stopGesture);
      container.removeEventListener("gesturechange", stopGesture);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerup", forgetPointer, true);
      window.removeEventListener("pointercancel", forgetPointer, true);
      window.removeEventListener("blur", forgetAll);
      document.removeEventListener("visibilitychange", forgetAll);
    };
  });

  /** Screen-space rects of the selected nodes, for the grain halo. */
  const glowRects = $derived.by((): Rect[] => {
    const ids = store.multi.length > 1 ? store.multi : store.selectedId ? [store.selectedId] : [];
    const out: Rect[] = [];
    for (const id of ids) {
      const n = store.byId(id);
      if (!n) continue;
      out.push({ id, x: vp.x + n.x * vp.zoom, y: vp.y + n.y * vp.zoom, w: widthOf(n) * vp.zoom, h: h(n.id) * vp.zoom });
    }
    return out;
  });

  /**
   * Background parallax: the dot grid and the sand sit "behind" the nodes. A layer at
   * depth P under perspective is the foreground camera scaled by P about an anchor:
   * screen = A + P · (foreground screen − A). It pans and zooms at P× the foreground,
   * and zooming converges towards A + P·(cursor − A), so A is the view centre to keep
   * that convergence natural. Moving A (sidebar/window resize) would translate the
   * background by (1 − P)·ΔA even though the viewport didn't change, so `comp`
   * accumulates the opposite shift on every resize to keep the background still.
   */
  const PARALLAX = 0.7;
  let comp = $state({ x: 0, y: 0 });
  let lastCentre: { x: number; y: number } | null = null;
  let lastOrigin: { x: number; y: number } | null = null;
  $effect(() => {
    const c = { x: viewW / 2, y: viewH / 2 };
    // Where the canvas sits in the window: when a sidebar pushes it sideways, App
    // shifts the viewport the other way so the nodes stay put, which moves the
    // background by (1 − P)·Δorigin; cancel that too.
    const r = container?.getBoundingClientRect();
    const o = r ? { x: r.left, y: r.top } : { x: 0, y: 0 };
    // Only real resizes count: the first layout (0 → size) must not shift the anchor.
    if (lastCentre && lastCentre.x && lastCentre.y && viewW && viewH) {
      const dx = (1 - PARALLAX) * (lastCentre.x - c.x + (lastOrigin ? lastOrigin.x - o.x : 0));
      const dy = (1 - PARALLAX) * (lastCentre.y - c.y + (lastOrigin ? lastOrigin.y - o.y : 0));
      if (dx || dy) comp = { x: comp.x + dx, y: comp.y + dy };
    }
    lastCentre = c;
    lastOrigin = o;
  });
  const bg = $derived({
    x: PARALLAX * vp.x + (1 - PARALLAX) * (viewW / 2) + comp.x,
    y: PARALLAX * vp.y + (1 - PARALLAX) * (viewH / 2) + comp.y,
    zoom: PARALLAX * vp.zoom,
  });

  /**
   * Dot grid look: a single 32px lattice (dots at 16 + 32k, in the parallax camera).
   * Dots are 1.3 screen px at zoom ≥ 1 and shrink to 50% (and dim a little) at MIN_ZOOM,
   * so a zoomed-out canvas doesn't turn into a grey wash. Same in the shader and in CSS.
   */
  const grid = $derived.by(() => {
    const t = Math.min(1, Math.max(0, (vp.zoom - MIN_ZOOM) / (1 - MIN_ZOOM)));
    return { radius: 1.3 * (0.5 + 0.5 * t), alpha: 0.6 + 0.4 * t };
  });

  /** Inline style for the CSS fallback grid: the visible area in background units, snapped to the 32px lattice. */
  const gridStyle = $derived.by(() => {
    const g = 32;
    const x = Math.floor(-bg.x / bg.zoom / g) * g - g;
    const y = Math.floor(-bg.y / bg.zoom / g) * g - g;
    const w = viewW / bg.zoom + 3 * g;
    const h = viewH / bg.zoom + 3 * g;
    return `left:${x}px; top:${y}px; width:${w}px; height:${h}px; --dot:${grid.radius / bg.zoom}px; opacity:${grid.alpha}`;
  });

  /**
   * The world's edge, as screen-space pieces clamped to the view: shade bands over the
   * area outside the world square and a dashed rim along its border. These used to be
   * two world-sized SVG shapes inside `.world`, but WebKit repaints a shape that large
   * for every tile it rasterises, whatever the shape is made of, and that alone cost a
   * third of the frame budget while panning fast or zooming. Bands the size of the
   * viewport are a handful of rect fills.
   */
  const worldEdge = $derived.by(() => {
    const l = vp.x - WORLD * vp.zoom;
    const t = vp.y - WORLD * vp.zoom;
    const r = vp.x + WORLD * vp.zoom;
    const b = vp.y + WORLD * vp.zoom;
    const cl = Math.max(0, Math.min(viewW, l));
    const ct = Math.max(0, Math.min(viewH, t));
    const cr = Math.max(0, Math.min(viewW, r));
    const cb = Math.max(0, Math.min(viewH, b));
    const shades: { x: number; y: number; w: number; h: number }[] = [];
    if (cl > 0) shades.push({ x: 0, y: 0, w: cl, h: viewH });
    if (cr < viewW) shades.push({ x: cr, y: 0, w: viewW - cr, h: viewH });
    if (ct > 0) shades.push({ x: cl, y: 0, w: cr - cl, h: ct });
    if (cb < viewH) shades.push({ x: cl, y: cb, w: cr - cl, h: viewH - cb });
    const rims: { v: boolean; x: number; y: number; len: number }[] = [];
    if (l >= 0 && l <= viewW) rims.push({ v: true, x: l - 1, y: ct, len: cb - ct });
    if (r >= 0 && r <= viewW) rims.push({ v: true, x: r - 1, y: ct, len: cb - ct });
    if (t >= 0 && t <= viewH) rims.push({ v: false, x: cl, y: t - 1, len: cr - cl });
    if (b >= 0 && b <= viewH) rims.push({ v: false, x: cl, y: b - 1, len: cr - cl });
    return { shades, rims };
  });

  const linkPath = $derived.by(() => {
    if (!linking) return null;
    const s = store.byId(linking.from);
    if (!s) return null;
    const a = rightOf(s);
    const b = linking.over ? leftOf(store.byId(linking.over)!) : { x: linking.x, y: linking.y };
    return { d: path(a, b), head: head(b) };
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
>
  {#if grain}
    <Grain rects={glowRects} curves={flowCurves} offset={{ x: vp.x, y: vp.y }} zoom={vp.zoom} {bg} {grid} />
  {/if}
  <!-- Background layer: a parallax'd copy of the world transform. The dot grid uses a
       fixed 24px tile scaled by the transform so tiles aren't rounded to whole screen
       pixels at fractional zoom; it's sized to cover just the view. -->
  {#if !grain}
    <!-- CSS fallback when the shader is off; the shader draws the same grid per pixel otherwise. -->
    <div class="bg" style="transform: translate({bg.x}px, {bg.y}px) scale({bg.zoom})">
      <div class="grid" style={gridStyle}></div>
    </div>
  {/if}
  {#each worldEdge.shades as sh, i (i)}
    <div class="shade" style="left:{sh.x}px; top:{sh.y}px; width:{sh.w}px; height:{sh.h}px"></div>
  {/each}
  {#each worldEdge.rims as rim, i (i)}
    <div
      class="rim"
      class:v={rim.v}
      class:h={!rim.v}
      style="left:{rim.x}px; top:{rim.y}px; {rim.v ? `height:${rim.len}px` : `width:${rim.len}px`}"
    ></div>
  {/each}
  <!-- Inline transform rather than custom properties on .canvas: a changed inherited
       property re-resolves style for every descendant on each pan. -->
  <div class="world" style="transform: translate({vp.x}px, {vp.y}px) scale({vp.zoom})">
    <svg class="edges" overflow="visible">
      {#each orderedEdges as edge (edge.from + ">" + edge.to)}
        {@const sel = sameEdge(selectedEdge, edge)}
        {@const near = isNear(edge)}
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
          onpointerenter={() => (hoveredEdge = { from: edge.from, to: edge.to })}
          onpointerleave={() => sameEdge(hoveredEdge, edge) && (hoveredEdge = null)}
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
          <path class="line" d={edge.d} />
          <path class="head" d={edge.head} />
        </g>
      {/each}
      {#if linkPath}
        <path class="link-preview" d={linkPath.d} />
        <path class="link-preview head" d={linkPath.head} />
      {/if}
    </svg>

    {#each store.notes as note (note.id)}
      <NodeCard
        {note}
        width={widthOf(note)}
        selected={store.selectedId === note.id}
        grouped={store.multi.length > 1 && store.multi.includes(note.id)}
        dim={visible !== null && !visible.has(note.id)}
        lifted={lifted === note.id}
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

  {#if !store.notes.length}
    <div class="empty">
      <p>{t("canvas.empty.create")}</p>
      <p class="sub">{t("canvas.empty.drag.before")} <span class="dot"></span> {t("canvas.empty.drag.after")}</p>
      {#if !isMobile}
        <p class="sub">
          {t("canvas.empty.keys", { deps: keys["nav-deps"], dependents: keys["nav-dependents"], title: keys["edit-title"] })}
        </p>
      {/if}
    </div>
  {/if}
</div>

<!-- Outside .canvas on purpose: a position:fixed descendant of an overflow:hidden
     container with composited layers makes WebKit drop the container's clip, so the
     graph would paint over the note panel while the menu is open. -->
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

<style>
  .canvas {
    position: relative;
    /* Own stacking context so the grain's negative z-index sits under every child. */
    isolation: isolate;
    flex: 1;
    min-width: 0;
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
  .bg {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 1;
    transform-origin: 0 0;
    pointer-events: none;
    /* Own compositor layer: panning translates the rasterised grid instead of re-rasterising
       sub-pixel dots each frame (which makes them flicker). */
    will-change: transform;
  }
  .grid {
    position: absolute;
    pointer-events: none;
    /* Fixed 32px lattice (dots at 16 + 32k, same as the shader); --dot is the radius in
       world units (see gridStyle). No level-of-detail here: this is only the fallback. */
    background-image: radial-gradient(circle at 16px 16px, #ffffff1c var(--dot), transparent var(--dot));
    background-size: 32px 32px;
  }
  .world {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 2;
    transform-origin: 0 0;
    /* Own compositor layer from the start. Panning then translates rasterised tiles and
       only newly exposed ones are painted; without this WebKit repaints the whole view
       every frame and, some 40 repaints into a gesture, promotes the layer anyway with
       a ~65 ms hitch. */
    will-change: transform;
  }
  /* World edge, drawn in screen space (see `worldEdge`). */
  .shade {
    position: absolute;
    z-index: 1;
    background: #00000059;
    pointer-events: none;
  }
  .rim {
    position: absolute;
    z-index: 1;
    pointer-events: none;
    opacity: 0.55;
    background: repeating-linear-gradient(var(--dir), var(--accent2) 0 8px, transparent 8px 16px);
  }
  .rim.h {
    height: 2px;
    --dir: to right;
  }
  .rim.v {
    width: 2px;
    --dir: to bottom;
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
  .edge .head {
    fill: #555;
    transition: fill 0.15s;
  }
  .edge:hover .line,
  .edge.near .line {
    stroke: var(--accent2);
  }
  .edge:hover .head,
  .edge.near .head,
  .edge.sel .head {
    fill: var(--accent2);
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
  .link-preview.head {
    fill: var(--accent2);
    stroke: none;
  }
  .marquee {
    position: absolute;
    z-index: 3;
    pointer-events: none;
    border: 1px solid var(--accent2);
    background: #8a2aa21a;
  }
  .empty {
    position: absolute;
    inset: 0;
    z-index: 3;
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
