/**
 * World bounds. Everything (nodes and the camera) lives inside the square
 * [-WORLD, WORLD]²: far enough for any real graph, close enough to the origin that
 * float32 in the grain shader keeps sub-pixel precision (the per-cell hash wraps at
 * 8192 anyway). Pan/zoom code clamps to it; `Canvas` draws the border.
 */
export const WORLD = 20000;

/** How far past the world edge the camera may look, in screen px, so the border is visible. */
export const MARGIN = 120;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Keep the visible world rectangle inside the world bounds plus `MARGIN` screen px on
 * each side (so the border is on screen when you hit the limit). Returns the clamped
 * offset (zoom untouched); when the view is wider than the world on an axis, the
 * world is centred on that axis. `viewW`/`viewH` are the canvas size in screen px.
 */
export function clampViewport(vp: Viewport, viewW: number, viewH: number): { x: number; y: number } {
  const z = vp.zoom;
  const axis = (v: number, size: number) => {
    // Screen offset ranges over [size - WORLD·z, WORLD·z] for the view to stay inside.
    const lo = size - WORLD * z - MARGIN;
    const hi = WORLD * z + MARGIN;
    if (lo > hi) return (lo + hi) / 2;
    return Math.min(hi, Math.max(lo, v));
  };
  return { x: axis(vp.x, viewW), y: axis(vp.y, viewH) };
}

/** Clamp a node's top-left so the node stays inside the world. */
export function clampNode(x: number, y: number, w: number, h: number): { x: number; y: number } {
  return {
    x: Math.min(WORLD - w, Math.max(-WORLD, x)),
    y: Math.min(WORLD - h, Math.max(-WORLD, y)),
  };
}
