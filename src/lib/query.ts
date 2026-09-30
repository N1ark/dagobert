/** Parse the palette query into its mode and the text to match: a leading `#tag` filters notes. */
export function parseQuery(raw: string): { text: string; tag: string | null } {
  const s = raw.trimStart();
  const m = /^#(\S*)\s*(.*)$/.exec(s);
  if (m) return { text: m[2].trim(), tag: m[1].toLowerCase() };
  return { text: s.trim(), tag: null };
}
