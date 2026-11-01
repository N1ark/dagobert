import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { purr, phosphorIcons, phosphorGlyph } from "purr/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

/** `virtual:note-icons`: every icon's regular weight by name, for the note icon picker (loaded lazily). */
function noteIcons() {
  const id = "virtual:note-icons";
  const at = (path) => fileURLToPath(new URL(path, import.meta.url));
  return {
    name: "dagobert:note-icons",
    resolveId: (source) => (source === id ? "\0" + id : null),
    load(source) {
      if (source !== "\0" + id) return null;
      const lib = at("node_modules/phosphor-svelte/lib");
      const own = JSON.parse(readFileSync(at("node_modules/purr/src/icons/glyphs.json"), "utf8"));
      const names = [...Object.keys(own), ...phosphorIcons(lib)].sort();
      const shapes = (name) => own[name]?.regular ?? phosphorGlyph(readFileSync(`${lib}/${name}.svelte`, "utf8"), "regular");
      const data = Object.fromEntries(names.map((name) => [name, shapes(name)]));
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(data))});`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [purr(), noteIcons(), svelte()],

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
