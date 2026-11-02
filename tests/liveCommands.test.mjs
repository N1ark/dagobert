import assert from "node:assert/strict";
import { embedChange, tailOf } from "../src/lib/liveCommands.ts";

const apply = (text, c) => text.slice(0, c.from) + c.insert + text.slice(c.to);
const at = (text, i, j, open = true) => {
  const c = embedChange(text, i, j, ["![](a.png)"], open);
  return { text: apply(text, c), caret: c.caret };
};

// mid-paragraph: splits it, typing goes on at the rest
assert.deepEqual(at("one two", 3, 4), { text: "one\n\n![](a.png)\n\ntwo", caret: 17 });
// a selection is replaced
assert.equal(at("one two three", 4, 8).text, "one\n\n![](a.png)\n\nthree");
// at the end: an empty paragraph left open, or the text's trailing whitespace kept
assert.deepEqual(at("one\n", 4, 4), { text: "one\n\n![](a.png)\n\n", caret: 17 });
assert.deepEqual(at("one\n", 4, 4, false), { text: "one\n\n![](a.png)\n", caret: 15 });
// before a paragraph, and into an empty doc
assert.equal(at("one\n\n  - two", 7, 7, false).text, "one\n\n![](a.png)\n\n  - two");
assert.equal(at("one\n\n\n\ntwo", 4, 4, false).text, "one\n\n![](a.png)\n\ntwo");
assert.equal(at("first", 0, 0, false).text, "![](a.png)\n\nfirst");
assert.deepEqual(at("", 0, 0, false), { text: "![](a.png)", caret: 10 });

assert.equal(tailOf("a \n\n"), " \n\n");
assert.equal(tailOf("a"), "");
console.log("liveCommands ok");
