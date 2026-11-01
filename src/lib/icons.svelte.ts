import { marked } from "marked";
import { glyph, type GlyphComponent } from "purr";
import names from "virtual:icon-names";
import { iconExtension, mayHaveIcons } from "./inlineIcons";

/** Inline icons: the names ship with the app, the shapes in a chunk of their own fetched the first time one shows. */
const known = new Set(names);
let data = $state.raw<Record<string, string> | null>(null);
let loading: Promise<Record<string, string>> | null = null;
const made = new Map<string, GlyphComponent>();

export const iconNames: readonly string[] = names;
export const isIcon = (name: string) => known.has(name);

export function loadIcons(): Promise<Record<string, string>> {
  return (loading ??= import("virtual:icons").then((m) => (data = m.default)));
}

/** The icon called `name` as a component, or null for an unknown name or while the shapes load. */
export function iconGlyph(name: string): GlyphComponent | null {
  if (!data) {
    void loadIcons();
    return null;
  }
  let icon = made.get(name);
  if (!icon && data[name]) made.set(name, (icon = glyph({ regular: data[name] })));
  return icon ?? null;
}

/** `:name:` as HTML: the icon, or a blank of the same size until the shapes are in (reading `data` re-renders then). */
function iconHtml(name: string): string {
  const d = data?.[name];
  if (!d) {
    void loadIcons();
    return `<span class="ico" role="img" aria-label="${name}"></span>`;
  }
  const shapes = d[0] === "<" ? d : `<path d="${d}"/>`;
  return `<svg class="ico" viewBox="0 0 256 256" fill="currentColor" role="img" aria-label="${name}">${shapes}</svg>`;
}

// Once per app, for `Markdown` and `InlineMd` alike.
marked.use({ extensions: [iconExtension(isIcon, iconHtml)] });

/** Whether `text` holds an icon that would render. */
export const hasIcons = (text: string) => mayHaveIcons(text) && [...text.matchAll(/:([a-z][a-z0-9-]*):/g)].some((m) => known.has(m[1]));

/** What the icon picker inserts into, and what it hangs off. */
export const iconPicker = $state<{ anchor: HTMLElement | { x: number; y: number } | null; onpick: ((name: string) => void) | null }>({
  anchor: null,
  onpick: null,
});

export function pickIcon(anchor: HTMLElement | { x: number; y: number }, onpick: (name: string) => void) {
  iconPicker.anchor = anchor;
  iconPicker.onpick = onpick;
  void loadIcons();
}
