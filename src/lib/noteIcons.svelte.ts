import { glyph, type GlyphComponent } from "purr";

/** Note icons: every icon's shapes, in a chunk of their own fetched the first time one is needed. */
let data = $state.raw<Record<string, string> | null>(null);
let loading: Promise<Record<string, string>> | null = null;
const made = new Map<string, GlyphComponent>();

export function loadIcons(): Promise<Record<string, string>> {
  return (loading ??= import("virtual:note-icons").then((m) => (data = m.default)));
}

/** Every icon's name, once loaded. */
export function iconNames(): string[] {
  return data ? Object.keys(data) : [];
}

/** The icon called `name`, or null for none, an unknown name, or while the set is loading. */
export function noteIcon(name: string | null | undefined): GlyphComponent | null {
  if (!name) return null;
  if (!data) {
    loadIcons();
    return null;
  }
  let icon = made.get(name);
  if (!icon && data[name]) made.set(name, (icon = glyph({ regular: data[name] })));
  return icon ?? null;
}

/** "AirplaneTakeoff" → "Airplane takeoff". */
export function iconLabel(name: string): string {
  const words = name.replace(/\B([A-Z])/g, " $1");
  return words[0] + words.slice(1).toLowerCase();
}

/** The note whose icon the picker is choosing, and what it hangs off. */
export const iconPicker = $state<{ id: string | null; anchor: HTMLElement | { x: number; y: number } | null }>({
  id: null,
  anchor: null,
});

export function pickIcon(id: string, anchor: HTMLElement | { x: number; y: number }) {
  iconPicker.id = id;
  iconPicker.anchor = anchor;
  loadIcons();
}
