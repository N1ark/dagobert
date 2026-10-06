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
{
  const { pasteLink } = await import("../src/lib/editor.ts");
  const sel = (text, start, end = start) => ({ text, start, end });
  assert.deepEqual(pasteLink(sel("see docs now", 4, 8), "https://x.y/d"), sel("see [docs](https://x.y/d) now", 25, 25));
  assert.equal(pasteLink(sel("see docs", 4, 4), "https://x.y"), null, "no selection → normal paste");
  assert.equal(pasteLink(sel("see docs", 4, 8), "plain text"), null, "not a url → normal paste");
  console.log("pasteLink ok");
}
{
  const { setMediaWidth, setMediaHeight } = await import("../src/lib/editor.ts");
  const b = '![a](assets/x.png) `![c](d.png)` ![b|90x40](assets/y.mp4 "t")';
  assert.equal(setMediaWidth(b, 0, 320), '![a|320](assets/x.png) `![c](d.png)` ![b|90x40](assets/y.mp4 "t")');
  assert.equal(setMediaWidth(b, 1, 200), '![a](assets/x.png) `![c](d.png)` ![b|200x40](assets/y.mp4 "t")', "keeps the height");
  assert.equal(setMediaWidth(b, 1, null), '![a](assets/x.png) `![c](d.png)` ![b|x40](assets/y.mp4 "t")');
  assert.equal(setMediaHeight(b, 0, 160), '![a|x160](assets/x.png) `![c](d.png)` ![b|90x40](assets/y.mp4 "t")');
  assert.equal(setMediaHeight("![a|300x160](x.png)", 0, null), "![a|300](x.png)");
  assert.equal(setMediaWidth("![|300](x.png)", 0, null), "![](x.png)");
  assert.equal(setMediaWidth(b, 5, 10), b, "no such embed");
  console.log("setMediaWidth ok");
}
{
  const { linkToEmbed, embedToLink } = await import("../src/lib/editor.ts");
  const u = "https://svelte.dev/docs?a=1";
  assert.equal(linkToEmbed(`See [the docs](${u}) now`, u), `See ![the docs](${u}) now`);
  assert.equal(linkToEmbed(`See <${u}>`, u), `See ![](${u})`);
  assert.equal(linkToEmbed(`${u} and ${u}`, u, 1), `${u} and ![](${u})`);
  assert.equal(linkToEmbed(`![x](${u}) [y](${u})`, u), `![x](${u}) ![y](${u})`, "embeds aren't links");
  assert.equal(linkToEmbed(`${u}/deeper`, u), `${u}/deeper`, "a longer URL isn't this one");
  assert.equal(embedToLink(`![the docs](${u})`, u, "Svelte"), `[the docs](${u})`);
  assert.equal(embedToLink(`![](${u})`, u, "Svelte [docs]"), `[Svelte docs](${u})`);
  assert.equal(embedToLink(`![](${u}) ![](${u})`, u, null, 1), `![](${u}) <${u}>`);
  console.log("link embeds ok");
}
