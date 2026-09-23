/**
 * WebGL renderer behind Grain.svelte: the background grain, halo, dot grid and edge
 * travellers. Pure WebGL1 + typed arrays, no Svelte, so it can be driven by a
 * benchmark/regression page as well as by the component.
 *
 * Two passes per frame:
 *  1. travellers: one small quad per sand grain riding an edge, drawn into an
 *     offscreen RGBA8 texture the size of the canvas with MAX blending. Cost is
 *     proportional to the number of grains, not to the screen area they may cover.
 *  2. main (grain.frag): full-screen; samples that texture once per fragment.
 */
import commonSrc from "./grain.glsl?raw";
import mainFragSrc from "./grain.frag?raw";
import travVertSrc from "./travellers.vert?raw";
import travFragSrc from "./travellers.frag?raw";

export const MAX_RECTS = 16;
export const MAX_CURVES = 48;
/** Upper bound on sand grains per edge; the actual count grows with edge length. */
export const PER_CURVE = 48;

/** One traveller per ~14 world px of edge, between 6 and PER_CURVE. */
export function travellerCount(len: number) {
  return Math.ceil(Math.min(PER_CURVE, Math.max(6, len / 14)));
}

export type GrainFrame = {
  /** Seconds. */
  time: number;
  dpr: number;
  /** Foreground camera, device px / zoom. */
  offset: { x: number; y: number };
  zoom: number;
  /** Background (parallax) camera, device px / zoom. */
  bg: { x: number; y: number; zoom: number };
  /** Dot grid: radius in device px, opacity. */
  grid: { radius: number; alpha: number };
  tint: [number, number, number];
  /** Selected node rects in device px (top-left origin), `MAX_RECTS * 4` floats. */
  rects: Float32Array;
  rectCount: number;
  /** Per-rect halo strength (fade-in), `MAX_RECTS` floats. */
  strength: Float32Array;
  /** Edge curves in world units: p0.xy p1.xy in `curvesA`, p2.xy p3.xy in `curvesB`, `MAX_CURVES * 4` floats each. */
  curvesA: Float32Array;
  curvesB: Float32Array;
  curveCount: number;
  curveStrength: Float32Array;
  /** Bump when the set of curves changes so the traveller vertex buffer is rebuilt. */
  curvesVersion: number;
};

export type GrainRenderer = {
  render(width: number, height: number, frame: GrainFrame): void;
  destroy(): void;
};

// The shared chunk declares float functions, so the fragment default precision must come first.
const DEFINES = `precision highp float;\n#define MAX_RECTS ${MAX_RECTS}\n#define MAX_CURVES ${MAX_CURVES}\n`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn("grain shader:", gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

function program(gl: WebGLRenderingContext, vert: string, frag: string, uniforms: string[]) {
  const vs = compile(gl, gl.VERTEX_SHADER, vert);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("grain program:", gl.getProgramInfoLog(prog));
    return null;
  }
  const uni: Record<string, WebGLUniformLocation | null> = {};
  for (const k of uniforms) uni[k] = gl.getUniformLocation(prog, k);
  return { prog, uni };
}

/** Creates the renderer on `canvas`, or returns null when WebGL/shaders are unavailable. */
export function createGrain(canvas: HTMLCanvasElement): GrainRenderer | null {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) return null;

  const main = program(gl, `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`, DEFINES + commonSrc + mainFragSrc, [
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
    "u_flow",
  ]);
  const trav = program(gl, DEFINES + commonSrc + travVertSrc, travFragSrc, [
    "u_res",
    "u_time",
    "u_dpr",
    "u_zoom",
    "u_offset",
    "u_ca",
    "u_cb",
    "u_cstrength",
  ]);
  if (!main || !trav) return null;

  // Full-screen triangle for the main pass.
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aQuad = gl.getAttribLocation(main.prog, "a");

  // Traveller quads: (curve, traveller, corner.x, corner.y) per vertex, rebuilt when curves change.
  const travBuf = gl.createBuffer();
  const aData = gl.getAttribLocation(trav.prog, "a_data");
  let travVerts = 0;
  let travVersion = -1;

  // Offscreen flow texture + framebuffer, resized with the canvas.
  const flowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, flowTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  let flowW = 0;
  let flowH = 0;

  // MAX blending keeps the old "max over travellers" semantics; additive is the fallback.
  const minmax = gl.getExtension("EXT_blend_minmax");

  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(main.prog);
  gl.uniform1i(main.uni.u_flow, 0);

  function buildTravellers(f: GrainFrame) {
    const CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
    let total = 0;
    const counts: number[] = [];
    for (let i = 0; i < f.curveCount; i++) {
      const dx = f.curvesB[i * 4 + 2] - f.curvesA[i * 4];
      const dy = f.curvesB[i * 4 + 3] - f.curvesA[i * 4 + 1];
      const n = travellerCount(Math.hypot(dx, dy) + 1);
      counts.push(n);
      total += n;
    }
    const data = new Float32Array(total * 6 * 4);
    let o = 0;
    for (let i = 0; i < f.curveCount; i++)
      for (let k = 0; k < counts[i]; k++)
        for (let v = 0; v < 6; v++) {
          data[o++] = i;
          data[o++] = k;
          data[o++] = CORNERS[v * 2];
          data[o++] = CORNERS[v * 2 + 1];
        }
    gl!.bindBuffer(gl!.ARRAY_BUFFER, travBuf);
    gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.DYNAMIC_DRAW);
    travVerts = total * 6;
  }

  function renderTravellers(W: number, H: number, f: GrainFrame) {
    const g = gl!;
    if (travVersion !== f.curvesVersion) {
      travVersion = f.curvesVersion;
      buildTravellers(f);
    }
    if (flowW !== W || flowH !== H) {
      flowW = W;
      flowH = H;
      g.bindTexture(g.TEXTURE_2D, flowTex);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, W, H, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    }
    g.bindFramebuffer(g.FRAMEBUFFER, fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, flowTex, 0);
    g.viewport(0, 0, W, H);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
    if (travVerts > 0) {
      g.useProgram(trav!.prog);
      const u = trav!.uni;
      g.uniform2f(u.u_res, W, H);
      g.uniform1f(u.u_time, f.time);
      g.uniform1f(u.u_dpr, f.dpr);
      g.uniform1f(u.u_zoom, f.zoom);
      g.uniform2f(u.u_offset, f.offset.x, f.offset.y);
      g.uniform4fv(u.u_ca, f.curvesA);
      g.uniform4fv(u.u_cb, f.curvesB);
      g.uniform1fv(u.u_cstrength, f.curveStrength);
      g.enable(g.BLEND);
      if (minmax) g.blendEquation(minmax.MAX_EXT);
      else g.blendEquation(g.FUNC_ADD);
      g.blendFunc(g.ONE, g.ONE);
      g.bindBuffer(g.ARRAY_BUFFER, travBuf);
      g.enableVertexAttribArray(aData);
      g.vertexAttribPointer(aData, 4, g.FLOAT, false, 0, 0);
      g.drawArrays(g.TRIANGLES, 0, travVerts);
      g.disableVertexAttribArray(aData);
      g.disable(g.BLEND);
      g.blendEquation(g.FUNC_ADD);
    }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
  }

  return {
    render(W, H, f) {
      const g = gl;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      if (f.curveCount > 0) renderTravellers(W, H, f);

      g.viewport(0, 0, W, H);
      g.useProgram(main.prog);
      const u = main.uni;
      g.uniform2f(u.u_res, W, H);
      g.uniform1f(u.u_time, f.time);
      g.uniform1f(u.u_dpr, f.dpr);
      g.uniform1i(u.u_count, f.rectCount);
      g.uniform4fv(u.u_rects, f.rects);
      g.uniform1fv(u.u_strength, f.strength);
      g.uniform1i(u.u_ccount, f.curveCount);
      g.uniform2f(u.u_offset, f.offset.x, f.offset.y);
      g.uniform1f(u.u_zoom, f.zoom);
      g.uniform3f(u.u_bg, f.bg.x, f.bg.y, f.bg.zoom);
      g.uniform2f(u.u_grid, f.grid.radius, f.grid.alpha);
      g.uniform3fv(u.u_tint, f.tint);
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, flowTex);
      g.bindBuffer(g.ARRAY_BUFFER, quad);
      g.enableVertexAttribArray(aQuad);
      g.vertexAttribPointer(aQuad, 2, g.FLOAT, false, 0, 0);
      g.drawArrays(g.TRIANGLES, 0, 3);
    },
    destroy() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
