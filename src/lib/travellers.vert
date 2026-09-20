// Traveller pass, vertex stage: one small quad per sand grain riding an edge.
// Each vertex carries (curve index, traveller index, corner.xy); the grain's
// position along the bezier, its sideways wander and its brightness are computed
// here exactly as the original per-fragment loop did, then the quad is placed
// around it in screen space. The fragment stage draws the anti-aliased speck.
attribute vec4 a_data;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dpr;
uniform float u_zoom;
uniform vec2 u_offset;
uniform vec4 u_ca[MAX_CURVES]; // p0.xy, p1.xy (world units)
uniform vec4 u_cb[MAX_CURVES]; // p2.xy, p3.xy
uniform float u_cstrength[MAX_CURVES];
varying vec2 v_centre;
varying float v_val;

void main() {
  int i = int(a_data.x);
  float k = a_data.y;
  vec4 a = u_ca[i];
  vec4 b = u_cb[i];
  float len = length(b.zw - a.xy) + 1.0;
  vec2 seed = vec2(float(i) * 7.1 + 3.0, k * 13.7 + 1.0);
  float speed = (40.0 + 30.0 * hash(seed)) / len; // world px/s → curve fraction/s
  float t = fract(u_time * speed + hash(seed + 5.0));
  vec2 p = bez(a, b, t);
  vec2 tan = normalize(bez(a, b, min(t + 0.01, 1.0)) - bez(a, b, max(t - 0.01, 0.0)) + 1e-4);
  vec2 nrm = vec2(-tan.y, tan.x);
  float side = (hash(seed + 9.0) - 0.5) * 6.0 + sin(u_time * 1.5 + hash(seed + 2.0) * 6.28);
  p += nrm * side;
  float life = sin(t * 3.1416); // in after leaving the source, out before the arrow
  float flick = 0.7 + 0.3 * sin(u_time * 5.0 + hash(seed + 6.0) * 6.28);
  float bright = 0.4 + 0.6 * hash(seed + 4.0);
  v_val = life * flick * bright * u_cstrength[i];
  // Project to device pixels (bottom-up, like gl_FragCoord).
  v_centre = vec2(p.x * u_zoom * u_dpr + u_offset.x, u_res.y - (p.y * u_zoom * u_dpr + u_offset.y));
  // The speck's coverage reaches 2.5 px from its centre; 3.5 gives a safe margin.
  vec2 pos = v_centre + a_data.zw * 3.5;
  gl_Position = vec4(pos / u_res * 2.0 - 1.0, 0.0, 1.0);
}
