import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import type { DelimiterType, InlineContext, MarkdownConfig } from "@lezer/markdown";

/** The markdown dagobert renders beyond GFM, as syntax nodes: `==mark==`, `[[wikilinks]]`, `:icons:` and `alias#123`. */

const HighlightDelim: DelimiterType = { resolve: "Highlight", mark: "HighlightMark" };
const PUNCT = /[\p{P}\p{S}]/u;
const WORD = /[\p{L}\p{N}]/u;
const ICON_RE = /^:([a-z][a-z0-9]*(?:-[a-z0-9]+)*):/;
const isAlias = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45 || c === 46;
const isDigit = (c: number) => c >= 48 && c <= 57;
const isWord = (c: number) => isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const prev = (cx: InlineContext, pos: number) => (pos > cx.offset ? cx.slice(pos - 1, pos) : "");

/** `==text==`, flanking like GFM's `~~`. */
const highlight: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: { "Highlight/...": tags.special(tags.content) } },
    { name: "HighlightMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
        const before = prev(cx, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = PUNCT.test(before);
        const pAfter = PUNCT.test(after);
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter),
        );
      },
      after: "Emphasis",
    },
  ],
};

/** `[[Title]]`: no brackets or line break inside, like `wikilinks.ts`. */
const wikilink: MarkdownConfig = {
  defineNodes: [{ name: "WikiLink", style: tags.link }, { name: "WikiMark", style: tags.processingInstruction }, "WikiTitle"],
  parseInline: [
    {
      name: "WikiLink",
      parse(cx, next, pos) {
        if (next !== 91 || cx.char(pos + 1) !== 91) return -1;
        let end = pos + 2;
        for (; end < cx.end; end++) {
          const c = cx.char(end);
          if (c === 10 || c === 91) return -1;
          if (c === 93) break;
        }
        if (end === pos + 2 || cx.char(end) !== 93 || cx.char(end + 1) !== 93) return -1;
        return cx.addElement(
          cx.elt("WikiLink", pos, end + 2, [
            cx.elt("WikiMark", pos, pos + 2),
            cx.elt("WikiTitle", pos + 2, end),
            cx.elt("WikiMark", end, end + 2),
          ]),
        );
      },
      before: "Link",
    },
  ],
};

/** `:name:` not right after a letter or digit; whether `name` is a real icon is decided when drawing it. */
const inlineIcon: MarkdownConfig = {
  defineNodes: [{ name: "InlineIcon", style: tags.character }],
  parseInline: [
    {
      name: "InlineIcon",
      parse(cx, next, pos) {
        if (next !== 58 || WORD.test(prev(cx, pos))) return -1;
        const m = ICON_RE.exec(cx.slice(pos, Math.min(cx.end, pos + 64)));
        return m ? cx.addElement(cx.elt("InlineIcon", pos, pos + m[0].length)) : -1;
      },
      after: "Emphasis",
    },
  ],
};

/** `alias#123` at a word start; whether `alias` is a configured repo is decided when drawing it. */
const repoRef: MarkdownConfig = {
  defineNodes: [{ name: "RepoRef", style: tags.link }],
  parseInline: [
    {
      name: "RepoRef",
      parse(cx, next, pos) {
        if (!isAlias(next) || /[\w./[`#-]/.test(prev(cx, pos))) return -1;
        let i = pos + 1;
        while (i < cx.end && isAlias(cx.char(i))) i++;
        if (cx.char(i) !== 35 || !isDigit(cx.char(i + 1))) return -1;
        let j = i + 2;
        while (j < cx.end && isDigit(cx.char(j))) j++;
        return isWord(cx.char(j)) ? -1 : cx.addElement(cx.elt("RepoRef", pos, j));
      },
      after: "Autolink",
    },
  ],
};

/** The parser extensions on top of `markdownLanguage`, minus the GFM extras marked doesn't render. */
export const liveSyntax: MarkdownConfig[] = [{ remove: ["Subscript", "Superscript", "Emoji"] }, highlight, wikilink, inlineIcon, repoRef];

/** Where a bare URL or `<autolink>` goes: `www.` is the web, an address is mail. */
export function urlHref(text: string): string {
  const url = text.replace(/^<|>$/g, "");
  if (/^www\./i.test(url)) return "https://" + url;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && url.includes("@")) return "mailto:" + url;
  return url;
}

/** How much wider than `--md-indent` (em) a list marker like `100.` needs its box. */
export const markerExtra = (marker: string) => Math.max(0, Math.round((0.6 * marker.length - 1.5) * 10) / 10);

/** A blank line between two blocks, which reads as a paragraph gap rather than a line. */
export const isGap = (prev: string | null, line: string, next: string | null) =>
  prev !== null && next !== null && !/\S/.test(line) && /\S/.test(prev) && /\S/.test(next);

export function liveMarkdown(): Extension {
  return markdown({ base: markdownLanguage, addKeymap: false, extensions: liveSyntax });
}
