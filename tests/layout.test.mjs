import assert from "node:assert/strict";
import { layout } from "../src/lib/layout.ts";
import { edgeHandle } from "../src/lib/viewport.ts";

const n = (id, deps = [], width = 220, height = 60) => ({ id, deps, width, height });

const rectsOf = (nodes, pos) => new Map(nodes.map((x) => [x.id, { ...x, ...pos.get(x.id) }]));

function assertNoOverlap(nodes, pos) {
  const rects = [...rectsOf(nodes, pos).values()];
  for (const p of rects)
    for (const q of rects) {
      if (p.id === q.id) continue;
      const overlap = p.x < q.x + q.width && p.x + p.width > q.x && p.y < q.y + q.height && p.y + p.height > q.y;
      assert.ok(!overlap, `${p.id} overlaps ${q.id}`);
    }
}

/** Edges whose curve, drawn as the canvas draws it, passes through a card other than its two ends. */
function edgeHits(nodes, pos) {
  const rects = rectsOf(nodes, pos);
  const hits = [];
  for (const t of nodes)
    for (const d of t.deps) {
      const s = rects.get(d);
      if (!s) continue;
      const a = { x: s.x + s.width, y: s.y + s.height / 2 };
      const b = { x: rects.get(t.id).x, y: rects.get(t.id).y + rects.get(t.id).height / 2 };
      const dx = edgeHandle(a, b);
      const p = [a, { x: a.x + dx, y: a.y }, { x: b.x - dx, y: b.y }, { x: b.x - 5, y: b.y }];
      for (let i = 0; i <= 200; i++) {
        const u = i / 200;
        const w = [(1 - u) ** 3, 3 * (1 - u) ** 2 * u, 3 * (1 - u) * u * u, u ** 3];
        const x = w.reduce((sum, k, j) => sum + k * p[j].x, 0);
        const y = w.reduce((sum, k, j) => sum + k * p[j].y, 0);
        const r = [...rects.values()].find(
          (r) => r.id !== d && r.id !== t.id && x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height,
        );
        if (r) {
          hits.push(`${d}->${t.id} through ${r.id}`);
          break;
        }
      }
    }
  return hits;
}

function check(name, nodes) {
  const pos = layout(nodes);
  assert.equal(pos.size, nodes.length, name);
  for (const node of nodes)
    for (const d of node.deps) if (pos.has(d)) assert.ok(pos.get(d).x < pos.get(node.id).x, `${name}: ${d} left of ${node.id}`);
  assertNoOverlap(nodes, pos);
  assert.deepEqual(edgeHits(nodes, pos), [], `${name}: edges clear of cards`);
  assert.deepEqual([...layout([...nodes].reverse())].sort(), [...pos].sort(), `${name}: independent of input order`);
  return pos;
}

// a -> b -> d, a -> c -> d, plus an island e
const nodes = [n("d", ["b", "c"]), n("b", ["a"]), n("c", ["a"]), n("a"), n("e")];
const pos = check("diamond", nodes);
assert.equal(pos.get("b").x, pos.get("c").x, "same layer, same column");
assert.equal(pos.get("a").x, 0);

// Island stacked below the connected component.
const mainBottom = Math.max(...["a", "b", "c", "d"].map((id) => pos.get(id).y + 60));
assert.ok(pos.get("e").y >= mainBottom, "island below");

// Origin respected; deterministic.
const shifted = layout(nodes, { originX: 100, originY: 50 });
assert.equal(shifted.get("a").x, 100);
assert.equal(Math.min(...[...shifted.values()].map((p) => p.y)), 50);
assert.deepEqual([...layout(nodes)], [...pos]);

// Dangling deps are ignored; a lone source sits next to its only dependent.
assert.equal(layout([n("x", ["ghost"])]).get("x").x, 0);
const late = layout([n("a"), n("b", ["a"]), n("c", ["b"]), n("d", ["c", "r"]), n("r")]);
assert.equal(late.get("r").x, late.get("c").x, "source pulled next to its dependent");

// Long skip edges past a chain.
check("skips", [n("a"), n("b", ["a"]), n("c", ["b"]), n("d", ["c"]), n("e", ["d", "a"]), n("f", ["e", "b", "a"])]);

// Nested skips on both sides of a chain.
check("nested", [
  n("a"),
  n("b", ["a"]),
  n("c", ["b"]),
  n("d", ["c"]),
  n("e", ["d"]),
  n("x", ["a"]),
  n("y", ["x"]),
  n("z", ["e", "y", "a"]),
  n("w", ["b", "e"]),
]);

// Wide fan-out and fan-in, with skips across the fan.
const fan = [n("root"), n("sink", [])];
for (let i = 0; i < 10; i++) {
  fan.push(n(`k${i}`, ["root"]));
  if (i % 3 === 0) fan.push(n(`g${i}`, [`k${i}`]));
  fan[1].deps.push(i % 3 === 0 ? `g${i}` : `k${i}`);
}
fan.push(n("skip", ["root"]), n("end", ["skip", "sink", "root"]));
check("fan", fan);

// Mixed card sizes: a narrow source beside wide, tall cards.
check("sizes", [
  n("a", [], 140, 40),
  n("w", [], 640, 200),
  n("v", [], 400, 120),
  n("b", ["a", "w"], 220, 60),
  n("c", ["a", "v"], 220, 300),
  n("d", ["b", "c", "a"]),
]);

/** A deterministic pseudo-random DAG; each node depends on some of the `window` before it. */
function random(count, p, window, seed) {
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = [];
  for (let i = 0; i < count; i++) {
    const deps = [];
    for (let j = Math.max(0, i - window); j < i; j++) if (rand() < p) deps.push(`n${j}`);
    out.push(n(`n${i}`, deps, rand() < 0.15 ? 140 + Math.floor(rand() * 300) : 220, 50 + Math.floor(rand() * 60)));
  }
  return out;
}

// Project-sized graphs: hardly any edge through a card.
let [edgeCount, hitCount] = [0, 0];
for (let s = 1; s <= 20; s++) {
  const g = random(40, 0.07, 10, s * 7919);
  const p = layout(g);
  assertNoOverlap(g, p);
  edgeCount += g.reduce((sum, x) => sum + x.deps.length, 0);
  hitCount += edgeHits(g, p).length;
}
assert.ok(hitCount <= edgeCount * 0.03, `few edges through cards (${hitCount} of ${edgeCount})`);

// Quick enough for a big project.
const big = random(300, 0.04, 30, 7);
const t0 = performance.now();
const bigPos = layout(big);
const ms = performance.now() - t0;
assertNoOverlap(big, bigPos);
assert.ok(ms < 2000, `fast (${ms} ms)`);

console.log("layout ok");
