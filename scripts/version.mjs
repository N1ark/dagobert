#!/usr/bin/env node
// Sync the version across package.json (and its lockfile), src-tauri/Cargo.toml, tauri.conf.json
// and the generated iOS Info.plist,
// move the changelog's Unreleased section under the new version, and tag.
//   npm run version -- 0.2.0
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? "")) {
  console.error("usage: npm run version -- X.Y.Z");
  process.exit(1);
}

const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, "utf8")));
edit("package.json", (s) => s.replace(/"version": "[^"]+"/, `"version": "${v}"`));
edit("src-tauri/tauri.conf.json", (s) => s.replace(/"version": "[^"]+"/, `"version": "${v}"`));
edit("src-tauri/Cargo.toml", (s) => s.replace(/^version = "[^"]+"/m, `version = "${v}"`));
edit("package-lock.json", (s) => {
  const lock = JSON.parse(s);
  lock.version = lock.packages[""].version = v;
  return JSON.stringify(lock, null, 2) + "\n";
});
const PLIST = "src-tauri/gen/apple/dagobert_iOS/Info.plist";
edit(PLIST, (s) => s.replace(/(<key>CFBundle(?:ShortVersionString|Version)<\/key>\s*<string>)[^<]*/g, `$1${v}`));
const today = new Date().toISOString().slice(0, 10);
edit("CHANGELOG.md", (s) => s.replace("## [Unreleased]\n", `## [Unreleased]\n\n## [${v}] - ${today}\n`));
execSync("cargo generate-lockfile --offline --manifest-path src-tauri/Cargo.toml", { stdio: "ignore" });
execSync(
  `git add package.json package-lock.json ${PLIST} src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock CHANGELOG.md && git commit -m "v${v}" && git tag v${v}`,
  { stdio: "inherit" },
);
console.log(`v${v}`);
