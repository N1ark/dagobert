import assert from "node:assert/strict";
import { keys, matches } from "../src/lib/keys.ts";

const ev = (key, m = {}) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...m });
assert.ok(matches(keys["new-note"], ev("n", { metaKey: true })));
assert.ok(matches(keys["new-note"], ev("N", { ctrlKey: true })));
assert.ok(!matches(keys["new-note"], ev("n")));
assert.ok(matches(keys.redo, ev("Z", { metaKey: true, shiftKey: true })));
assert.ok(!matches(keys.undo, ev("Z", { metaKey: true, shiftKey: true })));
assert.ok(!matches(keys.redo, ev("z", { metaKey: true })));
assert.ok(matches(keys["open-window"], ev("Enter", { metaKey: true })));
assert.ok(matches(keys.escape, ev("Escape")));
assert.ok(matches(keys["code-alt"], ev("`", { metaKey: true })));
assert.ok(!matches(keys.bold, ev("b", { metaKey: true, altKey: true })));
console.log("keys ok");
