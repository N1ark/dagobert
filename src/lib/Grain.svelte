<script lang="ts">
  /** Decorative WebGL film grain and node haloes; drawing lives in grainGL.ts (docs/canvas.md). */
  import { onMount } from "svelte";
  import { createGrain, MAX_CURVES, MAX_RECTS, type GrainFrame, type GrainRenderer } from "./grainGL";
  import { parseColor } from "purr";

  export type Rect = { id: string; x: number; y: number; w: number; h: number };
  type Pt = { x: number; y: number };
  /** Cubic bezier in world units (same as the SVG edge path). */
  export type Curve = { id: string; p0: Pt; p1: Pt; p2: Pt; p3: Pt };

  let {
    rects = [],
    curves = [],
    offset = { x: 0, y: 0 },
    zoom = 1,
    bg = { x: 0, y: 0, zoom: 1 },
    grid = { radius: 1.3, alpha: 1 },
  }: {
    rects?: Rect[];
    curves?: Curve[];
    /** Foreground camera: where nodes/edges are. */
    offset?: { x: number; y: number };
    zoom?: number;
    /** Background camera (parallax'd) the sand is anchored to. */
    bg?: { x: number; y: number; zoom: number };
    /** Dot grid: radius in screen px and opacity multiplier. */
    grid?: { radius: number; alpha: number };
  } = $props();

  /** Halo fade-in, ms. Also hides the frame where the canvas lags behind the DOM. */
  const FADE_MS = 160;

  let canvas: HTMLCanvasElement;
  let renderer: GrainRenderer | null = null;
  let raf = 0;
  let reduced = false;
  let dirty = false;
  let bufW = 1;
  let bufH = 1;
  /** When each selected rect / curve first appeared, for the fade-in. */
  const born = new Map<string, number>();
  let curvesVersion = 0;
  let curvesKey = "";

  const frame: GrainFrame = {
    time: 0,
    dpr: 1,
    offset: { x: 0, y: 0 },
    zoom: 1,
    bg: { x: 0, y: 0, zoom: 1 },
    grid: { radius: 1.3, alpha: 1 },
    tint: [0.69, 0.27, 0.67],
    rects: new Float32Array(MAX_RECTS * 4),
    rectCount: 0,
    strength: new Float32Array(MAX_RECTS),
    curvesA: new Float32Array(MAX_CURVES * 4),
    curvesB: new Float32Array(MAX_CURVES * 4),
    curveCount: 0,
    curveStrength: new Float32Array(MAX_CURVES),
    curvesVersion: 0,
  };

  function accent(): [number, number, number] {
    try {
      const rgb = parseColor(getComputedStyle(document.documentElement).getPropertyValue("--theme2"));
      return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
    } catch {
      return [0.69, 0.27, 0.67];
    }
  }

  function setup() {
    renderer = createGrain(canvas);
    if (renderer) {
      frame.tint = accent();
      dirty = true;
    }
    return !!renderer;
  }

  function dpr() {
    return window.devicePixelRatio || 1;
  }

  /** performance.now() of the last draw, so the loop can skip a frame the effect already drew. */
  let drawnAt = -Infinity;
  let timer = 0;
  let fading = false;
  let focused = true;
  let lastInput = 0;

  /** The twinkle is slow, so it runs at a low rate; moving sand and fades at up to 60 fps. */
  const TWINKLE_MS = 1000 / 30;
  const SMOOTH_MS = 1000 / 60;
  /** With no input for this long the sand freezes, so an idle window costs nothing. */
  const IDLE_MS = 30_000;

  function animating() {
    if (!renderer || document.hidden) return false;
    // A halo fading in finishes even when the sand is frozen.
    return fading || (!reduced && focused && performance.now() - lastInput < IDLE_MS);
  }

  function schedule() {
    if (raf || timer || !animating()) return;
    const gap = (fading || curves.length ? SMOOTH_MS : TWINKLE_MS) - (performance.now() - drawnAt);
    if (gap > 8)
      timer = window.setTimeout(() => {
        timer = 0;
        raf = requestAnimationFrame(tick);
      }, gap - 4);
    else raf = requestAnimationFrame(tick);
  }

  function tick(t: number) {
    raf = 0;
    if (!animating()) return;
    // The effect below may have drawn this frame already; a second full-screen pass buys nothing.
    if (performance.now() - drawnAt >= SMOOTH_MS - 4) render(t);
    schedule();
  }

  function wake() {
    lastInput = performance.now();
    schedule();
  }

  function render(t: number) {
    if (!renderer || document.hidden) return;
    drawnAt = performance.now();
    // Reduced motion: a still texture that only re-renders when inputs change.
    if (reduced) {
      if (!dirty) return;
      t = 0;
    }
    dirty = false;
    fading = false;
    const s = dpr();
    const now = performance.now();
    const fade = (id: string) => {
      let b = born.get(id);
      if (b === undefined) born.set(id, (b = now));
      const k = reduced ? 1 : Math.min(1, (now - b) / FADE_MS);
      if (k < 1) fading = true;
      return k * k;
    };
    for (const id of born.keys()) if (!rects.some((r) => r.id === id) && !curves.some((c) => c.id === id)) born.delete(id);

    const n = Math.min(rects.length, MAX_RECTS);
    for (let i = 0; i < n; i++) {
      const r = rects[i];
      frame.rects[i * 4] = r.x * s;
      frame.rects[i * 4 + 1] = r.y * s;
      frame.rects[i * 4 + 2] = r.w * s;
      frame.rects[i * 4 + 3] = r.h * s;
      frame.strength[i] = fade(r.id);
    }
    frame.rectCount = n;

    const m = Math.min(curves.length, MAX_CURVES);
    // The traveller vertex buffer depends only on which curves exist and how long they are.
    const key = curves
      .slice(0, m)
      .map((c) => c.id + ":" + Math.round(Math.hypot(c.p3.x - c.p0.x, c.p3.y - c.p0.y)))
      .join("|");
    if (key !== curvesKey) {
      curvesKey = key;
      curvesVersion++;
    }
    for (let i = 0; i < m; i++) {
      const c = curves[i];
      frame.curvesA[i * 4] = c.p0.x;
      frame.curvesA[i * 4 + 1] = c.p0.y;
      frame.curvesA[i * 4 + 2] = c.p1.x;
      frame.curvesA[i * 4 + 3] = c.p1.y;
      frame.curvesB[i * 4] = c.p2.x;
      frame.curvesB[i * 4 + 1] = c.p2.y;
      frame.curvesB[i * 4 + 2] = c.p3.x;
      frame.curvesB[i * 4 + 3] = c.p3.y;
      frame.curveStrength[i] = fade(c.id);
    }
    frame.curveCount = m;
    frame.curvesVersion = curvesVersion;

    frame.time = t / 1000;
    frame.dpr = s;
    frame.offset.x = offset.x * s;
    frame.offset.y = offset.y * s;
    frame.zoom = zoom;
    frame.bg.x = bg.x * s;
    frame.bg.y = bg.y * s;
    frame.bg.zoom = bg.zoom;
    frame.grid.radius = grid.radius * s;
    frame.grid.alpha = grid.alpha;
    renderer.render(bufW, bufH, frame);
  }

  // Draw here rather than on the next rAF, so the halo lands in the same paint as the node.
  $effect(() => {
    void rects;
    void curves;
    void offset;
    void zoom;
    void bg;
    void grid;
    dirty = true;
    render(performance.now());
    schedule();
  });

  onMount(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced = mq.matches;
    const onMq = () => {
      reduced = mq.matches;
      dirty = true;
      render(performance.now());
      schedule();
    };
    mq.addEventListener("change", onMq);

    focused = document.hasFocus();
    const onFocus = () => {
      focused = document.hasFocus();
      wake();
    };
    const inputs = ["pointermove", "pointerdown", "keydown", "wheel"] as const;
    for (const e of inputs) window.addEventListener(e, wake, { passive: true, capture: true });
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    const lost = (e: Event) => {
      e.preventDefault();
      renderer = null;
    };
    const restored = () => {
      if (setup()) wake();
    };
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);

    // Resize and draw before paint, so the old frame is never shown stretched.
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      const box = e.devicePixelContentBoxSize?.[0];
      if (box) {
        bufW = Math.max(1, box.inlineSize);
        bufH = Math.max(1, box.blockSize);
      } else {
        const s = dpr();
        bufW = Math.max(1, Math.round(e.contentRect.width * s));
        bufH = Math.max(1, Math.round(e.contentRect.height * s));
      }
      dirty = true;
      render(performance.now());
    });
    ro.observe(canvas);

    if (setup()) wake();

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      for (const e of inputs) window.removeEventListener(e, wake, { capture: true });
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      ro.disconnect();
      mq.removeEventListener("change", onMq);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      renderer?.destroy();
      renderer = null;
    };
  });
</script>

<canvas class="grain" bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .grain {
    position: absolute;
    inset: 0;
    z-index: -1;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
