import assert from "node:assert/strict";
import { splitBlocks, joinBlocks, isConflict, conflictSides, resolveConflict, stripMarkers } from "../src/lib/blocks.ts";
assert.deepEqual(splitBlocks("a\nb\n\nc\n\n\n\nd"), ["a\nb", "c", "d"]);
assert.deepEqual(splitBlocks("x\n\n```js\nfoo\n\nbar\n```\n\ny"), ["x", "```js\nfoo\n\nbar\n```", "y"]);
assert.deepEqual(splitBlocks(""), []);
assert.equal(joinBlocks(["a", "", "b"]), "a\n\nb");
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
// A list keeps the paragraphs indented under its items; what isn't indented under it starts a block.
assert.deepEqual(splitBlocks("- foo\n\n  bar\n\nbaz"), ["- foo\n\n  bar", "baz"]);
// Items apart stay apart, so a long checklist is edited an item at a time.
assert.deepEqual(splitBlocks("- [ ] a\n\n- [ ] b\n\n* c"), ["- [ ] a", "- [ ] b", "* c"]);
assert.deepEqual(splitBlocks("1. a\n\n   b\n\n  c"), ["1. a\n\n   b", "  c"]);
assert.deepEqual(splitBlocks("- a\n  - b\n\n    c\n\nd"), ["- a\n  - b\n\n    c", "d"]);
assert.deepEqual(splitBlocks("- a\n\n  ```\n  x\n\n  ```\n\nz"), ["- a\n\n  ```\n  x\n\n  ```", "z"]);
assert.deepEqual(splitBlocks("x\n\n  y"), ["x", "  y"]);
assert.deepEqual(splitBlocks("- a\n\n<<<<<<< x\nb\n\n  c"), ["- a", "<<<<<<< x\nb", "  c"]);
console.log("blocks ok");

// Conflict regions as offsets, with the paragraph around them; unterminated ones are text.
{
  const { conflictSpans } = await import("../src/lib/blocks.ts");
  const doc = `a\n\nx\n${conflict}\ny\n\nz`;
  assert.deepEqual(conflictSpans(doc), [{ from: 3, to: 3 + `x\n${conflict}\ny`.length }]);
  assert.deepEqual(conflictSpans("a\n\n<<<<<<< x\nb\n\nc"), []);
  assert.deepEqual(conflictSpans("plain\n\ntext"), []);
  // Git conflicts inside a fence are still conflicts: the whole fenced block is the region's block.
  assert.deepEqual(conflictSpans("t\n\n```\n<<<<<<< x\n=======\n>>>>>>> y\n```"), [{ from: 3, to: 38 }]);
  const two = `${conflict}\n\nmid\n\n${conflict}`;
  assert.deepEqual(conflictSpans(two), [
    { from: 0, to: conflict.length },
    { from: two.length - conflict.length, to: two.length },
  ]);
}

{
  const { dedent } = await import("../src/lib/blocks.ts");
  assert.equal(dedent("  ```sh\n  x\n    y\n ```", 2), "```sh\nx\n  y\n```");
  assert.equal(dedent("a\n b", 0), "a\n b");
}
