import assert from "node:assert/strict";
import { test } from "node:test";
import { WORLD, MARGIN, clampViewport, clampNode } from "../src/lib/viewport.ts";

test("viewport inside the world is untouched", () => {
  assert.deepEqual(clampViewport({ x: 100, y: -50, zoom: 1 }, 800, 600), { x: 100, y: -50 });
});

test("viewport is pulled back to the world edge plus the margin", () => {
  // Left edge of the view at world x = -WORLD - 500 → clamp so it sits MARGIN px past -WORLD.
  const v = clampViewport({ x: (WORLD + 500) * 0.5, y: 0, zoom: 0.5 }, 800, 600);
  assert.equal(v.x, WORLD * 0.5 + MARGIN);
  // Right edge past +WORLD.
  const r = clampViewport({ x: 800 - WORLD * 2 - 1000, y: 0, zoom: 2 }, 800, 600);
  assert.equal(r.x, 800 - WORLD * 2 - MARGIN);
});

test("view wider than the world is centred", () => {
  const v = clampViewport({ x: 1e9, y: 0, zoom: 0.01 }, 800, 600);
  assert.equal(v.x, 400);
});

test("nodes are kept inside the world", () => {
  assert.deepEqual(clampNode(1e6, -1e6, 220, 80), { x: WORLD - 220, y: -WORLD });
  assert.deepEqual(clampNode(5, 6, 220, 80), { x: 5, y: 6 });
});
