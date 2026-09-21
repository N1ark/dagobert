import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../src/lib/locales/en.ts";
import { t, plural } from "../src/lib/i18n.ts";

assert.equal(t("app.untitled"), "Untitled");
assert.equal(t("panel.created", { when: "2d ago" }), "created 2d ago");
assert.equal(
  t("toolbar.git.remote", { branch: "main", position: "", when: "now" }),
  "Git tracking on main — now · click to commit now (⌘S)",
);
assert.equal(t("settings.template.hint"), "Default body for new notes. Placeholders: {{date}}, {{title}}.");
assert.equal(plural("toolbar.matches", 1), "1 match");
assert.equal(plural("toolbar.matches", 3), "3 matches");
assert.equal(plural("trash.confirm", 0), "This permanently deletes 0 notes.");

// Every `.one` has an `.other`, and no key is left unused by the sources.
const keys = Object.keys(en);
for (const k of keys) if (k.endsWith(".one")) assert.ok(keys.includes(k.replace(/\.one$/, ".other")), `${k} needs .other`);

const src = [];
const walk = (dir) => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(ts|svelte)$/.test(f.name) && !p.includes("locales")) src.push(readFileSync(p, "utf8"));
  }
};
walk("src");
const code = src.join("\n");
const used = (k) => code.includes(`"${k}"`);
for (const k of keys) {
  const stem = k.replace(/\.(one|other)$/, "");
  const label = k.startsWith("history.") ? k.slice("history.".length) : null;
  const ok = used(k) || (stem !== k && used(stem)) || (label !== null && (used(label) || k === "history.multi"));
  assert.ok(ok, `unused string: ${k}`);
}
