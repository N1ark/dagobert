/** Half-width of the square everything lives in; small enough for float32 in the grain shader. */
export const WORLD = 20000;

/** How far past the world edge the camera may look, in screen px, so the border is visible. */
export const MARGIN = 120;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** The offset (zoom untouched) that keeps the view inside the world plus `MARGIN` screen px. */
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

/** Bounding box of `notes` in world coordinates (empty when there are none). */
export function notesBounds(
  notes: { id: string; x: number; y: number; width?: number | null }[],
  widthOf: (n: { width?: number | null }) => number,
  heightOf: (id: string) => number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of notes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + widthOf(n));
    maxY = Math.max(maxY, n.y + heightOf(n.id));
  }
  return { minX, minY, maxX, maxY };
}
