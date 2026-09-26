import { marked } from "marked";
import DOMPurify from "dompurify";
import { renderWikilinks } from "./wikilinks";

/** Text markdown, wikilinks, refs and autolinks would all leave as it is, so it can skip the parser. */
export const isPlain = (source: string) => !/[\\`*_~[\]!<>&=|#:@\n]|www\./i.test(source);

/** One line of markdown (bold, code, links, wikilinks, repo refs) as sanitised HTML. */
export function inlineHtml(source: string): string {
  if (!source.trim()) return "";
  return DOMPurify.sanitize(marked.parseInline(renderWikilinks(source), { gfm: true, async: false }) as string);
}
