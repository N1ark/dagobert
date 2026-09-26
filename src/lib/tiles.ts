/** The desktop's panels and the canvas, tiled by a tree of splits; closed panels stay in it, hidden. */
export type Pane = "note" | "prs" | "trash" | "settings";
export type Id = Pane | "canvas";
export type Side = "left" | "right" | "top" | "bottom";
export type Leaf = { id: Id; size: number };
/** `size` is a weight against the siblings; a row lays its kids out left to right, a column top to bottom. */
export type Split = { dir: "row" | "col"; kids: Tile[]; size: number };
export type Tile = Leaf | Split;
export type Layout = { tree: Tile; popups: Pane[] };
export type Rect = { x: number; y: number; w: number; h: number };
/** A visible tile; `src` is the node in the layout that owns its size. */
export type Shown = { size: number; src: Tile } & ({ id: Id } | { dir: "row" | "col"; kids: Shown[] });
/** Where a dragged pane lands: against a side of a tile, of the whole layout (`at: null`), or over it. */
export type Drop = { side: Side; at: Id | null } | "popup";
/** The divider between two neighbouring tiles, with their lengths when it was laid out. */
export type Handle = { row: boolean; rect: Rect; a: Shown; b: Shown; lenA: number; lenB: number };

export const PANES: Pane[] = ["note", "prs", "trash", "settings"];

export const DEFAULT_LAYOUT: Layout = {
  tree: {
    dir: "row",
    size: 1,
    kids: [
      { id: "prs", size: 0.22 },
      { id: "canvas", size: 0.48 },
      { id: "note", size: 0.3 },
    ],
  },
  popups: ["trash", "settings"],
};

/** A popup's size belongs to the pane; `fit` makes `h` a most, not a size. */
export const POPUP: Record<Pane, { w: number; h: number; fit?: boolean }> = {
  note: { w: 680, h: 760 },
  prs: { w: 460, h: 600 },
  trash: { w: 560, h: 480, fit: true },
  settings: { w: 600, h: 520 },
};

/** The divider between tiles. */
export const GAP = 1;
/** No tile is dragged smaller than this. */
export const MIN = 200;
/** How close to the layout's edge a drop takes the whole side. */
const EDGE = 24;

const isSplit = (t: Tile): t is Split => "kids" in t;
const axis = (s: Side) => (s === "left" || s === "right" ? "row" : "col");
const first = (s: Side) => s === "left" || s === "top";

function leaves(t: Tile): Id[] {
  return isSplit(t) ? t.kids.flatMap(leaves) : [t.id];
}

/** Whether a stored layout holds the canvas and every pane exactly once. */
export function valid(l: unknown): l is Layout {
  if (!l || typeof l !== "object") return false;
  const { tree, popups } = l as Layout;
  if (!tree || !Array.isArray(popups)) return false;
  const ids = [...leaves(tree), ...popups].sort();
  return JSON.stringify(ids) === JSON.stringify([...PANES, "canvas"].sort());
}

/** The tree with only the open tiles; a split left holding one tile gives way to it. */
export function visible(t: Tile, open: (id: Id) => boolean): Shown | null {
  if (!isSplit(t)) return open(t.id) ? { id: t.id, size: t.size, src: t } : null;
  const kids = t.kids.map((k) => visible(k, open)).filter((k): k is Shown => !!k);
  if (!kids.length) return null;
  if (kids.length === 1) return { ...kids[0], size: t.size, src: t };
  return { dir: t.dir, kids, size: t.size, src: t };
}

/** Each visible tile's rect inside `r`, and the dividers between them. */
export function arrange(t: Shown, r: Rect, out = { rects: new Map<Id, Rect>(), handles: [] as Handle[] }) {
  if (!("kids" in t)) {
    out.rects.set(t.id, r);
    return out;
  }
  const row = t.dir === "row";
  const n = t.kids.length;
  const total = t.kids.reduce((sum, k) => sum + k.size, 0);
  const free = (row ? r.w : r.h) - GAP * (n - 1);
  // Tiles below the minimum are brought up to it, out of the larger ones.
  const floor = Math.min(MIN, free / n);
  const want = t.kids.map((k) => (free * k.size) / total);
  const need = want.reduce((sum, l) => sum + Math.max(0, floor - l), 0);
  const spare = want.reduce((sum, l) => sum + Math.max(0, l - floor), 0);
  const fit = want.map((l) => (l < floor ? floor : l - (spare ? ((l - floor) * need) / spare : 0)));
  const start = row ? r.x : r.y;
  const edges: number[] = [];
  let acc = 0;
  fit.forEach((l, i) => ((acc += l), edges.push(i === n - 1 ? start + (row ? r.w : r.h) : Math.round(start + acc + GAP * i))));
  let pos = start;
  t.kids.forEach((k, i) => {
    const end = edges[i];
    arrange(k, row ? { x: pos, y: r.y, w: end - pos, h: r.h } : { x: r.x, y: pos, w: r.w, h: end - pos }, out);
    if (i < n - 1) {
      const rect = row ? { x: end, y: r.y, w: GAP, h: r.h } : { x: r.x, y: end, w: r.w, h: GAP };
      const lenB = edges[i + 1] - end - GAP;
      out.handles.push({ row, rect, a: k, b: t.kids[i + 1], lenA: end - pos, lenB });
    }
    pos = end + GAP;
  });
  return out;
}

/** Moves the divider `h` by `d` pixels; `total` is its two tiles' weights when the drag began. */
export function resize(h: Handle, d: number, total: number) {
  const len = h.lenA + h.lenB;
  const a = Math.max(Math.min(MIN, len / 2), Math.min(len - Math.min(MIN, len / 2), h.lenA + d));
  h.a.src.size = (total * a) / len;
  h.b.src.size = total - h.a.src.size;
}

/** What a drop at (x, y), inside a layout `w` by `h` laid out as `rects`, would do with `pane`. */
export function dropAt(x: number, y: number, w: number, h: number, rects: Map<Id, Rect>, pane: Pane): Drop | null {
  const near = (d: [Side, number][]) => d.reduce((a, b) => (b[1] < a[1] ? b : a));
  const [side, dist] = near([
    ["left", x],
    ["right", w - x],
    ["top", y],
    ["bottom", h - y],
  ]);
  if (dist < 0) return null;
  if (dist < EDGE) return { side, at: null };
  for (const [id, r] of rects) {
    if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
    if (id === pane) return null;
    const nx = (x - r.x) / r.w;
    const ny = (y - r.y) / r.h;
    if (id === "canvas" && Math.abs(nx - 0.5) < 0.25 && Math.abs(ny - 0.5) < 0.25) return "popup";
    const [s] = near([
      ["left", nx],
      ["right", 1 - nx],
      ["top", ny],
      ["bottom", 1 - ny],
    ]);
    return { side: s, at: id };
  }
  return null;
}

/** How much of the tile it lands against a dropped pane takes. */
const share = (at: Id | null) => (at === null ? 0.25 : at === "canvas" ? 0.3 : 0.5);

/** The rect a drop's pane would take, in the layout's coordinates. */
export function previewOf(d: Exclude<Drop, "popup">, w: number, h: number, rects: Map<Id, Rect>): Rect {
  const r = d.at === null ? { x: 0, y: 0, w, h } : rects.get(d.at)!;
  const f = share(d.at);
  if (d.side === "left") return { ...r, w: r.w * f };
  if (d.side === "right") return { ...r, x: r.x + r.w * (1 - f), w: r.w * f };
  if (d.side === "top") return { ...r, h: r.h * f };
  return { ...r, y: r.y + r.h * (1 - f), h: r.h * f };
}

function parentOf(t: Tile, child: Tile): Split | null {
  if (!isSplit(t)) return null;
  if (t.kids.includes(child)) return t;
  for (const k of t.kids) {
    const p = parentOf(k, child);
    if (p) return p;
  }
  return null;
}

function find(t: Tile, id: Id): Leaf | null {
  if (!isSplit(t)) return t.id === id ? t : null;
  for (const k of t.kids) {
    const f = find(k, id);
    if (f) return f;
  }
  return null;
}

function replace(l: Layout, old: Tile, next: Tile) {
  const p = parentOf(l.tree, old);
  if (p) p.kids[p.kids.indexOf(old)] = next;
  else l.tree = next;
}

/** Takes `pane` out of the tree, folding away a split it leaves with one tile. */
function detach(l: Layout, pane: Pane) {
  l.popups = l.popups.filter((p) => p !== pane);
  const leaf = find(l.tree, pane);
  const p = leaf && parentOf(l.tree, leaf);
  if (!leaf || !p) return;
  p.kids.splice(p.kids.indexOf(leaf), 1);
  if (p.kids.length > 1) return;
  const only = p.kids[0];
  only.size = p.size;
  const gp = parentOf(l.tree, p);
  // A split folding into a parent of the same direction joins it rather than nesting.
  if (gp && isSplit(only) && only.dir === gp.dir) {
    const total = only.kids.reduce((n, k) => n + k.size, 0);
    for (const k of only.kids) k.size = (k.size / total) * only.size;
    gp.kids.splice(gp.kids.indexOf(p), 1, ...only.kids);
  } else replace(l, p, only);
}

/** The layout with `pane` moved to `drop`; `open` says which tiles are showing, to size it against them. */
export function place(from: Layout, pane: Pane, drop: Drop, open: (id: Id) => boolean): Layout {
  if (drop !== "popup" && drop.at === pane) return from;
  const l: Layout = structuredClone(from);
  detach(l, pane);
  if (drop === "popup") {
    l.popups.push(pane);
    return l;
  }
  const dir = axis(drop.side);
  const f = share(drop.at);
  const target = drop.at === null ? l.tree : find(l.tree, drop.at);
  if (!target) return from;
  const p = parentOf(l.tree, target);
  if (p?.dir === dir || (drop.at === null && isSplit(target) && target.dir === dir)) {
    const host = p?.dir === dir ? p : (target as Split);
    // Weighed against what's showing, so a hidden sibling doesn't shrink or swell it.
    const shownTotal = host.kids.filter((k) => visible(k, open)).reduce((n, k) => n + k.size, 0);
    const leaf: Leaf = { id: pane, size: host === p ? target.size * f : (shownTotal * f) / (1 - f) };
    if (host === p) target.size -= leaf.size;
    const at = host === p ? host.kids.indexOf(target) + (first(drop.side) ? 0 : 1) : first(drop.side) ? 0 : host.kids.length;
    host.kids.splice(at, 0, leaf);
    return l;
  }
  const leaf: Leaf = { id: pane, size: f };
  const split: Split = { dir, size: target.size, kids: [] };
  replace(l, target, split);
  target.size = 1 - f;
  split.kids = first(drop.side) ? [leaf, target] : [target, leaf];
  return l;
}
