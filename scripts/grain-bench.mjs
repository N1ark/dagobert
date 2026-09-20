// Benchmarks the grain renderer (src/lib/grainGL.ts) in headless Chrome on the real GPU
// and, optionally, checks it against the renderer at another git ref pixel for pixel.
//
//   node scripts/grain-bench.mjs            # timings for a 2× full-screen canvas
//   node scripts/grain-bench.mjs HEAD~1     # also compare output against that ref
//
// Timings use a per-frame GPU sync (1px readback), so they include sync overhead but
// are comparable between runs. Requires Google Chrome in /Applications.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(path.join(root, "package.json"))("typescript");
const ref = process.argv[2];

/** grainGL.ts (from the working tree, or a git ref) as a browser script with shaders inlined. */
function rendererJs(at) {
  const read = (file) =>
    at ? execSync(`git -C ${root} show ${at}:src/lib/${file}`).toString() : fs.readFileSync(path.join(root, "src/lib", file), "utf8");
  let src = read("grainGL.ts");
  src = src.replace(/import (\w+) from "\.\/([\w.]+)\?raw";/g, (_, name, file) => `const ${name} = ${JSON.stringify(read(file))};`);
  return ts
    .transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
    .outputText.replace(/^export /gm, "");
}

const page = `<html><body><pre id="out"></pre><script>
const warns = []; console.warn = (...a) => warns.push(a.join(" "));
try {
const NEW = (() => { ${rendererJs()} return createGrain; })();
const OLD = ${ref ? `(() => { ${rendererJs(ref)} return createGrain; })()` : "null"};
const W = 2880, H = 1800, dpr = 2;
function make(create) {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  c.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
  const r = create(c); if (!r) throw new Error("createGrain failed: " + warns.join("; "));
  return { r, g: c.getContext("webgl") };
}
const n = make(NEW), o = OLD ? make(OLD) : null;
function frameFor(vx, vy, zoom, nodes, edges, time) {
  const P = 0.7;
  const f = { time, dpr, offset: { x: vx * dpr, y: vy * dpr }, zoom, bg: { x: (P * vx + (1 - P) * W / dpr / 2) * dpr, y: (P * vy + (1 - P) * H / dpr / 2) * dpr, zoom: P * zoom },
    grid: { radius: 1.3 * dpr, alpha: 1 }, tint: [0.7, 0.3, 0.7], rects: new Float32Array(64), rectCount: nodes.length, strength: new Float32Array(16),
    curvesA: new Float32Array(192), curvesB: new Float32Array(192), curveCount: edges.length, curveStrength: new Float32Array(48), curvesVersion: 0 };
  nodes.forEach((q, i) => { f.rects.set([(vx + q.x * zoom) * dpr, (vy + q.y * zoom) * dpr, q.w * zoom * dpr, q.h * zoom * dpr], i * 4); f.strength[i] = 1; });
  edges.forEach((c, i) => { f.curvesA.set(c.slice(0, 4), i * 4); f.curvesB.set(c.slice(4, 8), i * 4); f.curveStrength[i] = 1; });
  return f;
}
const e = (ax, ay, bx, by) => { const dx = Math.max(40, Math.abs(bx - ax) * 0.5); return [ax, ay, ax + dx, ay, bx - dx, by, bx, by]; };
const node = { x: 500, y: 400, w: 220, h: 60 };
const many = []; for (let i = 0; i < 30; i++) many.push(e(50 + i * 10, 100 + i * 40, 1300 - i * 10, 900 - i * 25));
const scenarios = [
  ["idle (no selection)", frameFor(100, 80, 1, [], [], 1.234)],
  ["one node, 3 edges", frameFor(100, 80, 1, [node], [e(300, 200, 500, 430), e(300, 600, 500, 430), e(720, 430, 1000, 300)], 1.234)],
  ["chain, 30 long edges", frameFor(100, 80, 1, [node], many, 1.234)],
  ["chain, zoom 0.4", frameFor(300, 200, 0.4, [node], many, 1.234)],
];
const px1 = new Uint8Array(4);
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
function time(t, f) {
  const out = [];
  for (let i = 0; i < 40; i++) {
    t.g.readPixels(0, 0, 1, 1, t.g.RGBA, t.g.UNSIGNED_BYTE, px1);
    const t0 = performance.now(); f.time = i * 0.016; t.r.render(W, H, f);
    t.g.readPixels(0, 0, 1, 1, t.g.RGBA, t.g.UNSIGNED_BYTE, px1); out.push(performance.now() - t0);
  }
  return median(out);
}
const lines = [];
let v = 1;
for (const [name, f] of scenarios) {
  f.curvesVersion = v++;
  let cmp = "";
  if (o) {
    f.time = 1.234;
    const A = new Uint8Array(W * H * 4), B = new Uint8Array(W * H * 4);
    o.r.render(W, H, f); o.g.readPixels(0, 0, W, H, o.g.RGBA, o.g.UNSIGNED_BYTE, A);
    n.r.render(W, H, f); n.g.readPixels(0, 0, W, H, n.g.RGBA, n.g.UNSIGNED_BYTE, B);
    let maxd = 0, over2 = 0;
    for (let i = 0; i < A.length; i++) { const d = Math.abs(A[i] - B[i]); if (d > maxd) maxd = d; if (d > 2) over2++; }
    cmp = "  | vs ${ref}: max diff " + maxd + "/255, channels off by >2: " + over2 + (OLD ? ", old " + time(o, f).toFixed(2) + " ms" : "");
  }
  lines.push(name.padEnd(24) + time(n, f).toFixed(2) + " ms/frame" + cmp);
}
document.getElementById("out").textContent = lines.join("\\n");
} catch (err) { document.getElementById("out").textContent = "ERR " + (err && err.stack || err) + "\\n" + warns.join("\\n"); }
</script></body></html>`;

const tmp = path.join(os.tmpdir(), `grain-bench-${process.pid}.html`);
fs.writeFileSync(tmp, page);
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
try {
  const dom = execSync(`"${chrome}" --headless=new --use-angle=metal --ignore-gpu-blocklist --dump-dom "file://${tmp}" 2>/dev/null`, {
    maxBuffer: 1 << 26,
  }).toString();
  const m = dom.match(/<pre id="out">([^<]*)/);
  console.log(m ? m[1].replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&") : "no output");
} finally {
  fs.unlinkSync(tmp);
}
