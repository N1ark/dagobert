import { mount, unmount, type Component } from "svelte";
import { Image } from "@tauri-apps/api/image";

/**
 * Rasterise a Phosphor Svelte icon to a Tauri `Image` for native menus.
 * Mounts the component off-screen, serialises its SVG, draws it on a canvas
 * and hands the RGBA buffer to Tauri. Cached per icon + colour.
 */
const cache = new Map<string, Promise<Image>>();

export function iconImage(icon: Component<any>, color: string, size = 32): Promise<Image> {
  const key = `${(icon as { name?: string }).name ?? String(icon)}|${color}|${size}`;
  let p = cache.get(key);
  if (!p) {
    p = raster(icon, color, size);
    cache.set(key, p);
  }
  return p;
}

async function raster(icon: Component<any>, color: string, size: number): Promise<Image> {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-9999px;top:-9999px";
  document.body.appendChild(host);
  const inst = mount(icon, { target: host, props: { size, color, weight: "regular" } });
  const svg = host.querySelector("svg");
  if (!svg) throw new Error("icon did not render");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const src = svg.outerHTML;
  unmount(inst);
  host.remove();

  const img = new window.Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("svg load failed"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  return Image.new(new Uint8Array(data.buffer), size, size);
}
