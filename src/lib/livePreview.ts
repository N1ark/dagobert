import { syntaxTree } from "@codemirror/language";
import { StateEffect, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { mount, unmount } from "svelte";
import { openUrl } from "@tauri-apps/plugin-opener";
import { focusedField, replaceRange, revealed } from "./liveCore";
import { isGap, markerExtra, urlHref } from "./liveSyntax";
import { watcher, type Watched } from "./liveWatch.svelte";
import { store } from "./store.svelte";
import { resolve } from "./wikilinks";
import { issueUrl, prKey } from "./github";
import { isLocalHref } from "./filelinks";
import { fileTargets } from "./fileTargets.svelte";
import { isIcon, loadIcons } from "./icons.svelte";
import { t } from "./i18n";
import PrIcon from "./PrIcon.svelte";
import FileLinkIcon from "./FileLinkIcon.svelte";

/** Inline live preview: markdown styled in place, its markers hidden except where the selection touches. */

const refresh = StateEffect.define<null>();

/** Left to the block widgets, or plain source. */
const SKIP = new Set([
  "FencedCode",
  "CodeBlock",
  "Table",
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
  "Image",
  "LinkReference",
]);
const BLOCKS = new Set(["FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock", "Table"]);
const INLINE: Record<string, [string, string]> = {
  Emphasis: ["em", "EmphasisMark"],
  StrongEmphasis: ["strong", "EmphasisMark"],
  Strikethrough: ["del", "StrikethroughMark"],
  Highlight: ["mark", "HighlightMark"],
  InlineCode: ["code", "CodeMark"],
};
/** Lines git writes around a conflict, which parse as a setext underline or nested quotes. */
const CONFLICT = /^(={7}$|>{7}( |$))/;

const hidden = Decoration.replace({});
const faint = Decoration.mark({ class: "cm-lp-mark" });
const gap = Decoration.line({ class: "cm-lp-gap" });
const quote = Decoration.line({ class: "cm-lp-quote" });
const setextUnder = Decoration.line({ class: "cm-lp-gap" });
const marker = Decoration.mark({ class: "cm-lp-marker" });
const num = Decoration.mark({ class: "cm-lp-num" });
const bulletMarks = [1, 2, 3].map((n) => Decoration.mark({ class: `cm-lp-bullet cm-lp-bullet${n}` }));
const inlineTags = Object.fromEntries(Object.entries(INLINE).map(([k, [tagName]]) => [k, Decoration.mark({ tagName })]));

const ICON_TEXT = /^:([a-z0-9-]+):$/;
let iconData: Record<string, string> | null = null;

class IconWidget extends WidgetType {
  constructor(readonly name: string) {
    super();
  }
  eq(other: IconWidget) {
    return other.name === this.name;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "ico cm-lp-icon";
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", this.name);
    const fill = (data: Record<string, string>) => {
      const d = data[this.name];
      // Icon shapes ship with the app.
      if (d) span.innerHTML = `<svg viewBox="0 0 256 256" fill="currentColor">${d[0] === "<" ? d : `<path d="${d}"/>`}</svg>`;
    };
    if (iconData) fill(iconData);
    else void loadIcons().then((data) => fill((iconData = data)));
    return span;
  }
}

class CheckWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-check";
    box.checked = this.checked;
    box.tabIndex = -1;
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(box);
      const mark = view.state.sliceDoc(pos, pos + 3);
      if (/^\[[ xX]\]$/.test(mark)) replaceRange(view, pos + 1, pos + 2, mark[1] === " " ? "x" : " ", "check");
    });
    return box;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-lp-hr";
    return hr;
  }
}
const rule = Decoration.replace({ widget: new RuleWidget() });

const mounted = new WeakMap<HTMLElement, ReturnType<typeof mount>>();

/** A live svelte icon (PR state, file kind) in front of a link; clicking it follows the link. */
class MountWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly cls: string,
    readonly draw: (target: HTMLElement) => ReturnType<typeof mount>,
    readonly follow: () => void,
  ) {
    super();
  }
  eq(other: MountWidget) {
    return other.key === this.key;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.cls;
    span.addEventListener("mousedown", (e) => {
      if (e.button || e.altKey) return;
      e.preventDefault();
      this.follow();
    });
    mounted.set(span, this.draw(span));
    return span;
  }
  destroy(dom: HTMLElement) {
    const m = mounted.get(dom);
    if (m) void unmount(m);
  }
}

const prWidget = (repo: string, num: number) => {
  const key = prKey(repo, num);
  return new MountWidget(
    "pr " + key,
    "ghref cm-lp-pr",
    (target) => mount(PrIcon, { target, props: { key, detail: true, host: target } }),
    () => void openUrl(issueUrl(repo, num)).catch(console.error),
  );
};

const fileWidget = (raw: string) =>
  new MountWidget(
    "file " + raw,
    "filelink cm-lp-fileicon",
    (target) => mount(FileLinkIcon, { target, props: { raw, host: target } }),
    () => void fileTargets.open(raw),
  );

/** Follows a link the way rendered markdown did (`links.ts`). */
function follow(el: HTMLElement) {
  const { wiki, file, href } = el.dataset;
  if (wiki !== undefined) {
    const n = resolve(wiki);
    if (n) store.jump(n.id);
  } else if (file !== undefined) void fileTargets.open(file);
  else if (href && /^(https?:|mailto:)/.test(href)) openUrl(href).catch(console.error);
}

const wikiState = (title: string) => {
  const n = resolve(title);
  return !n ? "missing" : store.isDone(n) ? "done" : "ok";
};
const fileState = (raw: string) => (fileTargets.get(raw)?.kind === null ? "missing" : "ok");

/** Width of a list item's text column and of its own marker box, from `--md-indent` and the markers' extra width. */
function listGeometry(item: SyntaxNode, doc: EditorState["doc"]) {
  let k = 0,
    extra = 0,
    own = 0,
    bullets = 0;
  for (let p: SyntaxNode | null = item; p; p = p.parent) {
    if (p.name === "BulletList") bullets++;
    if (p.name !== "ListItem") continue;
    // A list's items share one column, set by its widest marker: the first or the last.
    const e = Math.max(
      ...[p, p.parent?.firstChild, p.parent?.lastChild].map((li) => {
        const m = li?.getChild("ListMark");
        return m ? markerExtra(doc.sliceString(m.from, m.to)) : 0;
      }),
    );
    if (!k) own = e;
    k++;
    extra += e;
  }
  return {
    style: `--lp-indent: calc(${k} * var(--md-indent) + ${extra}em); --lp-hang: calc(var(--md-indent) + ${own}em)`,
    bullet: ((bullets - 1) % 3) + 1,
  };
}

function build(view: EditorView, watched: Map<string, Watched>): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const out: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  const { from: vFrom, to: vTo } = view.viewport;
  const listLines = new Map<number, { style: string; first: boolean }>();
  const watch = (key: string, read: () => string) => {
    let w = watched.get(key);
    if (!w) watched.set(key, (w = { read, seen: read() }));
    return w.seen;
  };
  const shown = (from: number, to: number) => revealed(state, from, to);
  // A plugin may not hide a line break, so markers spanning one (a link's destination on its own line) stay.
  const hideOr = (from: number, to: number, show: boolean) => {
    if (from < to) out.push((show || doc.lineAt(from).to < to ? faint : hidden).range(from, to));
  };
  const lineDeco = (pos: number, cls: string, style?: string) =>
    out.push(Decoration.line({ class: cls, attributes: style ? { style } : undefined }).range(doc.lineAt(pos).from));
  const linkMark = (from: number, to: number, cls: string, data: Record<string, string> | null, title?: string) => {
    if (from >= to) return;
    const attributes: Record<string, string> = {};
    if (data) for (const [k, v] of Object.entries({ "lp-link": "", ...data })) attributes["data-" + k] = v;
    if (title) attributes.title = title;
    out.push(Decoration.mark({ class: cls, attributes }).range(from, to));
  };

  // A heading's space above and below, less where a blank line already gives some (0: inside a heading).
  const spacing = (first: number, last: number) => {
    const prev = first > 1 ? doc.line(first - 1).text : null;
    const next = last && last < doc.lines ? doc.line(last + 1).text : null;
    return (
      (first === 0 ? " cm-lp-h-in" : prev === null ? " cm-lp-h-first" : /\S/.test(prev) ? "" : " cm-lp-h-gap") +
      (last && next !== null && /\S/.test(next) ? "" : " cm-lp-h-end")
    );
  };

  const enter = (ref: SyntaxNodeRef): boolean | void => {
    const name = ref.name;
    if (SKIP.has(name)) return false;
    const node = ref.node;

    if (name in INLINE) {
      const show = shown(node.from, node.to);
      out.push(inlineTags[name].range(node.from, node.to));
      for (const m of node.getChildren(INLINE[name][1])) hideOr(m.from, m.to, show);
      return name !== "InlineCode";
    }

    if (name.startsWith("ATXHeading")) {
      const line = doc.lineAt(node.from);
      const show = shown(line.from, line.to);
      lineDeco(line.from, `cm-lp-h cm-lp-h${name.slice(-1)}${spacing(line.number, line.number)}`);
      const marks = node.getChildren("HeaderMark");
      marks.forEach((m, i) => {
        if (i === 0 && m.from === node.from) {
          const end = Math.min(line.to, m.to + (doc.sliceString(m.to, m.to + 1) === " " ? 1 : 0));
          hideOr(m.from, end, show);
        } else {
          let start = m.from;
          while (start > line.from && doc.sliceString(start - 1, start) === " ") start--;
          hideOr(start, m.to, show);
        }
      });
      return;
    }

    if (name === "SetextHeading1" || name === "SetextHeading2") {
      const under = node.lastChild?.name === "HeaderMark" ? node.lastChild : null;
      if (!under || CONFLICT.test(doc.sliceString(under.from, under.to))) return;
      const show = shown(node.from, node.to);
      const last = doc.lineAt(under.from);
      const first = doc.lineAt(node.from).number;
      for (let n = first; n < last.number; n++)
        lineDeco(doc.line(n).from, `cm-lp-h cm-lp-h${name.slice(-1)}${spacing(n === first ? n : 0, 0)}`);
      if (!show) out.push(setextUnder.range(last.from));
      hideOr(under.from, under.to, show);
      return;
    }

    if (name === "Escape") {
      hideOr(node.from, node.from + 1, shown(node.from, node.to));
      return false;
    }

    if (name === "Link") {
      const marks = node.getChildren("LinkMark");
      const url = node.getChild("URL");
      if (marks.length < 2 || (!url && !node.getChild("LinkLabel"))) return;
      const textFrom = marks[0].to;
      const textTo = marks[1].from;
      if (textFrom === textTo) return;
      const show = shown(node.from, node.to);
      hideOr(node.from, textFrom, show);
      hideOr(textTo, node.to, show);
      const href = url ? doc.sliceString(url.from, url.to).replace(/^<|>$/g, "") : "";
      if (href && isLocalHref(href)) {
        const missing = watch("file " + href, () => fileState(href)) === "missing";
        out.push(Decoration.widget({ widget: fileWidget(href), side: -1 }).range(node.from));
        linkMark(textFrom, textTo, missing ? "filelink missing" : "filelink", show ? null : { file: href });
      } else {
        linkMark(textFrom, textTo, "cm-lp-link", show || !/^(https?:|mailto:)/.test(href) ? null : { href });
      }
      return;
    }

    if (name === "Autolink" || name === "URL") {
      if (name === "URL" && /^(Link|Image|Autolink)$/.test(node.parent?.name ?? "")) return false;
      const show = shown(node.from, node.to);
      const text = doc.sliceString(node.from, node.to);
      const href = urlHref(text);
      if (name === "Autolink") {
        hideOr(node.from, node.from + 1, show);
        hideOr(node.to - 1, node.to, show);
      }
      const inner = name === "Autolink" ? 1 : 0;
      linkMark(node.from + inner, node.to - inner, "cm-lp-link", show || !/^(https?:|mailto:)/.test(href) ? null : { href });
      return false;
    }

    if (name === "WikiLink") {
      const title = doc.sliceString(node.from + 2, node.to - 2);
      const show = shown(node.from, node.to);
      const st = watch("wiki " + title.trim().toLowerCase(), () => wikiState(title));
      hideOr(node.from, node.from + 2, show);
      hideOr(node.to - 2, node.to, show);
      if (st === "missing") linkMark(node.from + 2, node.to - 2, "wikilink missing", null, t("editor.wikilink.missing"));
      else linkMark(node.from + 2, node.to - 2, st === "done" ? "wikilink done" : "wikilink", show ? null : { wiki: title });
      return false;
    }

    if (name === "InlineIcon") {
      const m = ICON_TEXT.exec(doc.sliceString(node.from, node.to));
      if (m && isIcon(m[1]) && !shown(node.from, node.to))
        out.push(Decoration.replace({ widget: new IconWidget(m[1]) }).range(node.from, node.to));
      return false;
    }

    if (name === "RepoRef") {
      for (let p = node.parent; p; p = p.parent) if (p.name === "Link") return false;
      const text = doc.sliceString(node.from, node.to);
      const hash = text.lastIndexOf("#");
      const alias = text.slice(0, hash);
      const repo = watch("repo " + alias, () => store.repos[alias] ?? "");
      if (!repo) return false;
      const num = Number(text.slice(hash + 1));
      out.push(Decoration.widget({ widget: prWidget(repo, num), side: -1 }).range(node.from));
      linkMark(node.from, node.to, "ghref", shown(node.from, node.to) ? null : { href: issueUrl(repo, num) });
      return false;
    }

    if (name === "ListItem") {
      const mark = node.getChild("ListMark");
      if (!mark) return;
      const line = doc.lineAt(mark.from);
      const geo = listGeometry(node, doc);
      const last = doc.lineAt(Math.min(node.to, vTo)).number;
      for (let n = Math.max(line.number, doc.lineAt(vFrom).number); n <= last; n++)
        listLines.set(n, { style: geo.style, first: n === line.number });
      const task = node.getChild("Task")?.getChild("TaskMarker");
      const show = shown(mark.from, task ? task.to : mark.to);
      let content = mark.to;
      while (content < line.to && content - mark.to < 4 && doc.sliceString(content, content + 1) === " ") content++;
      const boxEnd = task ? Math.min(line.to, task.to + 1) : content;
      let indent = mark.from;
      while (indent > line.from && /[ \t]/.test(doc.sliceString(indent - 1, indent))) indent--;
      if (indent < mark.from) out.push(hidden.range(indent, mark.from));
      out.push(marker.range(mark.from, Math.max(boxEnd, mark.to)));
      if (task && !show) {
        out.push(hidden.range(mark.from, task.from));
        const checked = doc.sliceString(task.from + 1, task.from + 2) !== " ";
        out.push(Decoration.replace({ widget: new CheckWidget(checked) }).range(task.from, task.to));
      } else if (show) {
        out.push(faint.range(mark.from, mark.to));
        if (task) out.push(faint.range(task.from, task.to));
      } else {
        out.push((mark.to - mark.from === 1 ? bulletMarks[geo.bullet - 1] : num).range(mark.from, mark.to));
      }
      return;
    }

    if (name === "Blockquote") {
      const end = doc.lineAt(node.to).number;
      for (let n = doc.lineAt(node.from).number; n <= end; n++) {
        const line = doc.line(n);
        if (line.from > vTo) break;
        if (!CONFLICT.test(line.text.trimStart())) out.push(quote.range(line.from));
      }
      return;
    }

    if (name === "QuoteMark") {
      const line = doc.lineAt(node.from);
      if (CONFLICT.test(line.text.trimStart())) return false;
      const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
      hideOr(node.from, end, shown(line.from, line.to));
      return false;
    }

    if (name === "HorizontalRule") {
      const line = doc.lineAt(node.from);
      if (shown(line.from, line.to)) out.push(faint.range(node.from, node.to));
      else out.push(rule.range(node.from, node.to));
      return false;
    }
  };

  tree.iterate({ from: vFrom, to: vTo, enter });

  const inBlock = (pos: number) => {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) if (BLOCKS.has(n.name)) return true;
    return false;
  };
  for (let pos = vFrom; pos <= vTo;) {
    const line = doc.lineAt(pos);
    const n = line.number;
    const list = listLines.get(n);
    if (/\S/.test(line.text)) {
      if (list && !inBlock(line.from)) {
        lineDeco(line.from, list.first ? "cm-lp-li" : "cm-lp-li cm-lp-cont", list.style);
        const lead = /^[ \t]*/.exec(line.text)![0].length;
        if (!list.first && lead) out.push(hidden.range(line.from, line.from + lead));
      }
    } else if (isGap(n > 1 ? doc.line(n - 1).text : null, line.text, n < doc.lines ? doc.line(n + 1).text : null) && !inBlock(line.from)) {
      out.push(gap.range(line.from));
    }
    pos = line.to + 1;
  }
  return Decoration.set(out, true);
}

class Preview {
  deco: DecorationSet;
  watch: ReturnType<typeof watcher>;
  /** A pointer press in progress: what's revealed waits for its release, so text doesn't move under a drag. */
  pressed = false;
  gone = false;

  constructor(readonly view: EditorView) {
    this.watch = watcher(() => this.gone || view.dispatch({ effects: refresh.of(null) }));
    this.deco = this.draw();
  }

  draw() {
    const watched = new Map<string, Watched>();
    const deco = build(this.view, watched);
    this.watch.set(watched);
    return deco;
  }

  update(u: ViewUpdate) {
    const moved = u.selectionSet || u.startState.field(focusedField, false) !== u.state.field(focusedField, false);
    if (
      u.docChanged ||
      u.viewportChanged ||
      syntaxTree(u.startState) !== syntaxTree(u.state) ||
      u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh))) ||
      (moved && !this.pressed)
    )
      this.deco = this.draw();
  }

  mousedown(e: MouseEvent) {
    if (e.button !== 0) return false;
    const link = e.altKey || e.shiftKey ? null : (e.target as HTMLElement).closest?.<HTMLElement>("[data-lp-link]");
    if (link && this.view.contentDOM.contains(link)) {
      e.preventDefault();
      follow(link);
      return true;
    }
    this.pressed = true;
    const up = () => {
      window.removeEventListener("mouseup", up);
      queueMicrotask(() => {
        this.pressed = false;
        if (!this.gone) this.view.dispatch({ effects: refresh.of(null) });
      });
    };
    window.addEventListener("mouseup", up);
    return false;
  }

  destroy() {
    this.gone = true;
    this.watch.stop();
  }
}

const preview = ViewPlugin.fromClass(Preview, {
  decorations: (p) => p.deco,
  eventHandlers: {
    mousedown(e) {
      return this.mousedown(e);
    },
  },
});

/** Sizes and colours from purr's tokens and `.md` rhythm, so the source reads like the rendered note. */
const theme = EditorView.theme({
  "&": { color: "var(--color)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font)", lineHeight: "var(--md-line-height)" },
  ".cm-content": { padding: "0", fontSize: "var(--fs-base)", caretColor: "var(--color2)" },
  // Safari zooms into a field under 16px.
  "body.mobile & .cm-content": { fontSize: "16px" },
  ".cm-line": { padding: "0" },
  ".cm-content ::selection": { background: "var(--selection)" },
  ".cm-lp-mark": { color: "var(--faint)" },
  ".cm-lp-gap": { fontSize: "calc(var(--md-block) / 1.5)", lineHeight: "1.5" },
  ".cm-lp-h": {
    fontWeight: "var(--md-heading-weight)",
    lineHeight: "1.25",
    color: "var(--color2)",
    paddingTop: "var(--md-heading-before)",
    paddingBottom: "var(--md-heading-after)",
  },
  ".cm-lp-h1": { fontSize: "var(--md-h1)" },
  ".cm-lp-h2": { fontSize: "var(--md-h2)" },
  ".cm-lp-h3": { fontSize: "var(--md-h3)" },
  ".cm-lp-h4, .cm-lp-h5, .cm-lp-h6": { fontSize: "var(--md-h4)" },
  ".cm-lp-h.cm-lp-h-gap": { paddingTop: "calc(var(--md-heading-before) - var(--md-block))" },
  ".cm-lp-h.cm-lp-h-first, .cm-lp-h.cm-lp-h-in": { paddingTop: "0" },
  ".cm-lp-h.cm-lp-h-end": { paddingBottom: "0" },
  ".cm-lp-quote": { borderLeft: "2px solid var(--border-strong)", paddingLeft: "0.75em", color: "var(--muted)" },
  ".cm-lp-li": { paddingLeft: "var(--lp-indent)", textIndent: "calc(-1 * var(--lp-hang))" },
  ".cm-lp-li.cm-lp-cont": { textIndent: "0" },
  ".cm-lp-li.cm-lp-quote": { paddingLeft: "calc(var(--lp-indent) + 0.75em)" },
  ".cm-lp-marker": {
    display: "inline-block",
    minWidth: "var(--lp-hang)",
    textIndent: "0",
    textAlign: "right",
    whiteSpace: "pre",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-lp-bullet": { position: "relative", WebkitTextFillColor: "transparent" },
  ".cm-lp-bullet::before": {
    content: '""',
    position: "absolute",
    left: "50%",
    top: "55%",
    width: "0.36em",
    height: "0.36em",
    transform: "translate(-50%, -50%)",
    borderRadius: "var(--radius-pill)",
    background: "currentColor",
  },
  ".cm-lp-bullet2::before": { background: "none", boxShadow: "inset 0 0 0 1px currentColor" },
  ".cm-lp-bullet3::before": { borderRadius: "0", width: "0.32em", height: "0.32em" },
  ".cm-lp-check": { cursor: "pointer", textIndent: "0" },
  ".cm-lp-hr": {
    display: "inline-block",
    width: "100%",
    verticalAlign: "middle",
    borderTop: "1px solid var(--border)",
  },
  ".cm-lp-link": { color: "var(--theme2)" },
  "[data-lp-link]": { cursor: "pointer" },
  "@media (hover: hover)": {
    ".cm-lp-link[data-lp-link]:hover": { textDecoration: "underline", textUnderlineOffset: "2px" },
  },
  ".cm-lp-icon svg": { display: "block", width: "100%", height: "100%" },
  ".cm-lp-pr, .cm-lp-fileicon": { cursor: "pointer", borderBottomColor: "transparent" },
  ".cm-lp-fileicon .filelink-icon": { display: "inline-flex", verticalAlign: "-0.15em", marginRight: "var(--sp-1)" },
});

/** Decorations, inline widgets and the editor's look; `.md` on the content gives it purr's markdown rhythm and styles. */
export function livePreview(): Extension {
  return [preview, theme, EditorView.lineWrapping, EditorView.contentAttributes.of({ class: "md" })];
}
