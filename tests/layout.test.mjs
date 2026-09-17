import assert from "node:assert/strict";
import { layout } from "../src/lib/layout.ts";

const n = (id, deps = [], width = 220, height = 60) => ({ id, deps, width, height });

// a -> b -> d, a -> c -> d, plus an island e
const nodes = [n("d", ["b", "c"]), n("b", ["a"]), n("c", ["a"]), n("a"), n("e")];
const pos = layout(nodes);
assert.equal(pos.size, 5);

// Layers: deps strictly left of dependents.
for (const node of nodes) for (const d of node.deps) assert.ok(pos.get(d).x < pos.get(node.id).x, `${d} left of ${node.id}`);
assert.equal(pos.get("b").x, pos.get("c").x, "same layer, same column");
assert.equal(pos.get("a").x, 0);

// No overlaps.
const rects = nodes.map((x) => ({ ...x, ...pos.get(x.id) }));
for (const p of rects)
  for (const q of rects) {
    if (p.id === q.id) continue;
    const overlap = p.x < q.x + q.width && p.x + p.width > q.x && p.y < q.y + q.height && p.y + p.height > q.y;
    assert.ok(!overlap, `${p.id} overlaps ${q.id}`);
  }

// Island stacked below the connected component.
const mainBottom = Math.max(...["a", "b", "c", "d"].map((id) => pos.get(id).y + 60));
assert.ok(pos.get("e").y >= mainBottom, "island below");

// Origin respected; deterministic.
const shifted = layout(nodes, { originX: 100, originY: 50 });
assert.equal(shifted.get("a").x, 100);
assert.deepEqual([...layout(nodes)], [...pos]);

// Dangling deps are ignored.
assert.equal(layout([n("x", ["ghost"])]).get("x").x, 0);
console.log("layout ok");
