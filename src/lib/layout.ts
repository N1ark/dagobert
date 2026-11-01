/** Layered (Sugiyama) layout for the DAG: dependencies left, dependents right, as the edges are drawn. */
import { edgeHandle } from "./viewport.ts";

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
  /** Gap between disconnected components. */
  gapComponent?: number;
  /** Top-left corner of the result. */
  originX?: number;
  originY?: number;
}

export type Positions = Map<string, { x: number; y: number }>;

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** How far (0–1) the canvas's edge curve from x0 to x1 has moved from source to target height at x. */
function curveAt(x0: number, x1: number): (x: number) => number {
  const d = edgeHandle({ x: x0 }, { x: x1 });
  const [p1, p2, p3] = [x0 + d, x1 - d, x1 - 5];
  const xAt = (t: number) => {
    const u = 1 - t;
    return u * u * u * x0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  };
  return (x) => {
    if (x <= x0) return 0;
    if (x >= p3) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (xAt(m) < x) lo = m;
      else hi = m;
    }
    const t = (lo + hi) / 2;
    return t * t * (3 - 2 * t);
  };
}

/** Least-squares positions keeping `order` with gaps `gap[i]` between i and i+1 (pool adjacent violators). */
function pack(want: number[], weight: number[], gap: number[]): number[] {
  const off = [0];
  for (let i = 1; i < want.length; i++) off.push(off[i - 1] + gap[i - 1]);
  const bw: number[] = [];
  const bz: number[] = [];
  const bn: number[] = [];
  for (let i = 0; i < want.length; i++) {
    let w = weight[i];
    let z = (want[i] - off[i]) * w;
    let n = 1;
    while (bw.length && bz[bz.length - 1] / bw[bw.length - 1] > z / w) {
      w += bw.pop()!;
      z += bz.pop()!;
      n += bn.pop()!;
    }
    bw.push(w);
    bz.push(z);
    bn.push(n);
  }
  const out: number[] = [];
  for (let b = 0; b < bw.length; b++) for (let j = 0; j < bn[b]; j++) out.push(bz[b] / bw[b] + off[out.length]);
  return out;
}

/** A linear form over heights: variable index → coefficient, the constant under key -1. */
type Form = Map<number, number>;
/** Σ coef·y[var] ≤ b, enforced with a force of at most `cap` (Infinity = hard). */
type Row = { vars: number[]; coef: number[]; b: number; cap: number };

/** Move `y` as little as possible (least squares) to satisfy `rows`: Hildreth's dual coordinate ascent. */
function project(y: number[], rows: Row[]) {
  const lambda = rows.map(() => 0);
  for (let sweep = 0, moved = Infinity; moved > 0.01 && sweep < 400; sweep++) {
    moved = 0;
    rows.forEach((r, k) => {
      let viol = -r.b;
      let norm = 0;
      r.vars.forEach((v, i) => {
        viol += r.coef[i] * y[v];
        norm += r.coef[i] ** 2;
      });
      const next = Math.min(r.cap, Math.max(0, lambda[k] + viol / norm));
      const d = next - lambda[k];
      if (!d) return;
      lambda[k] = next;
      r.vars.forEach((v, i) => (y[v] -= d * r.coef[i]));
      moved = Math.max(moved, Math.abs(d));
    });
  }
}

/** Connected components (undirected), in first-seen order. */
function components(nodes: LayoutNode[], byId: Map<string, LayoutNode>): LayoutNode[][] {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const n of nodes) {
    for (const d of n.deps) {
      if (!byId.has(d) || d === n.id) continue;
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

/** Layers that keep every edge pointing right while making the edges, in total, as short as possible. */
function rank(n: number, ins: number[][], outs: number[][], topo: number[]): number[] {
  const layer = new Array<number>(n).fill(0);
  for (const v of topo) for (const d of ins[v]) layer[v] = Math.max(layer[v], layer[d] + 1);
  // Coordinate descent on the total span: a node slides toward its side with more edges.
  for (let pass = 0, moved = true; moved && pass < 32; pass++) {
    moved = false;
    for (const v of [...topo].reverse().concat(topo)) {
      if (ins[v].length === outs[v].length) continue;
      const to =
        ins[v].length > outs[v].length ? Math.max(...ins[v].map((d) => layer[d] + 1)) : Math.min(...outs[v].map((o) => layer[o] - 1));
      if (to !== layer[v]) {
        layer[v] = to;
        moved = true;
      }
    }
  }
  const used = [...new Set(layer)].sort((a, b) => a - b);
  const dense = new Map(used.map((l, i) => [l, i]));
  return layer.map((l) => dense.get(l)!);
}

/** Order the vertices of each layer to keep edge crossings few: barycenter sweeps plus transposition. */
function order(layers: number[][], up: number[][], down: number[][]) {
  const pos: number[] = [];
  const reindex = (l: number[]) => l.forEach((v, i) => (pos[v] = i));
  layers.forEach(reindex);
  const crossings = () => {
    let c = 0;
    for (let l = 0; l + 1 < layers.length; l++) {
      const pairs: [number, number][] = [];
      for (const u of layers[l]) for (const w of down[u]) pairs.push([pos[u], pos[w]]);
      pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const tree = new Array<number>(layers[l + 1].length + 1).fill(0);
      pairs.forEach(([, p], i) => {
        let below = 0;
        for (let j = p + 1; j > 0; j -= j & -j) below += tree[j];
        c += i - below;
        for (let j = p + 1; j < tree.length; j += j & -j) tree[j]++;
      });
    }
    return c;
  };
  const cross = (u: number, v: number) => {
    let c = 0;
    for (const nb of [up, down]) for (const a of nb[u]) for (const b of nb[v]) if (pos[a] > pos[b]) c++;
    return c;
  };
  const transpose = () => {
    for (let pass = 0, swapped = true; swapped && pass < 8; pass++) {
      swapped = false;
      for (const layer of layers) {
        for (let i = 0; i + 1 < layer.length; i++) {
          const [u, v] = [layer[i], layer[i + 1]];
          if (cross(v, u) < cross(u, v)) {
            [layer[i], layer[i + 1]] = [v, u];
            [pos[u], pos[v]] = [i + 1, i];
            swapped = true;
          }
        }
      }
    }
  };
  const sweep = (layer: number[], nb: number[][]) => {
    const key = new Map<number, number>();
    for (const v of layer) key.set(v, nb[v].length ? nb[v].reduce((s, w) => s + pos[w], 0) / nb[v].length : pos[v]);
    layer.sort((a, b) => key.get(a)! - key.get(b)! || pos[a] - pos[b]);
    reindex(layer);
  };
  transpose();
  let best = layers.map((l) => [...l]);
  let bestC = crossings();
  for (let it = 0; it < 24 && bestC > 0; it++) {
    if (it % 2 === 0) for (let l = 1; l < layers.length; l++) sweep(layers[l], up);
    else for (let l = layers.length - 2; l >= 0; l--) sweep(layers[l], down);
    transpose();
    const c = crossings();
    if (c < bestC) [best, bestC] = [layers.map((l) => [...l]), c];
  }
  best.forEach((l, i) => (layers[i] = l));
}

/** Lay out one connected component; returns positions relative to (0, 0) and its size. */
function layoutComponent(comp: LayoutNode[], gapX: number, gapY: number) {
  const nodes = [...comp].sort((a, b) => byKey(a.id, b.id));
  const n = nodes.length;
  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  const deps = nodes.map((nd) =>
    [...new Set(nd.deps)].map((d) => index.get(d)).filter((d): d is number => d !== undefined && d !== index.get(nd.id)),
  );

  // Topological order (Kahn, ties by id); an edge against it can only come from a cycle and is dropped.
  const outsAll: number[][] = nodes.map(() => []);
  deps.forEach((ds, v) => ds.forEach((d) => outsAll[d].push(v)));
  const indeg = deps.map((ds) => ds.length);
  const topo: number[] = [];
  const queue = indeg.flatMap((d, v) => (d === 0 ? [v] : []));
  while (queue.length) {
    queue.sort((a, b) => a - b);
    const v = queue.shift()!;
    topo.push(v);
    for (const o of outsAll[v]) if (--indeg[o] === 0) queue.push(o);
  }
  for (let v = 0; v < n; v++) if (indeg[v] > 0) topo.push(v);
  const at = new Array<number>(n);
  topo.forEach((v, i) => (at[v] = i));
  const ins = deps.map((ds, v) => ds.filter((d) => at[d] < at[v]));
  const outs: number[][] = nodes.map(() => []);
  ins.forEach((ds, v) => ds.forEach((d) => outs[d].push(v)));
  const layerOf = rank(n, ins, outs, topo);
  const depth = Math.max(...layerOf) + 1;

  const colW = new Array<number>(depth).fill(0);
  nodes.forEach((nd, v) => (colW[layerOf[v]] = Math.max(colW[layerOf[v]], nd.width)));
  const colX = [0];
  for (let l = 1; l < depth; l++) colX.push(colX[l - 1] + colW[l - 1] + gapX);

  // Edges spanning several layers get a dummy vertex per layer they cross, so that layer leaves them a lane.
  const edges: { s: number; t: number; at: (x: number) => number }[] = [];
  const up: number[][] = nodes.map(() => []);
  const down: number[][] = nodes.map(() => []);
  const vLayer = [...layerOf];
  const dummy: { e: number; s: number; lo: number; hi: number }[] = [];
  ins.forEach((ds, t) =>
    ds.forEach((s) => {
      const e = edges.length;
      const [x0, x1] = [colX[layerOf[s]] + nodes[s].width, colX[layerOf[t]]];
      const curve = curveAt(x0, x1);
      edges.push({ s, t, at: curve });
      let prev = s;
      for (let l = layerOf[s] + 1; l < layerOf[t]; l++) {
        const v = vLayer.length;
        vLayer.push(l);
        up.push([prev]);
        down.push([]);
        down[prev].push(v);
        const [lo, hi] = [curve(colX[l]), curve(colX[l] + colW[l])];
        dummy[v] = { e, s: (lo + hi) / 2, lo, hi };
        prev = v;
      }
      down[prev].push(t);
      up[t].push(prev);
    }),
  );

  // Initial order: depth-first from the leftmost nodes, then crossing reduction.
  const layers: number[][] = Array.from({ length: depth }, () => []);
  const seen = new Set<number>();
  for (const start of [...nodes.keys()].sort((a, b) => layerOf[a] - layerOf[b] || a - b)) {
    const stack = [start];
    while (stack.length) {
      const v = stack.pop()!;
      if (seen.has(v)) continue;
      seen.add(v);
      layers[vLayer[v]].push(v);
      for (let i = down[v].length - 1; i >= 0; i--) stack.push(down[v][i]);
    }
  }
  order(layers, up, down);
  // Curves from (or into) one node still bunch up in the next layer: keep them together, so no card sits between.
  for (const [l, layer] of layers.entries()) {
    for (const side of ["s", "t"] as const) {
      const groups = new Map<number, number[]>();
      for (const v of layer) {
        if (v < n) continue;
        const end = edges[dummy[v].e][side];
        if (layerOf[end] === (side === "s" ? l - 1 : l + 1)) groups.set(end, [...(groups.get(end) ?? []), v]);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const rest = layer.filter((v) => !group.includes(v));
        const median = group[group.length >> 1];
        const at = rest.length - layer.slice(layer.indexOf(median)).filter((v) => !group.includes(v)).length;
        layer.splice(0, layer.length, ...rest.slice(0, at), ...group, ...rest.slice(at));
      }
    }
  }

  // How far (0–1) a narrower node's outgoing curves turn before they leave its column.
  const tail = edges.map(({ s, at }) => at(colX[layerOf[s]] + colW[layerOf[s]]));
  const outEdges: number[][] = nodes.map(() => []);
  edges.forEach(({ s }, e) => tail[e] > 0 && outEdges[s].push(e));
  const margin = gapY * 0.75;
  const lane = gapY / 3;
  const V = vLayer.length;
  const half = (v: number) => (v < n ? nodes[v].height / 2 : 0);
  const sep = (u: number, v: number) => half(u) + half(v) + (u < n && v < n ? gapY : u < n || v < n ? margin : lane);

  // 1. Edges short and level, dummies tied to where their curve passes: a convex problem, solved layer by layer.
  const y: number[] = new Array(V).fill(0);
  for (const layer of layers) layer.forEach((v, i) => (y[v] = i ? y[layer[i - 1]] + sep(layer[i - 1], v) : 0));
  const ties: { d: number; end: number }[][] = nodes.map(() => []);
  for (let d = n; d < V; d++) {
    ties[edges[dummy[d].e].s].push({ d, end: 0 });
    ties[edges[dummy[d].e].t].push({ d, end: 1 });
  }
  const omega = (u: number, v: number) => (u < n && v < n ? 1 : u < n || v < n ? 2 : 8);
  const TIE = 4;
  const settle = (layer: number[]) => {
    const want: number[] = [];
    const weight: number[] = [];
    for (const v of layer) {
      let [a, b] = [1e-6, 1e-6 * y[v]];
      for (const u of [...up[v], ...down[v]]) [a, b] = [a + omega(u, v), b + omega(u, v) * y[u]];
      if (v >= n) {
        const { e, s } = dummy[v];
        [a, b] = [a + TIE, b + TIE * ((1 - s) * y[edges[e].s] + s * y[edges[e].t])];
      }
      for (const { d, end } of v < n ? ties[v] : []) {
        const { e, s } = dummy[d];
        const [c, rest] = end ? [s, y[d] - (1 - s) * y[edges[e].s]] : [1 - s, y[d] - s * y[edges[e].t]];
        [a, b] = [a + TIE * c * c, b + TIE * c * rest];
      }
      want.push(b / a);
      weight.push(a);
    }
    const got = pack(
      want,
      weight,
      layer.slice(1).map((v, i) => sep(layer[i], v)),
    );
    layer.forEach((v, i) => (y[v] = got[i]));
  };
  for (let it = 0; it < 48; it++) {
    if (it % 2 === 0) layers.forEach(settle);
    else for (let l = depth - 1; l >= 0; l--) settle(layers[l]);
  }

  // 2. Nudge the cards off the curves as drawn: a curve's edge in a layer is linear in its ends' heights.
  const rect = (v: number, k: number): Form =>
    new Map([
      [-1, k],
      [v, 1],
    ]);
  const curve = (e: number, f: number): Form =>
    new Map([
      [-1, 0],
      [edges[e].s, 1 - f],
      [edges[e].t, f],
    ]);
  const tails = (v: number) => outEdges[v].map((e) => curve(e, tail[e]));
  const base = [...y];
  for (let round = 0; round < 3; round++) {
    const rows: Row[] = [];
    const below = (ps: Form[], qs: Form[], gap: number, cap = 2000) =>
      ps.forEach((p) =>
        qs.forEach((q) => {
          const m = new Map(p);
          for (const [k, c] of q) m.set(k, (m.get(k) ?? 0) - c);
          const vars = [...m.keys()].filter((k) => k >= 0 && m.get(k) !== 0);
          if (vars.length) rows.push({ vars, coef: vars.map((k) => m.get(k)!), b: -gap - m.get(-1)!, cap });
        }),
      );
    for (const layer of layers) {
      const cards = layer.filter((v) => v < n);
      cards.forEach((v, i) => {
        if (!i) return;
        const u = cards[i - 1];
        below([rect(u, half(u))], [rect(v, -half(v))], gapY, Infinity);
        below(tails(u), [rect(v, -half(v))], margin);
        below([rect(u, half(u))], tails(v), margin);
      });
      const spans = layer
        .filter((d) => d >= n)
        .map((d) => {
          const { e, lo, hi } = dummy[d];
          const [a, b] = [lo, hi].map((f) => (1 - f) * y[edges[e].s] + f * y[edges[e].t]);
          return { forms: [curve(e, lo), curve(e, hi)], top: Math.min(a, b), bottom: Math.max(a, b) };
        })
        .sort((a, b) => a.top - b.top);
      // Overlapping curves pass a card on the same side, whichever is nearer.
      for (let i = 0; i < spans.length;) {
        const group = [spans[i]];
        let bottom = spans[i].bottom;
        for (i++; i < spans.length && spans[i].top < bottom + lane; i++) {
          group.push(spans[i]);
          bottom = Math.max(bottom, spans[i].bottom);
        }
        const k = cards.filter((v) => y[v] < (group[0].top + bottom) / 2).length;
        const forms = group.flatMap((g) => g.forms);
        if (k > 0) below([rect(cards[k - 1], half(cards[k - 1]))], forms, margin);
        if (k < cards.length) below(forms, [rect(cards[k], -half(cards[k]))], margin);
      }
    }
    for (let v = 0; v < n; v++) y[v] = base[v];
    project(y, rows);
  }

  // Whatever the relaxation left, cards in a layer never overlap.
  for (const layer of layers) {
    const cards = layer.filter((v) => v < n);
    const got = pack(
      cards.map((v) => y[v]),
      cards.map(() => 1),
      cards.slice(1).map((v, i) => (nodes[cards[i]].height + nodes[v].height) / 2 + gapY),
    );
    cards.forEach((v, i) => (y[v] = got[i]));
  }

  const top = Math.min(...nodes.map((nd, v) => y[v] - nd.height / 2));
  const bottom = Math.max(...nodes.map((nd, v) => y[v] + nd.height / 2));
  const out: Positions = new Map();
  nodes.forEach((nd, v) => out.set(nd.id, { x: colX[layerOf[v]], y: y[v] - nd.height / 2 - top }));
  return { positions: out, width: colX[depth - 1] + colW[depth - 1], height: bottom - top, key: nodes[0].id, size: n };
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
  // Biggest component first; the rest fill rows below it, about as wide as a screen-shaped block.
  const comps = components(nodes, byId)
    .map((c) => layoutComponent(c, gapX, gapY))
    .sort((a, b) => b.size - a.size || byKey(a.key, b.key));
  const area = comps.reduce((s, c) => s + (c.width + gapX) * (c.height + gapComponent), 0);
  const rowW = Math.max(...comps.map((c) => c.width), Math.sqrt(area * 1.6));
  let [x, y, rowH] = [0, 0, 0];
  for (const comp of comps) {
    if (x > 0 && x + comp.width > rowW) [x, y, rowH] = [0, y + rowH + gapComponent, 0];
    for (const [id, p] of comp.positions) out.set(id, { x: Math.round(originX + x + p.x), y: Math.round(originY + y + p.y) });
    x += comp.width + gapX;
    rowH = Math.max(rowH, comp.height);
  }
  return out;
}
