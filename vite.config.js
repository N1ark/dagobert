import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const host = process.env.TAURI_DEV_HOST;

/** Phosphor icons carry all six weights; only these are used, so the rest is cut before compiling. */
const WEIGHTS = ["regular", "bold", "fill"];
const phosphorWeights = {
  name: "phosphor-weights",
  enforce: "pre",
  transform(code, id) {
    if (!/phosphor-svelte\/lib\/\w+\.svelte$/.test(id)) return;
    return code.replace(/\{:else if weight === "(\w+)"\}[\s\S]*?(?=\{:else)/g, (m, w) => (WEIGHTS.includes(w) ? m : ""));
  },
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [phosphorWeights, svelte()],

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
