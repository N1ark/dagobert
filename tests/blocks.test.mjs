import assert from "node:assert/strict";
import {
  splitBlocks,
  joinBlocks,
  locate,
  toggleCheckbox,
  isConflict,
  conflictSides,
  resolveConflict,
  stripMarkers,
} from "../src/lib/blocks.ts";
assert.deepEqual(splitBlocks("a\nb\n\nc\n\n\n\nd"), ["a\nb", "c", "d"]);
assert.deepEqual(splitBlocks("x\n\n```js\nfoo\n\nbar\n```\n\ny"), ["x", "```js\nfoo\n\nbar\n```", "y"]);
assert.deepEqual(splitBlocks(""), []);
assert.equal(joinBlocks(["a", "", "b"]), "a\n\nb");
assert.deepEqual(locate("hello\n\nworld", 9), { index: 1, offset: 2 });
assert.deepEqual(locate("hello\n\nworld", 3), { index: 0, offset: 3 });
assert.deepEqual(locate("hello", 3), { index: 0, offset: 3 });
assert.equal(toggleCheckbox("- [ ] a\n- [x] b", 1), "- [ ] a\n- [ ] b");
assert.equal(toggleCheckbox("- [ ] a\n- [x] b", 0), "- [x] a\n- [x] b");
const conflict = "<<<<<<< mine\nours\n\nmore\n=======\ntheirs\n>>>>>>> theirs";
assert.deepEqual(splitBlocks(`a\n\n${conflict}\nb\n\nc`), ["a", conflict, "b", "c"]);
assert.deepEqual(splitBlocks(`x\n${conflict}`), ["x", conflict]);
assert.equal(isConflict(conflict), true);
assert.equal(isConflict("<<<<<<< mine\nunterminated"), false);
assert.deepEqual(conflictSides(conflict), { mine: "ours\n\nmore", theirs: "theirs" });
assert.equal(resolveConflict(conflict, "mine"), "ours\n\nmore");
assert.equal(resolveConflict(conflict, "theirs"), "theirs");
assert.equal(resolveConflict(conflict, "both"), "ours\n\nmore\ntheirs");
assert.equal(stripMarkers(`a\n${conflict}`), "a\nours\n\nmore\ntheirs");
// A fence inside a conflict side doesn't derail the block.
assert.deepEqual(splitBlocks("<<<<<<< mine\n```\nx\n=======\ny\n>>>>>>> theirs\n\nz"), [
  "<<<<<<< mine\n```\nx\n=======\ny\n>>>>>>> theirs",
  "z",
]);
console.log("blocks ok");
