// Background grain for the graph view. Loaded by grainGL.ts (Vite `?raw`), which
// prepends `#define MAX_RECTS / MAX_CURVES` and grain.glsl (hash, bez).
//
// Layers, back to front:
//   - dot grid (world lattice, parallax'd background camera)
//   - sand: twinkling specks under a frame vignette (background camera) and a halo
//     around the selected nodes (foreground camera, so it sticks to the node)
//   - travellers: sand grains riding each edge of the selected node's chain, drawn
//     by the traveller pass (travellers.vert/.frag) into u_flow and sampled here
//
uniform vec2 u_res;
uniform float u_time;
uniform float u_dpr;
uniform int u_count;
uniform vec4 u_rects[MAX_RECTS];
uniform float u_strength[MAX_RECTS];
uniform vec2 u_offset;
uniform int u_ccount;
uniform sampler2D u_flow; // traveller pass output (device-pixel sized), .r = coverage
uniform float u_zoom;
uniform vec3 u_bg; // background camera: offset.xy (device px), zoom
uniform vec2 u_grid; // dot grid: radius (device px), opacity
uniform vec3 u_tint;

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

// Dot grid drawn per pixel from world coordinates (lattice 16 + step·k), so dots
// never depend on how a repeating background gets snapped to pixels. Anti-aliased.
float dots(vec2 wp, float step, float scale, float r) {
  vec2 q = mod(wp - 16.0, step) - step * 0.5;
  float d = length(q) * scale;
  return 1.0 - smoothstep(r - 0.5, r + 0.5, d);
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
  float f = 0.0;
  if (u_ccount > 0) f = texture2D(u_flow, px / u_res).r * 0.6;
  col = mix(col, haloCol, step(a, f));
  a = max(a, f);

  // Dot grid underneath: one 32px lattice, dots shrinking/dimming with zoom (see Canvas).
  float ga = dots(wp, 32.0, u_bg.z * u_dpr, u_grid.x) * u_grid.y * 0.11;

  // Sand over grid (premultiplied).
  gl_FragColor = vec4(col * a + vec3(ga) * (1.0 - a), a + ga * (1.0 - a));
}
