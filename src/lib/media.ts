/** Media embedded in notes: `![alt|width](assets/<hash>.<ext>)` (see docs/editor.md). */
import type { MarkedExtension } from "marked";

export type MediaKind = "image" | "audio" | "video";

/** A dropped or picked file: a path in the app, a `File` in the browser or from the clipboard. */
export type MediaSource = string | File;

/** Detail of the `media-drop` event App dispatches at the element under a file drop. */
export interface MediaDrop {
  items: MediaSource[];
  x: number;
  y: number;
}

/** Mirrors `media_kind` in store.rs. */
const KINDS: Record<MediaKind, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"],
  audio: ["mp3", "m4a", "wav", "ogg", "flac"],
  video: ["mp4", "mov", "webm", "m4v"],
};

export const MEDIA_EXTS = Object.values(KINDS).flat();

/** Lower-case extension of a file name or URL, without the dot. */
export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.replace(/[?#].*$/, ""));
  return m ? m[1].toLowerCase() : "";
}

/** A path's or file's name, without its folder. */
export function fileName(item: MediaSource): string {
  return typeof item === "string" ? (item.split(/[\\/]/).pop() ?? "") : item.name;
}

/** The name without its extension (a dropped file's note title). */
export const stemOf = (item: MediaSource) => fileName(item).replace(/\.[^.]*$/, "");

export function kindOf(name: string): MediaKind | null {
  const ext = extOf(name) || name.toLowerCase();
  return (Object.keys(KINDS) as MediaKind[]).find((k) => KINDS[k].includes(ext)) ?? null;
}

/** A file's extension, falling back to its MIME type (a pasted screenshot is `image/png`). */
export function fileExt(file: { name: string; type: string }): string {
  return extOf(file.name) || (file.type.split("/")[1] ?? "").replace("jpeg", "jpg").replace("svg+xml", "svg");
}

/** `alt|300` or `alt|300x200` (Obsidian's syntax) → the alt text and a width; height is ignored. */
export function parseAlt(text: string): { alt: string; width: number | null } {
  const m = /^(.*?)\s*\|\s*(\d+)(?:x\d+)?\s*$/.exec(text);
  return m ? { alt: m[1], width: Number(m[2]) || null } : { alt: text, width: null };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An embed's HTML, the element picked by extension (anything unknown is an image). */
export function mediaHtml(href: string, text: string, title?: string | null): string {
  const { alt, width } = parseAlt(text);
  const kind = kindOf(href);
  const w = width ? ` width="${width}"` : "";
  const tip = title ? ` title="${esc(title)}"` : "";
  const label = alt ? ` aria-label="${esc(alt)}"` : "";
  if (kind === "audio") return `<audio src="${esc(href)}" controls preload="metadata"${label}${tip}></audio>`;
  // The time fragment makes WebKit show the first frame instead of black.
  const el =
    kind === "video"
      ? `<video src="${esc(href.includes("#") ? href : href + "#t=0.001")}" controls preload="metadata"${w}${label}${tip}></video>`
      : `<img src="${esc(href)}" alt="${esc(alt)}"${w}${tip}>`;
  // The wrapper carries the resize handle the editor shows on hover.
  return `<span class="media">${el}<span class="resize"></span></span>`;
}

/** marked extension: `![alt|300](x)` → a sized element. */
export const mediaExtension: MarkedExtension = {
  renderer: {
    image({ href, title, text }) {
      return mediaHtml(href, text, title);
    },
  },
};

/** `![alt](url "title")`; alt and url in groups 1 and 2. */
export const EMBED_RE = /!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;

/** The markdown for an asset link, the alt text made safe to sit between brackets. */
export function embed(link: string, alt = ""): string {
  return `![${alt
    .replace(/[[\]]/g, "")
    .replace(/[|\s]+/g, " ")
    .trim()}](${link})`;
}

/** Embeds replaced by their alt text (search), or removed (card previews). */
export function stripMedia(text: string, keepAlt = false): string {
  return text.replace(EMBED_RE, (_, alt: string) => (keepAlt ? parseAlt(alt).alt : ""));
}

/** The kind of the first embed in `text`, if any. */
export function firstMedia(text: string): MediaKind | null {
  if (!text.includes("![")) return null;
  for (const m of text.matchAll(EMBED_RE)) return kindOf(m[2]) ?? "image";
  return null;
}

/** Names of the project assets `text` refers to (`assets/<name>`). */
export function assetNames(text: string): string[] {
  return [...text.matchAll(/assets\/([\w.-]+\.[a-z0-9]+)/gi)].map((m) => m[1]);
}
