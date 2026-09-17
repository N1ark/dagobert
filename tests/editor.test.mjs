import assert from "node:assert/strict";
import { toggleWrap, link, continueList, indent } from "../src/lib/editor.ts";
const sel = (text, start, end = start) => ({ text, start, end });
// wrap / unwrap
assert.deepEqual(toggleWrap(sel("hello world", 0, 5), "**"), sel("**hello** world", 2, 7));
assert.deepEqual(toggleWrap(sel("**hello** world", 2, 7), "**"), sel("hello world", 0, 5));
assert.deepEqual(toggleWrap(sel("**hello** world", 0, 9), "**"), sel("hello world", 0, 5));
assert.deepEqual(toggleWrap(sel("ab", 1), "*"), sel("a**b", 2, 2));
// link
assert.deepEqual(link(sel("see docs", 4, 8)), sel("see [docs](url)", 11, 14));
assert.deepEqual(link(sel("https://x.y", 0, 11)), sel("[](https://x.y)", 1, 1));
// lists
assert.deepEqual(continueList(sel("- a", 3)), sel("- a\n- ", 6));
assert.deepEqual(continueList(sel("- [x] a", 7)), sel("- [x] a\n- [ ] ", 14));
assert.deepEqual(continueList(sel("1. a", 4)), sel("1. a\n2. ", 8));
assert.deepEqual(continueList(sel("- a\n- ", 6)), sel("- a\n", 4));
assert.equal(continueList(sel("plain", 5)), null);
// indent
assert.deepEqual(indent(sel("a\nb", 0, 3), false), sel("  a\n  b", 2, 7));
assert.deepEqual(indent(sel("  a\n  b", 2, 7), true), sel("a\nb", 0, 3));
console.log("editor ok");
