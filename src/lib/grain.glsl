// Shared GLSL for the grain shaders (prepended to grain.frag and travellers.vert,
// after `precision highp float;` and the #defines).

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

// Cubic bezier: a = p0.xy, p1.zw; b = p2.xy, p3.zw.
vec2 bez(vec4 a, vec4 b, float t) {
  float u = 1.0 - t;
  return u * u * u * a.xy + 3.0 * u * u * t * a.zw + 3.0 * u * t * t * b.xy + t * t * t * b.zw;
}
