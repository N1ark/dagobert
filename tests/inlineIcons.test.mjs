import assert from "node:assert/strict";
import { Marked } from "marked";
import { iconExtension, kebab, mayHaveIcons, typedIcon } from "../src/lib/inlineIcons.ts";

assert.equal(kebab("AirplaneTakeoff"), "airplane-takeoff");
assert.equal(kebab("TShirt"), "t-shirt");
assert.equal(kebab("X"), "x");
assert.equal(kebab("ArrowUDownLeft"), "arrow-u-down-left");

const icons = new Set(["rocket", "git-branch", "x"]);
const md = new Marked({ gfm: true, async: false });
md.use({
  extensions: [
    iconExtension(
      (n) => icons.has(n),
      (n) => `<i>${n}</i>`,
    ),
  ],
});
const inline = (s) => md.parseInline(s);

assert.equal(inline(":rocket:"), "<i>rocket</i>");
assert.equal(inline("Launch :rocket: now"), "Launch <i>rocket</i> now");
assert.equal(inline(":git-branch:"), "<i>git-branch</i>");
assert.equal(inline(":rocket::x:"), "<i>rocket</i><i>x</i>");
assert.equal(inline("(:rocket:)"), "(<i>rocket</i>)");
assert.equal(inline("**:rocket:**"), "<strong><i>rocket</i></strong>");
assert.equal(inline(":rocket:s"), "<i>rocket</i>s");
assert.equal(inline("[go :rocket:](https://a.b)"), '<a href="https://a.b">go <i>rocket</i></a>');
// Only real icons, and never right after a letter or digit.
assert.equal(inline(":nope:"), ":nope:");
assert.equal(inline(":Rocket:"), ":Rocket:");
assert.equal(inline("10:30:00"), "10:30:00");
assert.equal(inline("a:b:"), "a:b:");
assert.equal(inline("go:rocket:"), "go:rocket:");
assert.equal(inline("2:x:"), "2:x:");
assert.equal(inline("\\:rocket:"), ":rocket:");
// Code is left alone, and so are URLs.
assert.equal(inline("`:rocket:`"), "<code>:rocket:</code>");
assert.equal(md.parse("```\n:rocket:\n```"), "<pre><code>:rocket:\n</code></pre>\n");
assert.ok(!inline("https://a.b/:rocket:").includes("<i>"));
assert.equal(md.parse("- :rocket: item"), "<ul>\n<li><i>rocket</i> item</li>\n</ul>\n");

assert.ok(mayHaveIcons("a :rocket: b"));
assert.ok(!mayHaveIcons("10:30 and a: b"));

assert.deepEqual(typedIcon("Launch :ro"), { start: 7, query: "ro" });
assert.deepEqual(typedIcon(":Git-b"), { start: 0, query: "git-b" });
assert.deepEqual(typedIcon("a\n(:roc"), { start: 3, query: "roc" });
assert.equal(typedIcon("Launch :r"), null);
assert.equal(typedIcon("Launch :rocket:"), null);
assert.equal(typedIcon("Launch :rocket "), null);
assert.equal(typedIcon("go:ro"), null);
assert.equal(typedIcon("at 10:30"), null);
assert.equal(typedIcon("`code :ro"), null);
assert.deepEqual(typedIcon("`code` :ro"), { start: 7, query: "ro" });

console.log("inlineIcons ok");
