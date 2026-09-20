// Traveller pass, fragment stage: coverage of a ~4×4 device-pixel square speck
// centred on v_centre, with anti-aliased edges so it glides between pixels.
// Written into the flow texture with MAX blending (max over overlapping specks).
precision highp float;
varying vec2 v_centre;
varying float v_val;

void main() {
  vec2 d = abs(gl_FragCoord.xy - v_centre);
  float g = (1.0 - smoothstep(1.5, 2.5, max(d.x, d.y))) * v_val;
  gl_FragColor = vec4(g);
}
