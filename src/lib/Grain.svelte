<script lang="ts">
  /**
   * WebGL background: a discreet, animated film grain that lives around the
   * edges of the frame and haloes the selected nodes, plus sand grains riding
   * the selected node's edges. Purely decorative; pointer-events are off and it
   * degrades to nothing without WebGL. Rendering lives in grainGL.ts; this
   * component owns the props, the fade-in bookkeeping and the frame loop.
   */
  import { onMount } from "svelte";
  import { createGrain, MAX_CURVES, MAX_RECTS, type GrainFrame, type GrainRenderer } from "./grainGL";

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
  let frozen = 0;
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
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent2").trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (!m) return [0.69, 0.27, 0.67];
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
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

  function loop(t: number) {
    raf = requestAnimationFrame(loop);
    // The input effect below draws synchronously whenever the camera or selection
    // changes; while panning that happens every frame, and drawing again here would
    // double the GPU work (a full-screen pass at device resolution) for no visible gain.
    if (performance.now() - drawnAt < 6) return;
    render(t);
  }

  function render(t: number) {
    if (!renderer || document.hidden) return;
    drawnAt = performance.now();
    // Reduced motion: a still texture that only re-renders when inputs change.
    if (reduced) {
      if (!dirty) return;
      t = frozen;
    }
    dirty = false;
    const s = dpr();
    const now = performance.now();
    const fade = (id: string) => {
      let b = born.get(id);
      if (b === undefined) born.set(id, (b = now));
      const k = reduced ? 1 : Math.min(1, (now - b) / FADE_MS);
      if (k < 1) dirty = true;
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

  // Under reduced motion the texture is still; re-render only when inputs change.
  // Draw right away when the camera/selection changes: this effect runs in the same
  // microtask that patches the DOM, so the canvas and the nodes land in the same paint.
  // Waiting for the next rAF can put the halo a frame behind the node while dragging
  // (WebKit doesn't align pointer events to rAF), which reads as the halo trailing.
  $effect(() => {
    void rects;
    void curves;
    void offset;
    void zoom;
    void bg;
    void grid;
    dirty = true;
    render(performance.now());
  });

  onMount(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced = mq.matches;
    const onMq = () => (reduced = mq.matches);
    mq.addEventListener("change", onMq);

    const lost = (e: Event) => {
      e.preventDefault();
      renderer = null;
    };
    const restored = () => setup();
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);

    // Resize the buffer as soon as layout changes (before paint) and draw
    // immediately, so the old frame is never shown stretched.
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

    if (setup()) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
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
