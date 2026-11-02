import {
  EditorSelection,
  Facet,
  Prec,
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type Text,
  type Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { TreeCursor } from "@lezer/common";
import { mount, unmount, type ComponentProps } from "svelte";
import LiveBlock from "./LiveBlock.svelte";
import { focusedField, placeCaret, replaceRange, revealed } from "./liveCore";
import { conflictSpans, dedent, resolveConflict } from "./blocks";
import { galleryGroups, galleryHeight, imageCount } from "./media";
import { embedAt, rawOffset, setMediaHeight, setMediaWidth } from "./editor";

/** What the editor hosting the block widgets does for them. */
export interface BlockHost {
  /** Show a clicked image full screen (purr's Lightbox), with the note's others a step away. */
  viewImage(img: HTMLImageElement): void;
}

const hostFacet = Facet.define<BlockHost, BlockHost | null>({ combine: (v) => v[0] ?? null });

/** A gallery row's base height, unless its first image sets one. */
const GALLERY_ROW = 90;
/** Rendered embeds, in source order: what `setMediaWidth` and `embedAt` count. */
const EMBEDS = ".media, audio, a.link-card";

type Kind = "code" | "table" | "html" | "media" | "conflict" | "comment";

/** A part of the note shown as a block widget unless revealed (a comment never is): whole lines `from..to`. */
interface Item {
  kind: Kind;
  from: number;
  to: number;
  /** Images of an image-only paragraph (0 for anything else): those make galleries. */
  images: number;
  /** An image-only paragraph right after another: the two may share a gallery. */
  follows: boolean;
  /** Leading whitespace of code nested in a list item. */
  indent: number;
}

interface Blocks {
  items: Item[];
  /** Which items (and gaps between gallery paragraphs) are revealed, as a string to compare. */
  key: string;
  decos: DecorationSet;
  /** The doc has a line starting a conflict region, so it's scanned for them. */
  conflicts: boolean;
}

const blank = (s: string) => !s.trim();
const CONFLICT_LINE = "<<<<<<< ";

/** An image-only top-level paragraph's image count (0 when it holds other embeds), or null when it holds text. */
function mediaOnly(cur: TreeCursor, doc: Text): number | null {
  const { from, to } = cur;
  if (!cur.firstChild()) return null;
  let pos = from;
  let ok = cur.from === from && cur.name === "Image";
  while (ok) {
    if ((cur.name !== "Image" && cur.name !== "HardBreak") || !blank(doc.sliceString(pos, cur.from))) ok = false;
    pos = cur.to;
    if (!cur.nextSibling()) break;
  }
  cur.parent();
  if (!ok || !blank(doc.sliceString(pos, to))) return null;
  return imageCount(doc.sliceString(from, to));
}

function lines(doc: Text, from: number, to: number) {
  return { from: doc.lineAt(from).from, to: doc.lineAt(to).to };
}

/** The parts of the note that render as blocks, in order: top-level nodes of the tree, code in lists, conflict regions. */
function collect(state: EditorState, scanConflicts: boolean): Item[] {
  const doc = state.doc;
  const spans = scanConflicts ? conflictSpans(doc.toString()) : [];
  const tree = syntaxTree(state);
  const items: Item[] = [];
  const cur = tree.cursor();
  let s = 0;
  let prev: Item | null = null;
  const item = (kind: Kind, from: number, to: number, images = 0, follows = false, indent = 0): Item => ({
    kind,
    ...lines(doc, from, to),
    images,
    follows,
    indent,
  });
  if (cur.firstChild())
    do {
      const { from, to, name } = cur;
      while (s < spans.length && spans[s].to < from) s++;
      let next: Item | null = null;
      if (s < spans.length && spans[s].from <= to) {
        prev = null;
        continue;
      }
      if (name === "FencedCode" || name === "CodeBlock") next = item("code", from, to);
      else if (name === "Table") next = item("table", from, to);
      else if (name === "HTMLBlock") next = item("html", from, to);
      else if (name === "CommentBlock") next = item("comment", from, to);
      else if (name === "Paragraph") {
        const images = mediaOnly(cur, doc);
        if (images !== null) next = item("media", from, to, images, !!images && !!prev?.images);
      } else if (name === "BulletList" || name === "OrderedList") {
        tree.iterate({
          from,
          to,
          enter: (n) => {
            if (n.name === "FencedCode") {
              const start = doc.lineAt(n.from).from;
              if (blank(doc.sliceString(start, n.from))) items.push(item("code", n.from, n.to, 0, false, n.from - start));
              return false;
            }
            return n.name === "Document" || n.name === "BulletList" || n.name === "OrderedList" || n.name === "ListItem";
          },
        });
      }
      if (next) items.push(next);
      prev = next;
    } while (cur.nextSibling());
  if (!spans.length) return items;
  for (const sp of spans) items.push(item("conflict", sp.from, sp.to));
  return items.sort((a, b) => a.from - b.from);
}

/** Whether a changed line of the new doc starts a conflict region. */
function touchesConflict(tr: Transaction): boolean {
  let hit = false;
  const doc = tr.state.doc;
  tr.changes.iterChangedRanges((_fa, _ta, from, to) => {
    for (let pos = from; !hit && pos <= to;) {
      const line = doc.lineAt(pos);
      if (line.text.startsWith(CONFLICT_LINE)) hit = true;
      pos = line.to + 1;
    }
  });
  return hit;
}

function hasConflictLine(doc: Text): boolean {
  for (const line of doc.iterLines()) if (line.startsWith(CONFLICT_LINE)) return true;
  return false;
}

/** Which items show their source, and which gaps between gallery paragraphs hold a selection. */
function reveal(state: EditorState, items: Item[]) {
  const shown = items.map((it) => revealed(state, it.from, it.to));
  const gaps = items.map((it, i) => it.follows && revealed(state, items[i - 1].to + 1, it.from - 1));
  const key = shown.map((v, i) => (v ? "1" : "0") + (gaps[i] ? "1" : "0")).join("");
  return { shown, gaps, key };
}

const codeLine = Decoration.line({ class: "cm-lb-code" });
const codeFirst = Decoration.line({ class: "cm-lb-code cm-lb-first" });
const codeLast = Decoration.line({ class: "cm-lb-code cm-lb-last" });
const codeOnly = Decoration.line({ class: "cm-lb-code cm-lb-first cm-lb-last" });
const monoLine = Decoration.line({ class: "cm-lb-mono" });
const markerLine = Decoration.line({ class: "cm-lb-marker" });
const commentLine = Decoration.line({ class: "cm-lb-comment" });

function decorate(state: EditorState, items: Item[], r: ReturnType<typeof reveal>): DecorationSet {
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  const groups = galleryGroups(
    items.map((it, i) => ({ images: it.kind === "media" && !r.shown[i] ? it.images : 0, joins: it.follows && !r.gaps[i] })),
  );
  let g = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (g < groups.length && groups[g].start === i) {
      const { end } = groups[g++];
      const from = it.from;
      const to = items[end - 1].to;
      const parts = items.slice(i, end).map((p) => ({ off: p.from - from, len: p.to - p.from }));
      out.push(Decoration.replace({ widget: new GalleryWidget(doc.sliceString(from, to), parts), block: true }).range(from, to));
      i = end - 1;
      continue;
    }
    if (!r.shown[i] && it.kind !== "comment") {
      const text = doc.sliceString(it.from, it.to);
      const widget = it.kind === "conflict" ? new ConflictWidget(text) : new MdWidget(text, it.kind, it.indent);
      out.push(Decoration.replace({ widget, block: true }).range(it.from, it.to));
      continue;
    }
    if (it.kind === "media") continue;
    const first = doc.lineAt(it.from).number;
    const last = doc.lineAt(it.to).number;
    for (let n = first; n <= last; n++) {
      const line = doc.line(n);
      let deco = monoLine;
      if (it.kind === "comment") deco = commentLine;
      else if (it.kind === "code") deco = first === last ? codeOnly : n === first ? codeFirst : n === last ? codeLast : codeLine;
      else if (it.kind === "conflict") {
        if (!/^(<{7} |={7}$|>{7} )/.test(line.text)) continue;
        deco = markerLine;
      }
      out.push(deco.range(line.from));
    }
  }
  return Decoration.set(out, true);
}

function compute(state: EditorState, conflicts: boolean): Blocks {
  const items = collect(state, conflicts);
  const r = reveal(state, items);
  return { items, key: r.key, decos: decorate(state, items, r), conflicts };
}

const blocksField = StateField.define<Blocks>({
  create: (state) => compute(state, hasConflictLine(state.doc)),
  update(value, tr) {
    const tree = syntaxTree(tr.startState) !== syntaxTree(tr.state);
    const focus = tr.startState.field(focusedField, false) !== tr.state.field(focusedField, false);
    if (tr.docChanged || tree) {
      const conflicts = tr.docChanged ? (value.conflicts ? hasConflictLine(tr.state.doc) : touchesConflict(tr)) : value.conflicts;
      return compute(tr.state, conflicts);
    }
    if (!tr.selection && !focus) return value;
    const r = reveal(tr.state, value.items);
    if (r.key === value.key) return value;
    return { ...value, key: r.key, decos: decorate(tr.state, value.items, r) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

/** The item of `items` (sorted, disjoint) around `pos`, if any. */
function itemAt(items: Item[], pos: number): Item | null {
  let lo = 0,
    hi = items.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const it = items[mid];
    if (pos < it.from) hi = mid - 1;
    else if (pos > it.to) lo = mid + 1;
    else return it;
  }
  return null;
}

// ---- widgets -----------------------------------------------------------------------------

type BlockProps = ComponentProps<typeof LiveBlock>;

interface Mounted {
  widget: Base;
  comp: ReturnType<typeof mount>;
  ro: ResizeObserver;
}
const mounted = new WeakMap<HTMLElement, Mounted>();

abstract class Base extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  abstract readonly kind: string;
  abstract props(view: EditorView, dom: HTMLElement): BlockProps;

  eq(other: WidgetType): boolean {
    return other instanceof Base && other.kind === this.kind && other.text === this.text && this.same(other);
  }
  same(_other: Base): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const dom: HTMLElement = document.createElement(this.kind === "inline" ? "span" : "div");
    dom.className = this.kind === "inline" ? "cm-lb-inline" : "cm-lb";
    const ro = new ResizeObserver(() => view.requestMeasure());
    ro.observe(dom);
    mounted.set(dom, { widget: this, comp: mount(LiveBlock, { target: dom, props: this.props(view, dom) }), ro });
    dom.addEventListener("click", (e) => onClick(e, view, dom));
    dom.addEventListener("pointerdown", (e) => {
      press = { dom, x: e.clientX, y: e.clientY };
      onPointerDown(e, view, dom);
    });
    dom.addEventListener("load", (e) => onLoad(e, view), true);
    return dom;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const m = mounted.get(dom);
    if (!m || m.widget.kind !== this.kind) return false;
    void unmount(m.comp);
    m.widget = this;
    m.comp = mount(LiveBlock, { target: dom, props: this.props(view, dom) });
    return true;
  }

  destroy(dom: HTMLElement) {
    const m = mounted.get(dom);
    if (!m) return;
    m.ro.disconnect();
    void unmount(m.comp);
    mounted.delete(dom);
  }

  /** The widget's events are its own: links, players, handles and clicks are handled here, not by the editor. */
  ignoreEvent(): boolean {
    return true;
  }

  /** Where this widget's source is now, or null if the doc moved under it. */
  range(view: EditorView, dom: HTMLElement): { from: number; to: number } | null {
    let from: number;
    try {
      from = view.posAtDOM(dom);
    } catch {
      return null;
    }
    const to = from + this.text.length;
    return view.state.doc.sliceString(from, to) === this.text ? { from, to } : null;
  }

  /** The source offset a click on the rendering lands at, and the middle of the line clicked. */
  caretAt(e: MouseEvent, dom: HTMLElement): { caret: number; y: number } {
    return caretFromClick(e, dom.querySelector(".md") ?? dom, this.text);
  }

  /** The paragraph (offset and source) holding an embed element, and the embed's index in it. */
  embedOf(dom: HTMLElement, el: Element): { off: number; src: string; index: number } {
    return { off: 0, src: this.text, index: [...dom.querySelectorAll(EMBEDS)].indexOf(el) };
  }
}

class MdWidget extends Base {
  readonly kind = "md";
  constructor(
    text: string,
    readonly block: Kind,
    readonly indent: number,
  ) {
    super(text);
  }
  same(other: Base) {
    return other instanceof MdWidget && other.indent === this.indent;
  }
  props(): BlockProps {
    return { kind: "md", sources: [this.indent ? dedent(this.text, this.indent) : this.text], indent: this.indent };
  }
  get estimatedHeight() {
    const n = this.text.split("\n").length;
    if (this.block === "code") return n * 19 + 32;
    if (this.block === "table") return n * 26 + 12;
    if (this.block === "media") return 220;
    return n * 24 + 8;
  }
}

class ConflictWidget extends Base {
  readonly kind = "conflict";
  props(view: EditorView, dom: HTMLElement): BlockProps {
    return {
      kind: "conflict",
      sources: [this.text],
      onresolve: (keep: "mine" | "theirs" | "both") => {
        const w = mounted.get(dom)?.widget ?? this;
        const r = w.range(view, dom);
        if (r) replaceRange(view, r.from, r.to, resolveConflict(w.text, keep), "resolveConflict");
      },
      onedit: (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest("a, button, video, audio")) edit(e, view, dom);
      },
    };
  }
  caretAt(e: MouseEvent, dom: HTMLElement) {
    return caretFromClick(e, dom, this.text);
  }
  get estimatedHeight() {
    return this.text.split("\n").length * 18 + 40;
  }
}

class GalleryWidget extends Base {
  readonly kind = "gallery";
  constructor(
    text: string,
    readonly parts: { off: number; len: number }[],
  ) {
    super(text);
  }
  get sources() {
    return this.parts.map((p) => this.text.slice(p.off, p.off + p.len));
  }
  props(): BlockProps {
    return { kind: "gallery", sources: this.sources, rowHeight: galleryHeight(this.sources[0]) };
  }
  embedOf(dom: HTMLElement, el: Element) {
    const para = el.closest<HTMLElement>("[data-para]");
    const k = Number(para?.dataset.para ?? 0);
    const p = this.parts[k] ?? this.parts[0];
    return { off: p.off, src: this.text.slice(p.off, p.off + p.len), index: para ? [...para.querySelectorAll(EMBEDS)].indexOf(el) : 0 };
  }
  /** A click between images edits the nearest one. */
  caretAt(e: MouseEvent, dom: HTMLElement) {
    const near = [...dom.querySelectorAll<HTMLElement>(".media")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        const d = Math.hypot(Math.max(r.left - e.clientX, 0, e.clientX - r.right), Math.max(r.top - e.clientY, 0, e.clientY - r.bottom));
        return { el, d };
      })
      .sort((a, b) => a.d - b.d)[0];
    if (!near) return { caret: 0, y: e.clientY };
    const { off, src, index } = this.embedOf(dom, near.el);
    const r = near.el.getBoundingClientRect();
    return { caret: off + (embedAt(src, index) ?? 0), y: (r.top + r.bottom) / 2 };
  }
  get estimatedHeight() {
    return Math.ceil(this.parts.length / 4) * 100 + 16;
  }
}

/** An embed inside a line of text. */
class InlineWidget extends Base {
  readonly kind = "inline";
  props(): BlockProps {
    return { kind: "inline", sources: [this.text] };
  }
  caretAt(e: MouseEvent) {
    return { caret: 0, y: e.clientY };
  }
}

// ---- interaction -------------------------------------------------------------------------

/** Where a point in rendered `el` falls in its markdown `raw`: its ends exactly, best effort in between. */
function pointOffset(el: Node, raw: string, node: Node, off: number): number {
  const r = document.createRange();
  r.setStart(el, 0);
  r.setEnd(node, off);
  const before = r.toString();
  r.setStart(node, off);
  r.setEnd(el, el.childNodes.length);
  const after = r.toString();
  if (!before.trim()) return 0;
  if (!after.trim()) return raw.length;
  return rawOffset(raw, before, after, raw.length);
}

/** Best effort: the offset in `raw` near the clicked rendered text, and the middle of the line clicked. */
function caretFromClick(e: MouseEvent, el: Element, raw: string): { caret: number; y: number } {
  const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
  const node = range?.startContainer;
  if (!range || !node || node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return { caret: raw.length, y: e.clientY };
  const line = range.getClientRects()[0];
  return { caret: pointOffset(el, raw, node, range.startOffset), y: line?.height ? line.top + line.height / 2 : e.clientY };
}

/** Where the last press in a widget went down. */
let press: { dom: HTMLElement; x: number; y: number } | null = null;

/** A click ending a drag (a text selection inside the widget) keeps it rather than editing. */
function dragged(e: MouseEvent, dom: HTMLElement): boolean {
  return !press || press.dom !== dom || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4;
}

/** Reveal the widget's source with the caret near the click, the clicked line staying under the pointer. */
function edit(e: MouseEvent, view: EditorView, dom: HTMLElement) {
  const m = mounted.get(dom);
  if (!m || dragged(e, dom)) return;
  const r = m.widget.range(view, dom);
  if (!r) return;
  const { caret, y } = m.widget.caretAt(e, dom);
  placeCaret(view, Math.min(r.to, r.from + caret), y);
}

function onClick(e: MouseEvent, view: EditorView, dom: HTMLElement) {
  const m = mounted.get(dom);
  const target = e.target as HTMLElement;
  if (!m || e.button !== 0 || m.widget.kind === "conflict" || dragged(e, dom)) return;
  const img = target instanceof HTMLImageElement && target.closest(".media") ? target : null;
  if (img && !e.altKey) return void view.state.facet(hostFacet)?.viewImage(img);
  // Links are handled by <Markdown>; players and handles keep their own clicks.
  if (target.closest("a, .resize, video, audio, button, input, select")) return;
  if (img) {
    // ⌥-click on an image edits it: the caret goes to its markdown.
    const r = m.widget.range(view, dom);
    const wrap = img.closest(".media")!;
    const { off, src, index } = m.widget.embedOf(dom, wrap);
    if (r) placeCaret(view, r.from + off + (embedAt(src, index) ?? 0), e.clientY);
    return;
  }
  edit(e, view, dom);
}

/** A gallery sizes each image by its shape, known once it loads; the editor measures what loaded. */
function onLoad(e: Event, view: EditorView) {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.closest(".gallery") && img.naturalHeight)
    img.parentElement?.style.setProperty("--r", String(img.naturalWidth / img.naturalHeight));
  view.requestMeasure();
}

let lastHandleDown = 0;

/** Dragging an embed's corner handle resizes it live; the size lands in the source on release. */
function onPointerDown(e: PointerEvent, view: EditorView, dom: HTMLElement) {
  const handle = (e.target as HTMLElement).closest<HTMLElement>(".resize");
  const wrap = handle?.parentElement;
  const media = wrap?.querySelector<HTMLElement>("img, video");
  const m = mounted.get(dom);
  if (!handle || !wrap || !media || !m || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const gallery = wrap.closest<HTMLElement>(".gallery");
  // Read at release: the doc may have moved, and the widget been replaced, meanwhile.
  const write = (edit: (src: string, index: number) => string) => {
    const w = mounted.get(dom)?.widget;
    const r = w?.range(view, dom);
    if (!w || !r) return;
    const { off, src, index } = gallery ? { ...w.embedOf(dom, gallery.querySelector(".media")!), index: 0 } : w.embedOf(dom, wrap);
    if (index < 0) return;
    const next = edit(src, index);
    if (next !== src) replaceRange(view, r.from + off, r.from + off + src.length, next, "resizeMedia");
  };
  // A second press on the handle resets: the first one's pointer capture keeps `dblclick` from coming.
  const now = performance.now();
  if (now - lastHandleDown < 400) {
    lastHandleDown = 0;
    return write((src, index) => (gallery ? setMediaHeight(src, index, null) : setMediaWidth(src, index, null)));
  }
  lastHandleDown = now;
  const x0 = e.clientX;
  const y0 = e.clientY;
  const box = media.getBoundingClientRect();
  const first = gallery ? (m.widget as GalleryWidget).sources[0] : "";
  const start = gallery ? (galleryHeight(first) ?? GALLERY_ROW) : box.width;
  const max = wrap.closest<HTMLElement>(".md")?.clientWidth || view.contentDOM.clientWidth;
  let size = start;
  handle.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    if (gallery) {
      // Rows grow past their base height to fill the width, so the drag scales by what's on screen.
      size = Math.round(Math.max(40, Math.min(400, (start * (box.height + ev.clientY - y0)) / box.height)));
      gallery.style.setProperty("--gallery-row", `${size}px`);
    } else {
      size = Math.round(Math.max(32, Math.min(max, start + ev.clientX - x0)));
      media.style.width = `${size}px`;
    }
  };
  const end = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    if (size === Math.round(start)) return;
    write((src, index) => (gallery ? setMediaHeight(src, index, size) : setMediaWidth(src, index, size)));
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

// ---- embeds in text ----------------------------------------------------------------------

const SKIP = new Set(["FencedCode", "CodeBlock", "Table", "HTMLBlock", "CommentBlock"]);

function inlineEmbeds(view: EditorView): DecorationSet {
  const { state } = view;
  const { items } = state.field(blocksField);
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n) => {
        if (SKIP.has(n.name)) return false;
        if (n.name === "Paragraph" || n.name === "Image") {
          const it = itemAt(items, n.from);
          if (it && n.to <= it.to) return false;
        }
        if (n.name !== "Image") return;
        if (!revealed(state, n.from, n.to))
          out.push(Decoration.replace({ widget: new InlineWidget(state.doc.sliceString(n.from, n.to)) }).range(n.from, n.to));
        return false;
      },
    });
  }
  return Decoration.set(out, true);
}

const inlinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = inlineEmbeds(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.startState.field(blocksField) !== u.state.field(blocksField) ||
        u.startState.field(focusedField, false) !== u.state.field(focusedField, false)
      )
        this.decorations = inlineEmbeds(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.baseTheme({
  /* Rendered HTML, not text: no pre-wrapped whitespace, and its own width never widens the editor. */
  ".cm-lb": { whiteSpace: "normal", contain: "inline-size" },
  ".cm-lb-inline": { whiteSpace: "normal" },
  /* Revealed code reads as code, in a box like the rendered one, so the switch is calm. */
  ".cm-line.cm-lb-code": {
    fontFamily: "var(--mono)",
    fontSize: "var(--fs-sm)",
    lineHeight: "1.56",
    background: "var(--code-bg)",
    borderInline: "1px solid var(--border)",
    paddingInline: "var(--sp-4)",
  },
  ".cm-line.cm-lb-first": {
    borderTop: "1px solid var(--border)",
    borderTopLeftRadius: "var(--radius)",
    borderTopRightRadius: "var(--radius)",
    paddingTop: "var(--sp-2)",
  },
  ".cm-line.cm-lb-last": {
    borderBottom: "1px solid var(--border)",
    borderBottomLeftRadius: "var(--radius)",
    borderBottomRightRadius: "var(--radius)",
    paddingBottom: "var(--sp-2)",
  },
  ".cm-line.cm-lb-mono": { fontFamily: "var(--mono)", fontSize: "var(--fs-sm)" },
  ".cm-line.cm-lb-comment": { color: "var(--faint)" },
  ".cm-line.cm-lb-marker": { fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--warn)" },
});

/** ↑/↓ would hop over a block: they land on its edge instead, which reveals it. */
function vertical(view: EditorView, down: boolean): boolean {
  const { decos } = view.state.field(blocksField);
  let moved = false;
  const sel = EditorSelection.create(
    view.state.selection.ranges.map((range) => {
      const next = view.moveVertically(range, down);
      const line = view.state.doc.lineAt(range.head);
      let edge: number | null = null;
      const [from, to] = down ? [line.to + 1, next.head] : [next.head, line.from - 1];
      if (from <= to)
        decos.between(from, to, (a, b, deco) => {
          if (!deco.spec.block) return;
          if (down && a >= from && edge === null) edge = a;
          if (!down && b <= to) edge = b;
        });
      if (edge === null) {
        // Nor over a short line (a blank one between paragraphs): one doc line at a time.
        const doc = view.state.doc;
        const n = line.number + (down ? 1 : -1);
        const target = doc.lineAt(next.head).number;
        if (down ? target <= n : target >= n) return next;
        const l = doc.line(n);
        edge = l.from + Math.min(l.length, range.head - line.from);
      }
      moved = true;
      return EditorSelection.cursor(edge);
    }),
    view.state.selection.mainIndex,
  );
  if (!moved) return false;
  view.dispatch({ selection: sel, scrollIntoView: true, userEvent: "select" });
  return true;
}

/** Code, tables, HTML, conflict regions, media and galleries render as blocks, and show their source when the selection enters them. */
export function liveBlocks(host: BlockHost): Extension {
  return [
    hostFacet.of(host),
    blocksField,
    inlinePlugin,
    theme,
    Prec.high(
      keymap.of([
        { key: "ArrowDown", run: (v) => vertical(v, true) },
        { key: "ArrowUp", run: (v) => vertical(v, false) },
      ]),
    ),
  ];
}
