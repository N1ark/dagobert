import type { MarkedExtension } from "marked";
import type { HLJSApi } from "highlight.js";

let hljs: HLJSApi | null = null;
let loading: Promise<void> | null = null;

/** Whether highlight.js is loaded; until then code renders plain. */
export const highlighterReady = () => hljs !== null;

/** Loads highlight.js (a separate chunk, so launch doesn't pay for it). */
export function loadHighlighter(): Promise<void> {
  return (loading ??= import("./hljs.ts").then((m) => {
    hljs = m.default;
  }));
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The language name from a fence's info string (`ts title="x"` → `ts`). */
const langOf = (info: string | undefined) => info?.trim().split(/\s+/)[0].toLowerCase() ?? "";

/** Highlight `code` as `lang` (unknown or missing language, or not loaded yet → escaped plain text). */
export function highlight(code: string, lang: string | undefined): string {
  const l = langOf(lang);
  if (l && !hljs) void loadHighlighter();
  if (!l || !hljs?.getLanguage(l)) return escape(code);
  return hljs.highlight(code, { language: l, ignoreIllegals: true }).value;
}

/** marked extension: fenced code → `<pre><code class="hljs language-x">…` with hljs spans. */
export const highlightExtension: MarkedExtension = {
  renderer: {
    code({ text, lang }) {
      const l = langOf(lang);
      return `<pre><code class="hljs${l ? ` language-${escape(l)}` : ""}">${highlight(text, l)}\n</code></pre>\n`;
    },
  },
};
