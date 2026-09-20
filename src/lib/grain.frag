// Background grain for the graph view. Loaded by Grain.svelte (Vite `?raw`), which
// prepends `#define MAX_RECTS / MAX_CURVES / PER_CURVE` and sets the uniforms.
//
// Layers, back to front:
//   - dot grid (world lattice, parallax'd background camera)
//   - sand: twinkling specks under a frame vignette (background camera) and a halo
//     around the selected nodes (foreground camera, so it sticks to the node)
//   - travellers: sand grains riding each edge of the selected node's chain
//
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dpr;
uniform int u_count;
uniform vec4 u_rects[MAX_RECTS];
uniform float u_strength[MAX_RECTS];
uniform vec2 u_offset;
uniform int u_ccount;
uniform vec4 u_ca[MAX_CURVES]; // p0.xy, p1.xy
uniform vec4 u_cb[MAX_CURVES]; // p2.xy, p3.xy
uniform float u_cstrength[MAX_CURVES];
uniform float u_zoom;
uniform vec3 u_bg; // background camera: offset.xy (device px), zoom
uniform vec2 u_grid; // dot grid: radius (device px), opacity
uniform vec3 u_tint;

// Per-cell hash (Dave Hoskins' "hash without sine"). The cell coordinate is the
// only spatial input, so nothing ever slides; time only changes how bright each
// fixed grain is. Coordinates are wrapped at 8192 to keep float precision far
// from the origin: the repeat is well beyond any window size.
float hash(vec2 p) {
  p = mod(p, 8192.0);
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// Signed distance to a rounded box centred on the origin.
float rbox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// A grain layer: each cell is a fixed speck with its own phase and lifetime,
// fading in and out in place. "density" is the fraction of cells that are specks.
float specks(vec2 cell, float density, float speed) {
  float pick = hash(cell);
  if (pick > density) return 0.0;
  float phase = hash(cell + 17.3);
  float rate = 0.5 + hash(cell + 41.7);
  float life = fract(u_time * speed * rate + phase);
  // triangle pulse: up, then down
  float pulse = 1.0 - abs(life * 2.0 - 1.0);
  float bright = 0.4 + 0.6 * hash(cell + 3.9);
  return pulse * pulse * bright;
}

vec2 bez(vec4 a, vec4 b, float t) {
  float u = 1.0 - t;
  return u * u * u * a.xy + 3.0 * u * u * t * a.zw + 3.0 * u * t * t * b.xy + t * t * t * b.zw;
}

// Coverage of a ~4×4 device-pixel square speck centred on world point q, with
// anti-aliased edges so it glides smoothly instead of snapping between pixels.
float speckAt(vec2 px, vec2 q) {
  vec2 sp = vec2(q.x * u_zoom * u_dpr + u_offset.x, u_res.y - (q.y * u_zoom * u_dpr + u_offset.y));
  vec2 d = abs(px - sp);
  return 1.0 - smoothstep(1.5, 2.5, max(d.x, d.y));
}

// Sand grains riding each edge from dependency to dependent. Everything is in
// world units, so their speed scales with the graph, while each speck is a fixed
// 4×4 device pixels (twice the background sand).
float flow(vec2 wp, vec2 px) {
  float acc = 0.0;
  for (int i = 0; i < MAX_CURVES; i++) {
    if (i >= u_ccount) break;
    vec4 a = u_ca[i];
    vec4 b = u_cb[i];
    // Skip fragments far from the curve's bounding box (world units).
    float pad = 8.0 + 4.0 / (u_zoom * u_dpr);
    vec2 lo = min(min(a.xy, a.zw), min(b.xy, b.zw)) - pad;
    vec2 hi = max(max(a.xy, a.zw), max(b.xy, b.zw)) + pad;
    if (wp.x < lo.x || wp.y < lo.y || wp.x > hi.x || wp.y > hi.y) continue;
    float len = length(b.zw - a.xy) + 1.0;
    // One traveller per ~14 world px of edge, at least 6.
    float want = clamp(len / 14.0, 6.0, float(PER_CURVE));
    for (int k = 0; k < PER_CURVE; k++) {
      if (float(k) >= want) break;
      vec2 seed = vec2(float(i) * 7.1 + 3.0, float(k) * 13.7 + 1.0);
      float speed = (40.0 + 30.0 * hash(seed)) / len; // world px/s → curve fraction/s
      float t = fract(u_time * speed + hash(seed + 5.0));
      vec2 p = bez(a, b, t);
      vec2 tan = normalize(bez(a, b, min(t + 0.01, 1.0)) - bez(a, b, max(t - 0.01, 0.0)) + 1e-4);
      vec2 nrm = vec2(-tan.y, tan.x);
      float side = (hash(seed + 9.0) - 0.5) * 6.0 + sin(u_time * 1.5 + hash(seed + 2.0) * 6.28);
      p += nrm * side;
      float hit = speckAt(px, p);
      float life = sin(t * 3.1416); // in after leaving the source, out before the arrow
      float flick = 0.7 + 0.3 * sin(u_time * 5.0 + hash(seed + 6.0) * 6.28);
      float bright = 0.4 + 0.6 * hash(seed + 4.0);
      acc = max(acc, hit * life * flick * bright * u_cstrength[i]);
    }
  }
  return acc;
}

// Dot grid drawn per pixel from world coordinates (lattice 16 + step·k), so dots
// never depend on how a repeating background gets snapped to pixels. Anti-aliased.
float dots(vec2 wp, float step, float scale, float r) {
  vec2 q = mod(wp - 16.0, step) - step * 0.5;
  float d = length(q) * scale;
  return 1.0 - smoothstep(r - 0.5, r + 0.5, d);
}

// Two layers of specks (coarse sand + finer dust) on a world grid. The cell size is
// picked per power-of-two zoom band so specks stay ~1-2 device pixels, and
// neighbouring bands are crossfaded so nothing pops when zoom crosses a boundary.
float sand(vec2 w, float zoom, float dens) {
  float lv = log2(2.0 / (zoom * u_dpr));
  float l0 = floor(lv);
  float t = smoothstep(0.0, 1.0, lv - l0);
  float s0 = exp2(l0);
  float s1 = s0 * 2.0;
  float coarse = mix(specks(floor(w / s0), dens, 0.35), specks(floor(w / s1) + 50.0, dens, 0.35), t);
  float dust = mix(specks(floor(w / (s0 * 0.5)) + 100.0, 0.25, 0.6), specks(floor(w / s0) + 150.0, 0.25, 0.6), t) * 0.5;
  return coarse + dust;
}

void main() {
  vec2 px = gl_FragCoord.xy;

  // Vignette: a thin band along the frame, shaped as a rounded rectangle so the
  // corners read as one smooth curve rather than two overlapping edges.
  float reach = 24.0 * u_dpr;
  float frame = rbox(px - u_res * 0.5, u_res * 0.5, 48.0 * u_dpr);
  float vig = smoothstep(-reach, 0.0, frame);
  vig = vig * vig;

  // Halo around each selected node (rects come in with a top-left origin).
  // The inside of the rect is cut out: grain belongs to the background.
  float glow = 0.0;
  for (int i = 0; i < MAX_RECTS; i++) {
    if (i >= u_count) break;
    vec4 r = u_rects[i];
    vec2 c = vec2(r.x + r.z * 0.5, u_res.y - (r.y + r.w * 0.5));
    float d = rbox(px - c, r.zw * 0.5, 24.0 * u_dpr * u_zoom);
    float halo = 1.0 - smoothstep(0.0, 27.0 * u_dpr * u_zoom, d);
    glow = max(glow, halo * halo * step(0.0, d) * u_strength[i]);
  }

  // World-anchored grain. Cells live in world space so specks stay glued to the
  // graph when panning and zooming. The vignette sand uses the parallax'd background
  // camera; the halo sand uses the foreground camera so it stays put around the node
  // (the two cameras disagree when zooming off-centre).
  vec2 wp = vec2(px.x - u_bg.x, (u_res.y - px.y) - u_bg.y) / (u_bg.z * u_dpr);
  vec2 fw = vec2(px.x - u_offset.x, (u_res.y - px.y) - u_offset.y) / (u_zoom * u_dpr);
  float a = 0.0;
  if (vig > 0.001) a += sand(wp, u_bg.z, 0.22) * vig * 0.55;
  if (glow > 0.001) a += sand(fw, u_zoom, 0.22 + 0.4 * glow) * glow;
  a = min(a, 1.0) * 0.6;

  // Neutral, slightly warm sand at the edges; tinted towards the accent in the halo.
  vec3 haloCol = mix(u_tint, vec3(1.0), 0.35);
  vec3 col = mix(vec3(0.95, 0.92, 0.86), haloCol, clamp(glow * 1.4, 0.0, 0.85));

  // Edge travellers take the halo colour wherever they outshine the local sand.
  float f = flow(fw, px) * 0.6;
  col = mix(col, haloCol, step(a, f));
  a = max(a, f);

  // Dot grid underneath: one 32px lattice, dots shrinking/dimming with zoom (see Canvas).
  float ga = dots(wp, 32.0, u_bg.z * u_dpr, u_grid.x) * u_grid.y * 0.11;

  // Sand over grid (premultiplied).
  gl_FragColor = vec4(col * a + vec3(ga) * (1.0 - a), a + ga * (1.0 - a));
}
