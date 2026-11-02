import assert from "node:assert/strict";
import { GFM, parser } from "@lezer/markdown";
import { isGap, liveSyntax, markerExtra, urlHref } from "../src/lib/liveSyntax.ts";

const md = parser.configure([GFM, liveSyntax]);
/** Every node of the live syntax in `s`, as `Name:text`. */
const nodes = (s, names = ["Highlight", "WikiLink", "InlineIcon", "RepoRef", "InlineCode", "URL", "Escape"]) => {
  const out = [];
  md.parse(s).iterate({ enter: (n) => void (names.includes(n.name) && out.push(`${n.name}:${s.slice(n.from, n.to)}`)) });
  return out;
};

// ==highlight==, flanking like ~~strike~~.
assert.deepEqual(nodes("a ==hi== b"), ["Highlight:==hi=="]);
assert.deepEqual(nodes("a == b == c"), []);
assert.deepEqual(nodes("**==x==**"), ["Highlight:==x=="]);

// [[wikilinks]]: no brackets or line breaks inside.
assert.deepEqual(nodes("see [[Foo bar]]."), ["WikiLink:[[Foo bar]]"]);
assert.deepEqual(nodes("[[a]b]] [[]] [[a\nb]]"), []);
assert.deepEqual(nodes("[[[x]]]"), ["WikiLink:[[x]]"]);

// :icons: not right after a letter or digit; escaped with a backslash.
assert.deepEqual(nodes(":rocket: (:git-branch:)"), ["InlineIcon::rocket:", "InlineIcon::git-branch:"]);
assert.deepEqual(nodes("10:30:00 a:b: go:rocket: :Rocket:"), []);
assert.deepEqual(nodes("\\:rocket:"), ["Escape:\\:"]);
assert.deepEqual(nodes(":rocket::x:"), ["InlineIcon::rocket:", "InlineIcon::x:"]);

// alias#123 at a word start.
assert.deepEqual(nodes("fix gh#12, (my.repo#3)"), ["RepoRef:gh#12", "RepoRef:my.repo#3"]);
assert.deepEqual(nodes("a/gh#1 x#y gh#12a #3 [gh#4]"), []);
assert.deepEqual(nodes("https://x.com/foo#1"), ["URL:https://x.com/foo#1"]);

// Code keeps all of it as text.
assert.deepEqual(nodes("`==a== [[b]] :rocket: gh#1`"), ["InlineCode:`==a== [[b]] :rocket: gh#1`"]);
assert.deepEqual(nodes("```\n[[b]] :rocket:\n```"), []);

// GFM extras marked doesn't render stay text.
assert.deepEqual(nodes("~sub~ ^sup^ :smile:", ["Subscript", "Superscript", "Emoji"]), []);

assert.equal(urlHref("www.a.com"), "https://www.a.com");
assert.equal(urlHref("<https://a.b>"), "https://a.b");
assert.equal(urlHref("me@x.org"), "mailto:me@x.org");
assert.equal(urlHref("mailto:me@x.org"), "mailto:me@x.org");

assert.equal(markerExtra("-"), 0);
assert.equal(markerExtra("1."), 0);
assert.equal(markerExtra("10."), 0.3);
assert.equal(markerExtra("100."), 0.9);

assert.ok(isGap("para", "", "next"));
assert.ok(isGap("para", "  ", "- item"));
assert.ok(!isGap(null, "", "next"));
assert.ok(!isGap("para", "", ""));
assert.ok(!isGap("para", "x", "next"));

console.log("livePreview ok");
