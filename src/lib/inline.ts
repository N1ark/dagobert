import { marked } from "marked";
import DOMPurify from "dompurify";
import { renderWikilinks } from "./wikilinks";

/** One line of markdown (bold, code, links, wikilinks, repo refs) as sanitised HTML. */
export function inlineHtml(source: string): string {
  if (!source.trim()) return "";
  return DOMPurify.sanitize(marked.parseInline(renderWikilinks(source), { gfm: true, async: false }) as string);
}
