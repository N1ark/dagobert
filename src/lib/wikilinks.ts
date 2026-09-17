import { store } from "./store.svelte";
import type { Note } from "./types";

/** `[[Note title]]` links between notes. */
export const WIKI_RE = /\[\[([^\[\]\n]+?)\]\]/g;

export function resolve(title: string): Note | null {
  const t = title.trim().toLowerCase();
  return store.notes.find((n) => n.title.trim().toLowerCase() === t) ?? null;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Replace wikilinks with anchors before markdown parsing. Resolved links get
 * `href="#note-<id>"`; unresolved ones become a marked span. Code spans/fences
 * are left untouched.
 */
export function renderWikilinks(md: string): string {
  // Ranges covered by code spans/fences; links inside them are left alone.
  // (Links may themselves contain backticks, so we can't just split on code.)
  const code: [number, number][] = [];
  for (const m of md.matchAll(/```[\s\S]*?```|`[^`\n]*`/g)) code.push([m.index, m.index + m[0].length]);
  const inCode = (i: number) => code.some(([a, b]) => i >= a && i < b);
  return md.replace(WIKI_RE, (m, title: string, offset: number) => {
    if (inCode(offset)) return m;
    const n = resolve(title);
    const label = escapeHtml(title.trim());
    return n
      ? `<a class="wikilink" href="#note-${n.id}">${label}</a>`
      : `<span class="wikilink missing" title="No note with this title">${label}</span>`;
  });
}

/** The note id a clicked element points at, if it's a wikilink. */
export function wikilinkTarget(el: HTMLElement): string | null {
  const a = el.closest("a.wikilink") as HTMLAnchorElement | null;
  const m = a?.getAttribute("href")?.match(/^#note-(.+)$/);
  return m ? m[1] : null;
}

/** Notes whose body links to `note` by title. */
export function mentions(note: Note): Note[] {
  const t = note.title.trim().toLowerCase();
  if (!t) return [];
  return store.notes.filter((n) => {
    if (n.id === note.id) return false;
    for (const m of n.body.matchAll(WIKI_RE)) if (m[1].trim().toLowerCase() === t) return true;
    return false;
  });
}

/** Rewrite `[[old]]` to `[[new]]` in every note body. */
export function renameLinks(oldTitle: string, newTitle: string) {
  const o = oldTitle.trim().toLowerCase();
  const nt = newTitle.trim();
  if (!o || !nt || o === nt.toLowerCase()) return;
  for (const n of store.notes) {
    const body = n.body.replace(WIKI_RE, (m, title: string) => (title.trim().toLowerCase() === o ? `[[${nt}]]` : m));
    if (body !== n.body) {
      n.body = body;
      store.touch(n.id, { immediate: true, silent: true });
    }
  }
}

/** Pixel position of the caret inside a textarea, relative to the textarea's box. */
export function caretCoords(el: HTMLTextAreaElement, index: number): { left: number; top: number; height: number } {
  const div = document.createElement("div");
  const cs = getComputedStyle(el);
  for (const p of [
    "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textTransform",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth",
    "boxSizing", "whiteSpace", "wordWrap", "overflowWrap", "tabSize",
  ] as const) {
    div.style[p] = cs[p];
  }
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.width = `${el.clientWidth}px`;
  div.textContent = el.value.slice(0, index);
  const span = document.createElement("span");
  span.textContent = el.value.slice(index) || ".";
  div.appendChild(span);
  document.body.appendChild(div);
  const out = { left: span.offsetLeft - el.scrollLeft, top: span.offsetTop - el.scrollTop, height: parseFloat(cs.lineHeight) || 20 };
  document.body.removeChild(div);
  return out;
}
