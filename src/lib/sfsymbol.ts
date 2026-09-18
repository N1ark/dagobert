import { invoke } from "@tauri-apps/api/core";
import { Image } from "@tauri-apps/api/image";

/**
 * SF Symbols for native menu items. Rust renders the symbol to PNG (black on
 * transparent); we centre it on a square canvas and tint it for the current
 * appearance, since a menu image is not a template image once it's RGBA.
 */
const cache = new Map<string, Promise<Image | null>>();

export function sfSymbolImage(names: string[], dark: boolean, size = 36): Promise<Image | null> {
  const key = `${names.join(",")}|${dark}|${size}`;
  let p = cache.get(key);
  if (!p) {
    p = render(names, dark, size).catch((e) => {
      console.warn("sf symbol", names, e);
      return null;
    });
    cache.set(key, p);
  }
  return p;
}

async function render(names: string[], dark: boolean, size: number): Promise<Image | null> {
  // Ask for more pixels than needed and scale down, so it stays crisp on retina.
  const png = await invoke<number[] | null>("sf_symbol", { names, pointSize: size * 2 });
  if (!png) return null;
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: "image/png" }));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Fit inside the square, centred, preserving aspect ratio.
  const scale = Math.min((size * 0.85) / bitmap.width, (size * 0.85) / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = dark ? "#e6e6e6" : "#1c1c1c";
  ctx.fillRect(0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  return Image.new(new Uint8Array(data.buffer), size, size);
}
