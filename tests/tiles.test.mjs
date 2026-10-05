import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LAYOUT, arrange, dropAt, moves, place, repair, resize, valid, visible } from "../src/lib/tiles.ts";

const all = () => true;
const only =
  (...ids) =>
  (id) =>
    ids.includes(id);
/** The tree as nested arrays of ids, sizes rounded, to compare shapes. */
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1, `${a} ≉ ${b}`);
const shape = (t) => ("kids" in t ? { [t.dir]: t.kids.map(shape) } : t.id);

test("the default layout is valid, and a broken one isn't", () => {
  assert.ok(valid(DEFAULT_LAYOUT));
  assert.ok(!valid({ tree: { id: "canvas", size: 1 }, popups: ["trash"] }));
  assert.ok(!valid(null));
});

test("a stored layout gains panes added since as closed popups, and a broken one is dropped", () => {
  const old = {
    tree: {
      dir: "row",
      size: 1,
      kids: [
        { id: "canvas", size: 0.7 },
        { id: "note", size: 0.3 },
      ],
    },
    popups: ["prs", "trash", "settings"],
  };
  const l = repair(old);
  assert.deepEqual(l.popups, ["prs", "trash", "settings", "gallery", "calendar"]);
  assert.equal(l.tree, old.tree);
  assert.ok(valid(l));
  assert.equal(repair({ tree: { id: "canvas", size: 1 }, popups: ["canvas"] }), null, "twice");
  assert.equal(repair({ tree: { id: "note", size: 1 }, popups: [] }), null, "no canvas");
  assert.equal(repair({ tree: { id: "canvas", size: 1 }, popups: ["nope"] }), null, "unknown pane");
  assert.equal(repair(null), null);
});

test("closed panes are hidden, and a split left with one tile gives way to it", () => {
  const l = place(DEFAULT_LAYOUT, "trash", { side: "bottom", at: "note" }, all);
  assert.deepEqual(shape(l.tree), { row: ["prs", "canvas", { col: ["note", "trash"] }] });
  const v = visible(l.tree, only("canvas", "trash"));
  assert.deepEqual(shape(v), { row: ["canvas", "trash"] });
  assert.equal(v.kids[1].src, l.tree.kids[2]);
});

test("dropping on a tile's side splits it; on the layout's edge it spans the side", () => {
  const stacked = place(DEFAULT_LAYOUT, "trash", { side: "bottom", at: "note" }, all);
  const l = place(stacked, "settings", { side: "top", at: null }, all);
  assert.deepEqual(shape(l.tree), { col: ["settings", { row: ["prs", "canvas", { col: ["note", "trash"] }] }] });
  const beside = place(DEFAULT_LAYOUT, "trash", { side: "left", at: "note" }, all);
  assert.deepEqual(shape(beside.tree), { row: ["prs", "canvas", "trash", "note"] });
});

test("moving a pane away folds the split it leaves", () => {
  const stacked = place(DEFAULT_LAYOUT, "trash", { side: "bottom", at: "note" }, all);
  const l = place(stacked, "trash", "popup", all);
  assert.deepEqual(shape(l.tree), { row: ["prs", "canvas", "note"] });
  assert.ok(l.popups.includes("trash"));
  assert.ok(valid(l));
  const back = place(stacked, "note", { side: "right", at: "prs" }, all);
  assert.deepEqual(shape(back.tree), { row: ["prs", "note", "canvas", "trash"] });
});

test("moving a pane only resizes the tile it splits, and gives the room back when it leaves", () => {
  const sizes = (l) => Object.fromEntries(l.tree.kids.map((k) => [k.id, +k.size.toFixed(6)]));
  let l = place(DEFAULT_LAYOUT, "prs", { side: "left", at: null }, all);
  const start = sizes(l);
  for (const [d, lender] of [
    [{ side: "right", at: "canvas" }, "canvas"],
    [{ side: "left", at: "note" }, "note"],
    [{ side: "right", at: null }, "canvas"],
  ]) {
    l = place(l, "trash", d, all);
    for (const [id, size] of Object.entries(sizes(l))) if (id !== lender && id !== "trash") assert.equal(size, start[id]);
    l = place(l, "trash", "popup", all);
    assert.deepEqual(sizes(l), start);
  }
});

test("tiles fill the layout, with a divider between each", () => {
  const { rects, handles } = arrange(visible(DEFAULT_LAYOUT.tree, all), { x: 0, y: 0, w: 1002, h: 600 });
  assert.deepEqual(rects.get("prs"), { x: 0, y: 0, w: 220, h: 600 });
  assert.deepEqual(rects.get("canvas"), { x: 221, y: 0, w: 480, h: 600 });
  assert.deepEqual(rects.get("note"), { x: 702, y: 0, w: 300, h: 600 });
  assert.equal(handles.length, 2);
  assert.deepEqual([handles[0].lenA, handles[0].lenB], [220, 480]);
});

test("a divider trades size between its two tiles, down to the minimum", () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  const { handles } = arrange(visible(l.tree, all), { x: 0, y: 0, w: 1002, h: 600 });
  const h = handles[0];
  resize(h, 100, h.a.size + h.b.size);
  const { rects } = arrange(visible(l.tree, all), { x: 0, y: 0, w: 1002, h: 600 });
  assert.equal(rects.get("prs").w, 320);
  resize(h, -1000, 0.7);
  assert.ok(Math.abs(l.tree.kids[0].size - (0.7 * 200) / 700) < 1e-9);
});

test("a drop picks the nearest edge of the tile under it; the canvas's middle pops up", () => {
  const { rects } = arrange(visible(DEFAULT_LAYOUT.tree, all), { x: 0, y: 0, w: 1002, h: 600 });
  assert.deepEqual(dropAt(10, 300, 1002, 600, rects, "note"), { side: "left", at: null });
  assert.deepEqual(dropAt(100, 560, 1002, 600, rects, "note"), { side: "bottom", at: "prs" });
  assert.equal(dropAt(460, 300, 1002, 600, rects, "note"), "popup");
  assert.deepEqual(dropAt(250, 300, 1002, 600, rects, "note"), { side: "left", at: "canvas" });
  assert.equal(dropAt(800, 300, 1002, 600, rects, "note"), null);
});

test("a drop that would leave the pane where it is isn't one", () => {
  const l = place(DEFAULT_LAYOUT, "trash", { side: "right", at: "note" }, all);
  assert.ok(!moves(l, "trash", { side: "right", at: "note" }, all));
  assert.ok(!moves(l, "note", { side: "left", at: "trash" }, all));
  assert.ok(!moves(l, "note", { side: "right", at: "canvas" }, all));
  assert.ok(!moves(l, "trash", { side: "right", at: null }, all));
  assert.ok(!moves(DEFAULT_LAYOUT, "settings", "popup", all));
  assert.ok(moves(l, "note", { side: "right", at: "trash" }, all));
  assert.ok(moves(l, "note", { side: "bottom", at: "trash" }, all));
  // A closed pane in between doesn't count.
  assert.ok(!moves(l, "trash", { side: "right", at: "canvas" }, only("canvas", "trash")));
});

test("closing a panel gives its room to the tile it came from, else the canvas, so the others stay put", () => {
  const box = { x: 0, y: 0, w: 1402, h: 600 };
  const rects = (l, open) => arrange(visible(l.tree, open), box).rects;
  const full = rects(DEFAULT_LAYOUT, all);
  near(rects(DEFAULT_LAYOUT, only("canvas", "prs")).get("prs").w, full.get("prs").w);
  near(rects(DEFAULT_LAYOUT, only("canvas", "note")).get("note").w, full.get("note").w);
  const l = place(DEFAULT_LAYOUT, "trash", { side: "right", at: "note" }, all);
  const shut = rects(l, only("canvas", "prs", "note"));
  near(shut.get("canvas").w, full.get("canvas").w);
  near(shut.get("note").w, full.get("note").w);
});

test("a divider moved while a panel is closed leaves that panel's size alone", () => {
  const l = structuredClone(DEFAULT_LAYOUT);
  const box = { x: 0, y: 0, w: 1402, h: 600 };
  const noteW = arrange(visible(l.tree, all), box).rects.get("note").w;
  const [h] = arrange(visible(l.tree, only("canvas", "prs")), box).handles;
  resize(h, 300, h.a.size + h.b.size);
  const { rects } = arrange(visible(l.tree, all), box);
  near(rects.get("note").w, noteW);
  near(rects.get("prs").w, h.lenA + 300);
});

test("a pane dropped beside the canvas while a panel is closed leaves that panel's size alone", () => {
  const box = { x: 0, y: 0, w: 1402, h: 600 };
  const noteW = arrange(visible(DEFAULT_LAYOUT.tree, all), box).rects.get("note").w;
  const l = place(DEFAULT_LAYOUT, "trash", { side: "right", at: "canvas" }, only("canvas", "prs", "trash"));
  near(arrange(visible(l.tree, all), box).rects.get("note").w, noteW);
});

test("a tile too small for the window is brought up to the minimum", () => {
  const l = place(DEFAULT_LAYOUT, "trash", { side: "bottom", at: "note" }, all);
  l.tree.kids[0].size = 0.01;
  const { rects, handles } = arrange(visible(l.tree, all), { x: 0, y: 0, w: 1002, h: 600 });
  assert.equal(rects.get("prs").w, 200);
  assert.equal(rects.get("note").x + rects.get("note").w, 1002);
  const stack = handles.find((h) => !h.row);
  assert.deepEqual([stack.lenA, stack.lenB], [rects.get("note").h, rects.get("trash").h]);
});
