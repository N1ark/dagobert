import assert from "node:assert/strict";
import { marked } from "marked";
import { isLocalHref, fileLink, baseName, fileLinkHtml } from "../src/lib/filelinks.ts";

for (const h of ["/Users/me/a.pdf", "~/code/foo", "file:///a/b", "FILE:///x", "./a.md", "../docs/x", "a.md", "C:\\x", "c:/x"])
  assert.ok(isLocalHref(h), h);
for (const h of ["", "#note-1", "?q", "//cdn.x/y", "https://x.y", "mailto:a@b.c", "obsidian://open"]) assert.ok(!isLocalHref(h), h);

assert.equal(fileLink("spec.pdf", "~/Docs/spec.pdf"), "[spec.pdf](~/Docs/spec.pdf)");
assert.equal(fileLink("My Doc (v2).pdf", "/a/My Doc (v2).pdf"), "[My Doc (v2).pdf](</a/My Doc (v2).pdf>)");
assert.equal(fileLink("[x]", "/a/100%<b>"), "[\\[x\\]](/a/100%25%3Cb%3E)");

// marked hands the renderer the destination as written, brackets dropped.
const hrefOf = (md) => marked.lexer(md)[0].tokens[0].href;
assert.equal(hrefOf(fileLink("a", "/a/My Doc (v2).pdf")), "/a/My Doc (v2).pdf");
assert.equal(hrefOf(fileLink("a", "~/x")), "~/x");

assert.equal(baseName("/Users/me/code/foo/"), "foo");
assert.equal(baseName("/a/b/spec.pdf"), "spec.pdf");
assert.equal(baseName("C:\\x\\y.txt"), "y.txt");

assert.equal(fileLinkHtml('/a/"b"', "x"), '<a class="filelink" data-path="/a/&quot;b&quot;">x</a>');

console.log("filelinks ok");
