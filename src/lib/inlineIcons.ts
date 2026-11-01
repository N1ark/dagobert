import type { TokenizerAndRendererExtension } from "marked";

/** Inline icons: `:name:` in note text, `name` a kebab-case purr/Phosphor icon name. */
const ICON_RE = /^:([a-z][a-z0-9]*(?:-[a-z0-9]+)*):/;
const WORD = /[\p{L}\p{N}]/u;

/** "AirplaneTakeoff" → "airplane-takeoff". */
export const kebab = (name: string) => name.replace(/\B[A-Z]/g, (c) => "-" + c).toLowerCase();

/** marked extension drawing `:name:` as `html(name)` when `has(name)`, unless right after a letter or digit. */
export function iconExtension(has: (name: string) => boolean, html: (name: string) => string): TokenizerAndRendererExtension {
  return {
    name: "icon",
    level: "inline",
    start(src) {
      const i = src.search(/:[a-z]/);
      return i < 0 ? undefined : i;
    },
    tokenizer(src, tokens) {
      const m = ICON_RE.exec(src);
      if (!m || !has(m[1])) return undefined;
      const prev = tokens[tokens.length - 1]?.raw.slice(-1) ?? "";
      return WORD.test(prev) ? undefined : { type: "icon", raw: m[0], name: m[1] };
    },
    renderer: (token) => html(token.name as string),
  };
}

/** Whether `text` may hold an icon: a cheap test before anything parses it. */
export const mayHaveIcons = (text: string) => /:[a-z][a-z0-9-]*:/.test(text);

/** The icon being typed right before the caret (`:` and 2+ characters, not after a word), if any. */
export function typedIcon(before: string): { start: number; query: string } | null {
  const line = before.lastIndexOf("\n") + 1;
  const m = /(^|[^\p{L}\p{N}]):([a-z][a-z0-9-]+)$/iu.exec(before.slice(line));
  if (!m || (before.slice(line, line + m.index).split("`").length - 1) % 2) return null;
  return { start: line + m.index + m[1].length, query: m[2].toLowerCase() };
}
