/** Palette for tag colours — the code-hue colours from the site theme. */
export const TAG_PALETTE = [
  "#b045ab", // purple (default)
  "#c678dd",
  "#61afef",
  "#56b6c2",
  "#98c379",
  "#e5c07b",
  "#d19a66",
  "#e06c75",
  "#7e8395",
];

export const DEFAULT_TAG_COLOR = TAG_PALETTE[0];

/** Lower-case `#rrggbb` for a valid hex colour (`#rgb` expanded), else null. */
export function normalizeColor(input: string): string | null {
  const s = input.trim().toLowerCase();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (!m) return null;
  const h = m[1];
  return "#" + (h.length === 3 ? [...h].map((c) => c + c).join("") : h);
}
