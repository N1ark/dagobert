<script lang="ts">
  /**
   * WebGL background: a discreet, animated film grain that lives around the
   * edges of the frame and haloes the selected nodes. Purely decorative;
   * pointer-events are off and it degrades to nothing without WebGL.
   */
  import { onMount } from "svelte";
  import fragSrc from "./grain.frag?raw";

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

  const MAX_RECTS = 16;
  const MAX_CURVES = 48;
  /** Upper bound on sand grains per edge; the actual count grows with edge length. */
  const PER_CURVE = 48;
  /** Halo fade-in, ms. Also hides the frame where the canvas lags behind the DOM. */
  const FADE_MS = 160;

  const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
  // Shader constants are injected as #defines so the .frag stays plain GLSL.
  const FRAG = `#define MAX_RECTS ${MAX_RECTS}\n#define MAX_CURVES ${MAX_CURVES}\n#define PER_CURVE ${PER_CURVE}\n` + fragSrc;

  let canvas: HTMLCanvasElement;
  let gl: WebGLRenderingContext | null = null;
  let uni: Record<string, WebGLUniformLocation | null> = {};
  let raf = 0;
  let frozen = 0;
  let reduced = false;
  let dirty = false;
  const rectData = new Float32Array(MAX_RECTS * 4);
  const strength = new Float32Array(MAX_RECTS);
  /** When each selected rect first appeared, for the fade-in. */
  const born = new Map<string, number>();
  const curveA = new Float32Array(MAX_CURVES * 4);
  const curveB = new Float32Array(MAX_CURVES * 4);
  const curveStrength = new Float32Array(MAX_CURVES);

  function accent(): [number, number, number] {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent2").trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (!m) return [0.69, 0.27, 0.67];
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function compile(g: WebGLRenderingContext, type: number, src: string) {
    const s = g.createShader(type)!;
    g.shaderSource(s, src);
    g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
      console.warn("grain shader:", g.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function setup() {
    const g = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!g) return false;
    const vs = compile(g, g.VERTEX_SHADER, VERT);
    const fs = compile(g, g.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    const prog = g.createProgram()!;
    g.attachShader(prog, vs);
    g.attachShader(prog, fs);
    g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) {
      console.warn("grain program:", g.getProgramInfoLog(prog));
      return false;
    }
    g.useProgram(prog);
    const buf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(prog, "a");
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    uni = {};
    for (const k of [
      "u_res",
      "u_time",
      "u_dpr",
      "u_count",
      "u_rects",
      "u_strength",
      "u_offset",
      "u_zoom",
      "u_bg",
      "u_grid",
      "u_tint",
      "u_ccount",
      "u_ca",
      "u_cb",
      "u_cstrength",
    ])
      uni[k] = g.getUniformLocation(prog, k);
    g.uniform3fv(uni.u_tint, accent());
    g.disable(g.DEPTH_TEST);
    g.disable(g.BLEND);
    gl = g;
    dirty = true;
    return true;
  }

  function dpr() {
    return window.devicePixelRatio || 1;
  }

  let bufW = 1;
  let bufH = 1;

  function frame(t: number) {
    raf = requestAnimationFrame(frame);
    render(t);
  }

  function render(t: number) {
    if (!gl || document.hidden) return;
    // Reduced motion: a still texture that only re-renders when inputs change.
    if (reduced) {
      if (!dirty) return;
      t = frozen;
    }
    dirty = false;
    const g = gl;
    const s = dpr();
    const W = bufW;
    const H = bufH;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    g.viewport(0, 0, W, H);
    g.uniform2f(uni.u_res, W, H);
    g.uniform1f(uni.u_time, t / 1000);
    g.uniform1f(uni.u_dpr, s);
    const n = Math.min(rects.length, MAX_RECTS);
    const now = performance.now();
    for (const id of born.keys()) if (!rects.some((r) => r.id === id) && !curves.some((c) => c.id === id)) born.delete(id);
    for (let i = 0; i < n; i++) {
      const r = rects[i];
      rectData[i * 4] = r.x * s;
      rectData[i * 4 + 1] = r.y * s;
      rectData[i * 4 + 2] = r.w * s;
      rectData[i * 4 + 3] = r.h * s;
      let b = born.get(r.id);
      if (b === undefined) born.set(r.id, (b = now));
      const k = reduced ? 1 : Math.min(1, (now - b) / FADE_MS);
      strength[i] = k * k;
      if (k < 1) dirty = true;
    }
    g.uniform1i(uni.u_count, n);
    g.uniform4fv(uni.u_rects, rectData);
    g.uniform1fv(uni.u_strength, strength);
    const m = Math.min(curves.length, MAX_CURVES);
    for (let i = 0; i < m; i++) {
      const c = curves[i];
      curveA[i * 4] = c.p0.x;
      curveA[i * 4 + 1] = c.p0.y;
      curveA[i * 4 + 2] = c.p1.x;
      curveA[i * 4 + 3] = c.p1.y;
      curveB[i * 4] = c.p2.x;
      curveB[i * 4 + 1] = c.p2.y;
      curveB[i * 4 + 2] = c.p3.x;
      curveB[i * 4 + 3] = c.p3.y;
      let b = born.get(c.id);
      if (b === undefined) born.set(c.id, (b = now));
      const k = reduced ? 1 : Math.min(1, (now - b) / FADE_MS);
      curveStrength[i] = k * k;
      if (k < 1) dirty = true;
    }
    g.uniform1i(uni.u_ccount, m);
    g.uniform4fv(uni.u_ca, curveA);
    g.uniform4fv(uni.u_cb, curveB);
    g.uniform1fv(uni.u_cstrength, curveStrength);
    g.uniform2f(uni.u_offset, offset.x * s, offset.y * s);
    g.uniform1f(uni.u_zoom, zoom);
    g.uniform3f(uni.u_bg, bg.x * s, bg.y * s, bg.zoom);
    g.uniform2f(uni.u_grid, grid.radius * s, grid.alpha);
    g.drawArrays(g.TRIANGLES, 0, 3);
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
      gl = null;
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

    if (setup()) raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener("change", onMq);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      gl = null;
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
