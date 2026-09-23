/** Layered layout for the DAG: dependencies left, dependents right, as the edges are drawn. */

export interface LayoutNode {
  id: string;
  /** IDs this node depends on (drawn to its left). */
  deps: string[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** Horizontal gap between layers. */
  gapX?: number;
  /** Vertical gap between nodes in a layer. */
  gapY?: number;
  /** Vertical gap between disconnected components. */
  gapComponent?: number;
  /** Top-left corner of the result. */
  originX?: number;
  originY?: number;
}

export type Positions = Map<string, { x: number; y: number }>;

/** Longest-path layering: layer = 1 + max(layer of deps), roots are 0. */
function layers(nodes: LayoutNode[], byId: Map<string, LayoutNode>): Map<string, number> {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const layerOf = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle guard (the store forbids cycles anyway)
    visiting.add(id);
    const n = byId.get(id)!;
    let l = 0;
    for (const d of n.deps) if (byId.has(d)) l = Math.max(l, layerOf(d) + 1);
    visiting.delete(id);
    memo.set(id, l);
    return l;
  };
  for (const n of nodes) layerOf(n.id);
  return memo;
}

/** Connected components (undirected), in first-seen order. */
function components(nodes: LayoutNode[], byId: Map<string, LayoutNode>): LayoutNode[][] {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const n of nodes) {
    for (const d of n.deps) {
      if (!byId.has(d)) continue;
      adj.get(n.id)!.add(d);
      adj.get(d)!.add(n.id);
    }
  }
  const seen = new Set<string>();
  const out: LayoutNode[][] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const comp: LayoutNode[] = [];
    const stack = [n.id];
    seen.add(n.id);
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(byId.get(id)!);
      for (const m of adj.get(id)!) {
        if (!seen.has(m)) {
          seen.add(m);
          stack.push(m);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/** Lay out one connected component; returns positions relative to (0, 0) and its size. */
function layoutComponent(nodes: LayoutNode[], byId: Map<string, LayoutNode>, gapX: number, gapY: number) {
  const layerOf = layers(nodes, byId);
  const depth = Math.max(0, ...nodes.map((n) => layerOf.get(n.id)!)) + 1;
  const cols: LayoutNode[][] = Array.from({ length: depth }, () => []);
  for (const n of nodes) cols[layerOf.get(n.id)!].push(n);
  // Stable initial order so results don't jitter between runs.
  for (const c of cols) c.sort((a, b) => a.id.localeCompare(b.id));

  const dependents = new Map<string, string[]>();
  for (const n of nodes) for (const d of n.deps) if (byId.has(d)) (dependents.get(d) ?? dependents.set(d, []).get(d)!).push(n.id);

  // Barycenter ordering: a few sweeps left→right then right→left.
  const pos = new Map<string, number>();
  const reindex = () => cols.forEach((c) => c.forEach((n, i) => pos.set(n.id, i)));
  reindex();
  const sweep = (col: LayoutNode[], neighbours: (n: LayoutNode) => string[]) => {
    const bary = new Map<string, number>();
    for (const n of col) {
      const ns = neighbours(n).filter((id) => pos.has(id));
      bary.set(n.id, ns.length ? ns.reduce((s, id) => s + pos.get(id)!, 0) / ns.length : pos.get(n.id)!);
    }
    col.sort((a, b) => bary.get(a.id)! - bary.get(b.id)! || a.id.localeCompare(b.id));
    col.forEach((n, i) => pos.set(n.id, i));
  };
  for (let iter = 0; iter < 4; iter++) {
    for (let l = 1; l < depth; l++) sweep(cols[l], (n) => n.deps);
    for (let l = depth - 2; l >= 0; l--) sweep(cols[l], (n) => dependents.get(n.id) ?? []);
  }

  // Column x offsets from the widest node in each layer.
  const colX: number[] = [];
  let x = 0;
  const colHeights: number[] = [];
  for (let l = 0; l < depth; l++) {
    colX.push(x);
    const w = Math.max(...cols[l].map((n) => n.width));
    x += w + gapX;
    colHeights.push(cols[l].reduce((s, n) => s + n.height, 0) + gapY * (cols[l].length - 1));
  }
  const totalW = x - gapX;
  const totalH = Math.max(...colHeights);

  // Stack each column, vertically centred against the tallest column.
  const out: Positions = new Map();
  for (let l = 0; l < depth; l++) {
    let y = (totalH - colHeights[l]) / 2;
    for (const n of cols[l]) {
      out.set(n.id, { x: colX[l], y });
      y += n.height + gapY;
    }
  }
  return { positions: out, width: totalW, height: totalH };
}

/** Compute tidy positions for every node. Pure; the caller applies them. */
export function layout(nodes: LayoutNode[], opts: LayoutOptions = {}): Positions {
  const gapX = opts.gapX ?? 80;
  const gapY = opts.gapY ?? 24;
  const gapComponent = opts.gapComponent ?? 64;
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: Positions = new Map();
  let y = originY;
  // Bigger components first so the busy graph is on top.
  const comps = components(nodes, byId).sort((a, b) => b.length - a.length || a[0].id.localeCompare(b[0].id));
  for (const comp of comps) {
    const { positions, height } = layoutComponent(comp, byId, gapX, gapY);
    for (const [id, p] of positions) out.set(id, { x: Math.round(originX + p.x), y: Math.round(y + p.y) });
    y += height + gapComponent;
  }
  return out;
}
