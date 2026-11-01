import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { purr, phosphorIcons, phosphorGlyph } from "purr/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

/** `virtual:icons`: every icon's regular weight by kebab-case name (loaded lazily); `virtual:icon-names`: just the names. */
function icons() {
  const at = (path) => fileURLToPath(new URL(path, import.meta.url));
  let cache;
  const all = () => (cache ??= read());
  const read = () => {
    const lib = at("node_modules/phosphor-svelte/lib");
    const own = JSON.parse(readFileSync(at("node_modules/purr/src/icons/glyphs.json"), "utf8"));
    const shapes = (name) => own[name]?.regular ?? phosphorGlyph(readFileSync(`${lib}/${name}.svelte`, "utf8"), "regular");
    const kebab = (name) => name.replace(/\B[A-Z]/g, (c) => "-" + c).toLowerCase();
    const names = [...new Set([...Object.keys(own), ...phosphorIcons(lib)])];
    return Object.fromEntries(names.map((name) => [kebab(name), shapes(name)]).sort(([a], [b]) => (a < b ? -1 : 1)));
  };
  const ids = ["virtual:icons", "virtual:icon-names"];
  return {
    name: "dagobert:icons",
    resolveId: (source) => (ids.includes(source) ? "\0" + source : null),
    load(source) {
      if (source === "\0virtual:icons") return `export default JSON.parse(${JSON.stringify(JSON.stringify(all()))});`;
      if (source === "\0virtual:icon-names") return `export default ${JSON.stringify(Object.keys(all()).join(" "))}.split(" ");`;
      return null;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [purr(), icons(), svelte()],

  // Everything ships on disk with the app, so a big single chunk is fine.
  build: { chunkSizeWarningLimit: 1000 },

  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
