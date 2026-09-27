import assert from "node:assert/strict";
import { marked } from "marked";
import { extOf, kindOf, fileExt, parseAlt, embed, stripMedia, firstMedia, assetNames, mediaExtension } from "../src/lib/media.ts";
assert.equal(extOf("assets/9f2c1ab3e07d.PNG"), "png");
assert.equal(extOf("https://x.y/a.jpg?w=2#top"), "jpg");
assert.equal(extOf("noext"), "");
assert.equal(kindOf("a.webp"), "image");
assert.equal(kindOf("talk.MP4"), "video");
assert.equal(kindOf("m4a"), "audio");
assert.equal(kindOf("a.pdf"), null);
assert.equal(fileExt({ name: "image", type: "image/jpeg" }), "jpg");
assert.equal(fileExt({ name: "", type: "image/svg+xml" }), "svg");
assert.equal(fileExt({ name: "Shot.PNG", type: "image/png" }), "png");
assert.deepEqual(parseAlt("diagram.png|300"), { alt: "diagram.png", width: 300 });
assert.deepEqual(parseAlt("|300x200"), { alt: "", width: 300 });
assert.deepEqual(parseAlt("a | b"), { alt: "a | b", width: null });
assert.deepEqual(parseAlt("plain"), { alt: "plain", width: null });
assert.equal(embed("assets/a.png", "my [1]|x.png"), "![my 1 x.png](assets/a.png)");
assert.equal(stripMedia("see ![d.png|300](assets/a.png) here"), "see  here");
assert.equal(stripMedia("see ![d.png|300](assets/a.png) here", true), "see d.png here");
assert.equal(firstMedia("text ![](assets/a.mov)"), "video");
assert.equal(firstMedia("![](https://x.y/pic)"), "image");
assert.equal(firstMedia("[link](a.png)"), null);
assert.deepEqual(assetNames("![](assets/abc.png) and ![x](assets/d-e.mp3)"), ["abc.png", "d-e.mp3"]);
marked.use(mediaExtension);
const html = marked.parse('![a "b"|240](assets/x.png "tip")', { gfm: true, async: false });
assert.match(html, /<img src="assets\/x.png" alt="a &quot;b&quot;" width="240" title="tip">/);
assert.match(
  marked.parse("![talk|320](assets/v.mov)", { async: false }),
  /<video src="assets\/v.mov#t=0.001" controls preload="metadata" width="320" aria-label="talk"><\/video><span class="resize">/,
);
assert.match(
  marked.parse("![](assets/a.m4a)", { async: false }),
  /<p><audio src="assets\/a.m4a" controls preload="metadata"><\/audio><\/p>/,
);
console.log("media ok");
