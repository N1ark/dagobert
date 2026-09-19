import assert from "node:assert/strict";
import { History, sameNote } from "../src/lib/history.ts";
const n = (o) => ({
  id: "a",
  title: "",
  tags: [],
  created: "",
  modified: "",
  opened: "",
  workflow: null,
  status: "todo",
  x: 0,
  y: 0,
  deps: [],
  body: "",
  file: "",
  ...o,
});
assert.ok(sameNote(n({}), n({ opened: "x", modified: "y", file: "z" })));
assert.ok(!sameNote(n({}), n({ x: 1 })));
assert.ok(!sameNote(n({ tags: ["a"] }), n({ tags: ["b"] })));
assert.ok(!sameNote(null, n({})));
const h = new History(3);
assert.equal(h.push({ label: "noop", diffs: [{ id: "a", before: n({}), after: n({ opened: "q" }) }], at: 0 }), null);
h.push({ label: "type", diffs: [{ id: "a", before: n({ body: "" }), after: n({ body: "h" }) }], at: 0 });
h.push({ label: "type", diffs: [{ id: "a", before: n({ body: "h" }), after: n({ body: "hi" }) }], at: 100 });
assert.equal(h.undo.length, 1, "typing coalesces");
assert.equal(h.undo[0].diffs[0].after.body, "hi");
h.push({ label: "move", diffs: [{ id: "a", before: n({ body: "hi" }), after: n({ body: "hi", x: 5 }) }], at: 200 });
assert.equal(h.undo.length, 2, "move does not coalesce with typing");
h.push({ label: "type", diffs: [{ id: "a", before: n({ body: "hi", x: 5 }), after: n({ body: "hi!", x: 5 }) }], at: 5000 });
h.push({ label: "type", diffs: [{ id: "a", before: n({ body: "hi!", x: 5 }), after: n({ body: "hi!!", x: 5 }) }], at: 5100 });
assert.equal(h.undo.length, 3, "capped");
const e = h.popUndo();
assert.equal(e.label, "type");
assert.equal(h.redo.length, 1);
h.popRedo();
assert.equal(h.redo.length, 0);
h.popUndo();
h.push({ label: "x", diffs: [{ id: "a", before: n({}), after: n({ x: 9 }) }], at: 9000 });
assert.equal(h.redo.length, 0, "new entry clears redo");
console.log("history ok");
