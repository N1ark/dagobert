import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { redo, undo } from "@codemirror/commands";
import type { SyntaxNode } from "@lezer/common";
import type { Sel } from "./editor.ts";
import { diff } from "./liveCore.ts";
import { isLinkEmbed } from "./media.ts";

/** The host's editing helpers around the live editor's single `EditorView`. */

/** Runs a `Sel → Sel` command from `editor.ts` on the doc and main selection, as a minimal change. */
export function applySel(view: EditorView, fn: (s: Sel) => Sel | null, userEvent = "input"): boolean {
  const { from, to } = view.state.selection.main;
  const next = fn({ text: view.state.doc.toString(), start: from, end: to });
  if (!next) return false;
  view.dispatch({
    changes: diff(view.state.doc, next.text) ?? [],
    selection: EditorSelection.single(next.start, next.end),
    scrollIntoView: true,
    userEvent,
  });
  return true;
}

/** Whether `pos` is inside a fenced or indented code block. */
export function inCode(state: EditorState, pos: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === "FencedCode" || n.name === "CodeBlock") return true;
  }
  return false;
}

const LINKISH = new Set(["Link", "Image", "Autolink", "URL"]);

/** The link at `pos` (`[t](url)`, `<url>`, a bare URL, or a preview card `![](url)`), with the source it spans. */
export function linkAt(state: EditorState, pos: number): { from: number; to: number; url: string; card: boolean } | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    let n: SyntaxNode | null = tree.resolveInner(pos, side);
    while (n && !LINKISH.has(n.name)) n = n.parent;
    if (!n) continue;
    if (n.name === "URL" && n.parent && LINKISH.has(n.parent.name)) n = n.parent;
    const u = n.name === "URL" ? n : n.getChild("URL");
    if (!u) continue;
    const url = state.sliceDoc(u.from, u.to).replace(/^<(.*)>$/, "$1");
    if (n.name === "Image" && !isLinkEmbed(url)) return null;
    return { from: n.from, to: n.to, url, card: n.name === "Image" };
  }
  return null;
}

/** The top-level block (paragraph, list, fence, …) holding `pos`, else its line. */
export function topBlockAt(state: EditorState, pos: number): { from: number; to: number } {
  let n = syntaxTree(state).resolveInner(pos, 1);
  while (n.parent?.parent) n = n.parent;
  if (n.parent) return { from: n.from, to: n.to };
  const line = state.doc.lineAt(pos);
  return { from: line.from, to: line.to };
}

/** Undo or redo in the editor holding `el`; false when it isn't in one. */
export function editorHistory(el: Element | null, kind: "undo" | "redo"): boolean {
  const root = el?.closest<HTMLElement>(".cm-editor");
  const view = root ? EditorView.findFromDOM(root) : null;
  if (!view) return false;
  (kind === "undo" ? undo : redo)(view);
  return true;
}

/** The whitespace `text` ends with. */
export function tailOf(text: string): string {
  return text.slice(text.trimEnd().length);
}

/**
 * Embeds as paragraphs of their own in place of `from..to`, blank lines around them. `open` leaves an empty
 * paragraph after them when nothing follows (typing goes on there); otherwise the text's trailing whitespace stays.
 */
export function embedChange(
  text: string,
  from: number,
  to: number,
  embeds: string[],
  open: boolean,
): { from: number; to: number; insert: string; caret: number } {
  // At a line's start (or in its indent) the line keeps its indent; in the middle the spaces at the cut go.
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const atLineStart = !text.slice(lineStart, from).trim();
  const pre = text.slice(0, atLineStart ? lineStart : from).trimEnd();
  let end = to;
  const blankRest = /[ \t]*(?:\n|$)/y;
  blankRest.lastIndex = end;
  if (blankRest.exec(text)) {
    const blank = /[ \t]*\n/y;
    blank.lastIndex = end = blankRest.lastIndex;
    while (blank.exec(text)) end = blank.lastIndex;
  } else if (atLineStart) {
    if (to === from) end = lineStart;
  } else {
    while (text[end] === " " || text[end] === "\t") end++;
  }
  const rest = !!text.slice(end).trim();
  const body = (pre ? "\n\n" : "") + embeds.join("\n\n");
  if (!rest && !open) {
    return { from: pre.length, to: Math.max(pre.length, text.trimEnd().length), insert: body, caret: pre.length + body.length };
  }
  const insert = body + "\n\n";
  return { from: pre.length, to: rest ? end : text.length, insert, caret: pre.length + insert.length };
}
