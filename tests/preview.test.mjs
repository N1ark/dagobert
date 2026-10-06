import assert from "node:assert/strict";
import { cardHtml, hostOf, parsePreview } from "../src/lib/preview.ts";

const page = `<!doctype html><html><head>
<title>Fallback &amp; title</title>
<meta name="description" content="Plain description">
<meta property="og:title" content="Dagobert &#8212; notes">
<meta property='og:image' content='/img/card.png'>
<meta content="Dagobert" property="og:site_name">
<link rel="icon" href="/favicon.svg">
</head><body><meta property="og:title" content="not in the head"></body></html>`;
assert.deepEqual(parsePreview(page, "https://example.com/a/b"), {
  url: "https://example.com/a/b",
  title: "Dagobert — notes",
  description: "Plain description",
  image: "https://example.com/img/card.png",
  site: "Dagobert",
  icon: "https://example.com/favicon.svg",
});
const bare = parsePreview("<title> Just   a title </title>", "https://x.y/");
assert.equal(bare.title, "Just a title");
assert.equal(bare.image, null);
assert.equal(bare.icon, "https://x.y/favicon.ico");
assert.equal(parsePreview('<meta property="og:image" content="javascript:alert(1)">', "https://x.y/").image, null);
assert.equal(hostOf("https://www.github.com/a"), "github.com");

const html = cardHtml('https://x.y/"q"', { url: "", title: "<b>T</b>", description: null, image: null, site: null, icon: null });
assert.match(html, /href="https:\/\/x.y\/&quot;q&quot;"/);
assert.match(html, /<span class="lc-title">&lt;b&gt;T&lt;\/b&gt;<\/span>/);
assert.match(cardHtml("https://x.y/", null), /class="link-card loading"/);
console.log("preview ok");
