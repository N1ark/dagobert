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
assert.deepEqual(splitBlocks(`a\n\n${conflict}\n\nb\n\nc`), ["a", conflict, "b", "c"]);
// A region touching the surrounding lines stays inside that paragraph.
assert.deepEqual(splitBlocks(`x\n${conflict}\ny\n\nz`), [`x\n${conflict}\ny`, "z"]);
assert.equal(isConflict(conflict), true);
assert.equal(isConflict(`x\n${conflict}\ny`), true);
assert.equal(isConflict("<<<<<<< mine\nunterminated"), false);
// Without a closing marker the lines are ordinary paragraphs.
assert.deepEqual(splitBlocks("a\n\n<<<<<<< x\nb\n\nc\n\nd"), ["a", "<<<<<<< x\nb", "c", "d"]);
assert.deepEqual(conflictSides(conflict), { mine: "ours\n\nmore", theirs: "theirs" });
assert.deepEqual(conflictSides(`x\n${conflict}\ny`), { mine: "x\nours\n\nmore\ny", theirs: "x\ntheirs\ny" });
assert.equal(resolveConflict(conflict, "mine"), "ours\n\nmore");
assert.equal(resolveConflict(conflict, "theirs"), "theirs");
assert.equal(resolveConflict(conflict, "both"), "ours\n\nmore\n\ntheirs");
assert.equal(resolveConflict(`x\n${conflict}\ny`, "theirs"), "x\ntheirs\ny");
assert.equal(resolveConflict(`x\n${conflict}\ny`, "both"), "x\nours\n\nmore\ntheirs\ny");
assert.equal(resolveConflict("<<<<<<< mine\n=======\nt\n>>>>>>> theirs", "mine"), "");
assert.equal(stripMarkers(`a\n${conflict}`), "a\nours\n\nmore\ntheirs");
// A fence inside a conflict side doesn't derail the block.
assert.deepEqual(splitBlocks("<<<<<<< mine\n```\nx\n=======\ny\n>>>>>>> theirs\n\nz"), [
  "<<<<<<< mine\n```\nx\n=======\ny\n>>>>>>> theirs",
  "z",
]);
console.log("blocks ok");
