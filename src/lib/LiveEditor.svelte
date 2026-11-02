<script lang="ts">
  import { tick, untrack } from "svelte";
  import { store } from "./store.svelte";
  import type { Note } from "./types";
  import Markdown from "./Markdown.svelte";
  import ConflictBlock from "./ConflictBlock.svelte";
  import MentionPopup from "./MentionPopup.svelte";
  import { isMobile } from "./backend";
  import IssuePopup from "./IssuePopup.svelte";
  import IconPopup from "./IconPopup.svelte";
  import { pickIcon } from "./icons.svelte";
  import { typedIcon } from "./inlineIcons";
  import MediaActions from "./MediaActions.svelte";
  import { copyImage } from "./images";
  import type { IssueRef } from "./github";
  import { copyText, Lightbox, matches, menu, type LightboxItem } from "purr";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { previews } from "./previews.svelte";
  import { fileTargets } from "./fileTargets.svelte";
  import {
    continueList,
    embedToLink,
    indent,
    link,
    linkToEmbed,
    pasteLink,
    rawOffset,
    setMediaHeight,
    setMediaWidth,
    toggleWrap,
    type Sel,
  } from "./editor";
  import { caretCoords } from "./wikilinks";
  import { t, type HistoryLabel } from "./i18n";
  import { keys } from "./keys";
  import {
    splitBlocks,
    joinBlocks,
    locate,
    toggleCheckbox,
    isCode,
    isConflict,
    resolveConflict,
    insertBlocks,
    sliceBlocks,
    spliceBlocks,
    type BlockSpan,
  } from "./blocks";
  import { fileExt, galleryHeight, galleryRuns, kindOf, type MediaDrop } from "./media";

  /** Live preview: blocks are rendered, and the one holding the caret becomes a textarea. */
  let { note, oncreatelink }: { note: Note; oncreatelink: (title: string) => void } = $props();

  let container = $state<HTMLDivElement | null>(null);
  let textarea = $state<HTMLTextAreaElement | null>(null);
  let mentionPopup = $state<MentionPopup | null>(null);
  let issuePopup = $state<IssuePopup | null>(null);
  let iconPopup = $state<IconPopup | null>(null);
  /** Active `:name` icon autocomplete. */
  let iconTyped = $state<{ start: number; query: string; left: number; top: number } | null>(null);
  /** Active `alias#query` GitHub picker. */
  let issue = $state<{ start: number; alias: string; repo: string; query: string; left: number; top: number } | null>(null);

  // A note being shown checks its file links again.
  fileTargets.recheck();

  const blocks = $derived(splitBlocks(note.body));
  /** A gallery row's base height, unless its first image sets one. */
  const GALLERY_ROW = 90;
  /** A gallery's row height while its handle is dragged, by the gallery's first block. */
  let rowDrag = $state<{ first: number; height: number } | null>(null);
  /** Index of the block being edited, or null when everything is rendered. */
  let active = $state<number | null>(null);
  /** The edited block is blank, so it's out of the body: a slot before block `active`. */
  let detached = $state(false);
  /** Images next to each other lay out as one gallery; the block being edited breaks it. */
  const runs = $derived(galleryRuns(blocks, active));
  /** Raw text of the active block while it's being edited. */
  let draft = $state("");
  let mention = $state<{ start: number; query: string; left: number; top: number } | null>(null);
  /** Caret to apply once the textarea mounts. */
  let pendingCaret: number | null = null;

  const activeIsCode = $derived(isCode(draft));
  // Safari's smart punctuation turns markdown into curly quotes and en-dashes; a phone keyboard needs it for prose.
  const prose = $derived(!activeIsCode);
  const autocorrect = $derived(isMobile && prose);

  /** Map a keydown to a command, or null. */
  function command(e: KeyboardEvent, s: Sel): Sel | null {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Enter" && !mod && !e.shiftKey) return continueList(s);
    if (e.key === "Tab") return indent(s, e.shiftKey);
    if (!mod) return null;
    if (matches(keys.bold, e)) return toggleWrap(s, "**");
    if (matches(keys.italic, e)) return toggleWrap(s, "*");
    if (matches(keys.code, e) || matches(keys["code-alt"], e)) return toggleWrap(s, "`");
    if (matches(keys.link, e)) return link(s);
    if (matches(keys.strike, e)) return toggleWrap(s, "~~");
    if (matches(keys.highlight, e)) return toggleWrap(s, "==");
    return null;
  }

  function edited(label?: HistoryLabel) {
    store.touch(note.id, { label });
  }

  function setBody(body: string, label?: HistoryLabel) {
    if (body !== note.body) {
      note.body = body;
      edited(label);
    }
  }

  /** Replace conflict block `i` by the chosen side(s); undoable as one step. */
  function resolve(i: number, keep: "mine" | "theirs" | "both") {
    const next = [...blocks];
    next[i] = resolveConflict(blocks[i], keep);
    setBody(joinBlocks(next), "resolveConflict");
  }

  /** Blocks with the active slot replaced by the draft (empty drafts drop out). */
  function withDraft(): string[] {
    const next = [...blocks];
    if (active !== null) next.splice(active, detached ? 0 : 1, draft);
    return next;
  }

  /** Write the draft into the body. Returns the resulting block list. */
  function commit(): string[] {
    if (active === null) return blocks;
    const body = joinBlocks(withDraft());
    setBody(body);
    return splitBlocks(body);
  }

  /** Start editing block `index` (of the current body) with the caret at `caret`, its line at `y` when clicked there. */
  async function activate(index: number, caret: number | "end" = "end", y?: number) {
    const list = commit();
    active = null;
    detached = false;
    if (!list.length) return appendBlock();
    const i = Math.max(0, Math.min(index, list.length - 1));
    draft = list[i];
    active = i;
    pendingCaret = caret === "end" ? draft.length : Math.min(caret, draft.length);
    await tick();
    focusCaret(y);
  }

  function focusCaret(y?: number) {
    const el = textarea;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (pendingCaret !== null) {
      el.setSelectionRange(pendingCaret, pendingCaret);
      pendingCaret = null;
    }
    autosize();
    if (y === undefined) revealCaret(true);
    else holdAt(y);
  }

  /** Scrolls so the caret's line sits at `y`: the line clicked stays under the pointer as it turns into source. */
  function holdAt(y: number) {
    const el = textarea;
    if (!el || !container) return;
    const c = caretCoords(el, el.selectionEnd);
    container.scrollTop += el.getBoundingClientRect().top + c.top + c.height / 2 - y;
  }

  // Another window changed the body under an active block: reload the draft, keeping the caret.
  $effect(() => {
    const body = note.body;
    if (active === null) return;
    untrack(() => {
      if (joinBlocks(withDraft()) === body) return;
      const list = splitBlocks(body);
      if (detached) return void (active = Math.min(active!, list.length));
      if (active! >= list.length) {
        active = list.length;
        detached = true;
        draft = "";
        return;
      }
      const el = textarea;
      const focused = el && document.activeElement === el;
      const caret = el?.selectionStart ?? 0;
      draft = list[active!];
      tick().then(() => {
        autosize();
        if (focused) el.setSelectionRange(Math.min(caret, draft.length), Math.min(caret, draft.length));
      });
    });
  });

  /** Leaves edit mode keeping the caret's place in the block where it was on screen, in proportion as it renders. */
  async function leave() {
    const el = textarea;
    const at = active;
    if (!el || !container || at === null || detached) return deactivate();
    const r = el.getBoundingClientRect();
    const c = caretCoords(el, el.selectionEnd);
    const y = r.top + c.top + c.height / 2;
    const f = r.height ? (c.top + c.height / 2) / r.height : 0;
    deactivate();
    await tick();
    const b = container.querySelector(`[data-block="${at}"]`)?.getBoundingClientRect();
    if (b) container.scrollTop += b.top + f * b.height - y;
  }

  function deactivate() {
    if (active === null) return;
    commit();
    active = null;
    detached = false;
    draft = "";
    mention = null;
    issue = null;
    iconTyped = null;
  }

  function autosize() {
    const el = textarea;
    if (!el) return;
    // Collapsing it first would pull the editor's scroll back when it's near the bottom.
    const top = container?.scrollTop ?? 0;
    el.style.height = "0";
    el.style.height = `${el.scrollHeight}px`;
    if (container) container.scrollTop = top;
  }

  /** Keeps the caret in view: on a phone as typing goes (the keyboard shrinks the editor), else when a block is entered. */
  function revealCaret(entering = false) {
    const el = textarea;
    if ((!isMobile && !entering) || !el || !container || document.activeElement !== el) return;
    const c = caretCoords(el, el.selectionEnd);
    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop + c.top;
    const pad = 12;
    if (top - pad < container.scrollTop) container.scrollTop = top - pad;
    else if (top + c.height + pad > container.scrollTop + container.clientHeight)
      container.scrollTop = top + c.height + pad - container.clientHeight;
  }
  $effect(() => {
    if (!isMobile || !container) return;
    const ro = new ResizeObserver(() => revealCaret());
    ro.observe(container);
    return () => ro.disconnect();
  });

  /** Start a fresh paragraph before block `at` (out of the body until it has text). */
  async function openSlot(at: number) {
    const list = commit();
    active = null;
    draft = "";
    active = Math.min(at, list.length);
    detached = true;
    pendingCaret = 0;
    await tick();
    focusCaret();
  }

  const appendBlock = () => openSlot(Infinity);

  /** Move editing to a neighbouring block; a detached slot sits right before block `active`. */
  function moveBy(delta: -1 | 1) {
    if (active === null) return;
    activate(delta < 0 ? active - 1 : detached ? active : active + 1, delta < 0 ? "end" : 0);
  }

  // ---- rendered block interactions -----------------------------------------

  /** Best-effort: the caret in the raw text near the clicked rendered text, and the middle of the line clicked. */
  function caretFromClick(e: MouseEvent, raw: string): { caret: number; y: number } {
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    const node = range?.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return { caret: raw.length, y: e.clientY };
    const off = range!.startOffset;
    const line = range!.getClientRects()[0];
    // Against the whole block's text: a node's own text would find the first of repeated words (list items alike).
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-block]");
    const text = node.textContent ?? "";
    return {
      caret: el ? pointOffset(el, raw, node, off) : rawOffset(raw, text.slice(0, off), text.slice(off), raw.length),
      y: line?.height ? line.top + line.height / 2 : e.clientY,
    };
  }

  /** A click that ends a drag-selection keeps it rather than editing. */
  const selecting = () => !!container && !getSelection()?.isCollapsed && container.contains(getSelection()?.anchorNode ?? null);

  /** Where a point in rendered block `el` falls in its markdown: its ends exactly, best effort in between. */
  function pointOffset(el: HTMLElement, raw: string, node: Node, off: number): number {
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

  /** The page's text selection over rendered blocks, in markdown offsets; null when there's none. */
  function selectedSpan(): BlockSpan | null {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !container) return null;
    if ((document.activeElement as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return null;
    const range = sel.getRangeAt(0);
    const els = [...container.querySelectorAll<HTMLElement>("[data-block]")].filter((el) => range.intersectsNode(el));
    if (!els.length) return null;
    const first = els[0];
    const last = els[els.length - 1];
    const s = Number(first.dataset.block);
    const e = Number(last.dataset.block);
    const start = first.contains(range.startContainer) ? pointOffset(first, blocks[s], range.startContainer, range.startOffset) : 0;
    const end = last.contains(range.endContainer) ? pointOffset(last, blocks[e], range.endContainer, range.endOffset) : blocks[e].length;
    return s === e && end <= start ? null : { s, start, e, end };
  }

  /** Copying rendered blocks copies their markdown; cutting also removes it. */
  function onCopy(e: ClipboardEvent) {
    const span = selectedSpan();
    if (!span || !e.clipboardData) return;
    e.preventDefault();
    const html = document.createElement("div");
    html.append(getSelection()!.getRangeAt(0).cloneContents());
    e.clipboardData.setData("text/plain", sliceBlocks(blocks, span));
    e.clipboardData.setData("text/html", html.innerHTML);
    if (e.type === "cut") replaceSpan(span, "");
  }

  /** Typing, ⌫ or ⌦ over selected rendered text replaces it, like in a text field. */
  function onSelectionKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.isComposing) return;
    const text = e.key.length === 1 ? e.key : e.key === "Backspace" || e.key === "Delete" ? "" : null;
    const span = text === null ? null : selectedSpan();
    if (!span) return;
    // First, so the note panel's ⌫ (delete the note) and the canvas's keys don't see it.
    e.preventDefault();
    e.stopPropagation();
    replaceSpan(span, text!);
  }

  function replaceSpan(span: BlockSpan, text: string) {
    deactivate();
    getSelection()?.removeAllRanges();
    const next = spliceBlocks(blocks, span, text);
    setBody(joinBlocks(next));
    if (next[span.s].trim()) activate(span.s, span.start + text.length);
    else openSlot(span.s);
  }

  $effect(() => {
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    window.addEventListener("keydown", onSelectionKey, true);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      window.removeEventListener("keydown", onSelectionKey, true);
    };
  });

  /** The note's images, open in the viewer at `index`; `names` are their files in `assets/`. */
  let viewer = $state<{ items: LightboxItem[]; names: (string | null)[]; index: number } | null>(null);

  /** A click on an image shows it full screen, with the note's other images a step away; ⌥ edits it instead. */
  function viewImage(e: MouseEvent): boolean {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.closest(".media") || e.altKey || !container) return false;
    const all = [...container.querySelectorAll<HTMLImageElement>(".media img")];
    viewer = {
      items: all.map((el) => ({ src: el.currentSrc || el.src, kind: "image", alt: el.alt })),
      names: all.map((el) => el.dataset.asset ?? null),
      index: all.indexOf(img),
    };
    return true;
  }

  function onBlockClick(e: MouseEvent, i: number) {
    const target = e.target as HTMLElement;
    if (viewImage(e)) return;
    // Links are handled by <Markdown>; players keep their own clicks.
    if (target.closest("a, .resize, video, audio")) return;
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      e.preventDefault();
      const boxes = [...(target.closest(".block")?.querySelectorAll('input[type="checkbox"]') ?? [])];
      const next = [...blocks];
      next[i] = toggleCheckbox(blocks[i], boxes.indexOf(target));
      setBody(joinBlocks(next), "check");
      return;
    }
    if (selecting()) return;
    const { caret, y } = caretFromClick(e, blocks[i]);
    activate(i, caret, y);
  }

  /** The block's `index`-th embed, rewritten to `width` (null = natural size). */
  function resizeMedia(i: number, index: number, width: number | null) {
    const next = [...blocks];
    next[i] = setMediaWidth(blocks[i], index, width);
    setBody(joinBlocks(next), "resizeMedia");
  }

  /** Right-click on a picture: save, copy, reveal. A phone's long press gets the system's menu instead. */
  function onImageMenu(e: MouseEvent): boolean {
    const img = e.target;
    if (isMobile || !(img instanceof HTMLImageElement) || !img.closest(".media")) return false;
    const src = img.currentSrc || img.src;
    const name = img.dataset.asset;
    menu.show(e, [
      ...(name ? [{ label: t("media.save"), run: () => store.exportAsset(name) }] : []),
      { label: t("media.copy"), run: () => void copyImage(src) },
      ...(name ? ["separator" as const, { label: t("panel.reveal"), run: () => store.revealAsset(name) }] : []),
    ]);
    return true;
  }

  /** Right-click on a web link or a preview card: open, copy, or switch between the two. */
  function onLinkMenu(e: MouseEvent) {
    if (onImageMenu(e)) return;
    const file = (e.target as HTMLElement).closest<HTMLElement>("a.filelink[data-path]")?.dataset.path;
    if (file) return fileMenu(e, file);
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    const el = a?.closest<HTMLElement>("[data-block]");
    const url = a?.getAttribute("href");
    if (!a || !el || !url || !/^https?:/.test(url)) return;
    const i = Number(el.dataset.block);
    const card = a.classList.contains("link-card");
    const same = [...el.querySelectorAll("a[href]")].filter(
      (x) => x.getAttribute("href") === url && x.classList.contains("link-card") === card,
    );
    const n = same.indexOf(a);
    const swap = () => {
      const next = [...blocks];
      next[i] = card ? embedToLink(blocks[i], url, previews.get(url)?.title ?? null, n) : linkToEmbed(blocks[i], url, n);
      setBody(joinBlocks(next), card ? "unpreview" : "preview");
    };
    menu.show(e, [
      { label: t("link.open"), run: () => void openUrl(url).catch(console.error) },
      { label: t("link.copy"), run: () => void copyText(url) },
      "separator",
      { label: t(card ? "link.asLink" : "link.asPreview"), run: swap },
    ]);
  }

  /** Right-click on a file link: open it, show it in Finder, or copy its full path. */
  function fileMenu(e: MouseEvent, raw: string) {
    const path = fileTargets.get(raw)?.path ?? raw;
    menu.show(e, [
      { label: t("filelink.open"), run: () => void fileTargets.open(raw) },
      !isMobile && { label: t("filelink.reveal"), run: () => void fileTargets.reveal(raw) },
      { label: t("filelink.copy"), run: () => void copyText(path) },
    ]);
  }

  /** A gallery sizes each image by its shape, known once it loads. */
  function onImageLoad(e: Event) {
    const img = e.target as HTMLElement;
    if (!(img instanceof HTMLImageElement) || !img.closest(".gallery") || !img.naturalHeight) return;
    img.parentElement?.style.setProperty("--r", String(img.naturalWidth / img.naturalHeight));
  }

  let lastHandleDown = 0;

  /** Dragging an embed's corner handle resizes it live; the width lands in the source on release. */
  function onResizeStart(e: PointerEvent, i: number) {
    const handle = (e.target as HTMLElement).closest<HTMLElement>(".resize");
    const wrap = handle?.parentElement;
    const media = wrap?.querySelector<HTMLElement>("img, video");
    const block = e.currentTarget as HTMLElement;
    if (!handle || !wrap || !media || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // A second press on the handle resets: the first one's pointer capture keeps `dblclick` from coming.
    const now = performance.now();
    if (now - lastHandleDown < 400) {
      lastHandleDown = 0;
      return resetSize(i, block, wrap);
    }
    lastHandleDown = now;
    const gallery = wrap.closest<HTMLElement>(".gallery");
    if (gallery) return resizeGallery(e, handle, gallery, media);
    const index = [...block.querySelectorAll(".media")].indexOf(wrap);
    const max = block.querySelector(".md")?.clientWidth ?? Infinity;
    const start = media.getBoundingClientRect().width;
    const x0 = e.clientX;
    let width = start;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      width = Math.round(Math.max(32, Math.min(max, start + ev.clientX - x0)));
      media.style.width = `${width}px`;
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (width !== Math.round(start)) resizeMedia(i, index, width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  /** In a gallery the handle sets the row height for all of it, kept on its first image as `|x…`. */
  function resizeGallery(e: PointerEvent, handle: HTMLElement, gallery: HTMLElement, media: HTMLElement) {
    const first = Number(gallery.querySelector<HTMLElement>("[data-block]")?.dataset.block);
    const start = galleryHeight(blocks[first]) ?? GALLERY_ROW;
    const seen = media.getBoundingClientRect().height;
    const y0 = e.clientY;
    let height = start;
    handle.setPointerCapture(e.pointerId);
    // Rows grow past their base height to fill the width, so the drag scales by what's on screen.
    const move = (ev: PointerEvent) => {
      height = Math.round(Math.max(40, Math.min(400, (start * (seen + ev.clientY - y0)) / seen)));
      rowDrag = { first, height };
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      rowDrag = null;
      if (height === start) return;
      const next = [...blocks];
      next[first] = setMediaHeight(blocks[first], 0, height);
      setBody(joinBlocks(next), "resizeMedia");
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  /** Back to the natural size (a gallery's default row height). */
  function resetSize(i: number, block: HTMLElement, wrap: HTMLElement) {
    const gallery = wrap.closest<HTMLElement>(".gallery");
    if (gallery) {
      const first = Number(gallery.querySelector<HTMLElement>("[data-block]")?.dataset.block);
      const next = [...blocks];
      next[first] = setMediaHeight(blocks[first], 0, null);
      return setBody(joinBlocks(next), "resizeMedia");
    }
    resizeMedia(i, [...block.querySelectorAll(".media")].indexOf(wrap), null);
  }

  /** A click between a gallery's images edits the nearest one. */
  function onGalleryClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest("[data-block]") || selecting() || viewImage(e)) return;
    const near = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(".media")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          el,
          d: Math.hypot(Math.max(r.left - e.clientX, 0, e.clientX - r.right), Math.max(r.top - e.clientY, 0, e.clientY - r.bottom)),
        };
      })
      .sort((a, b) => a.d - b.d)[0];
    const i = near?.el.closest<HTMLElement>("[data-block]")?.dataset.block;
    if (i !== undefined) activate(Number(i), 0);
  }

  function onContainerClick(e: MouseEvent) {
    if (e.target === container && !selecting()) appendBlock();
  }

  // ---- textarea ------------------------------------------------------------

  async function onInput() {
    const el = textarea!;
    draft = el.value;
    autosize();
    revealCaret();
    const caret = el.selectionStart;
    const next = withDraft();
    const body = joinBlocks(next);
    // A blank line splits the draft, an indent or a list marker joins it to a list next to it: follow the caret.
    const parts = splitBlocks(draft);
    const list = splitBlocks(body);
    if (parts.length && (list.length !== next.length || list[active!] !== parts[0])) {
      const before = joinBlocks(next.slice(0, active!));
      const { index, offset } = locate(body, (before ? before.length + 2 : 0) + caret);
      const c = caretCoords(el, caret);
      activate(index, offset, el.getBoundingClientRect().top + c.top + c.height / 2);
      return;
    }
    // Sync as we type so cards, search and the empty-note check see it; a blank draft leaves the body.
    detached = draft.trim() === "";
    setBody(body);
    await tick();
    // The textarea is re-mounted when the block joins or leaves the body.
    if (textarea !== el) {
      pendingCaret = caret;
      focusCaret();
    }
    updateMention();
  }

  /** Pasting a URL over selected text turns the selection into a link; pasted media become assets. */
  function onPaste(e: ClipboardEvent) {
    const el = e.target as HTMLTextAreaElement;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => kindOf(fileExt(f)));
    if (files.length) {
      e.preventDefault();
      void pasteMedia(files);
      return;
    }
    const pasted = e.clipboardData?.getData("text/plain") ?? "";
    const next = pasteLink({ text: el.value, start: el.selectionStart, end: el.selectionEnd }, pasted);
    if (!next) return;
    e.preventDefault();
    apply(el, next);
  }

  async function pasteMedia(files: File[]) {
    const embeds = await store.addMedia(files, false);
    if (embeds.length) placeAtCaret(embeds);
  }

  /** `embeds` as blocks of their own at the caret, typing going on after them; appended when not editing. */
  function placeAtCaret(embeds: string[]) {
    const editing = active !== null;
    const sel = editing && textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd } : null;
    const r = insertBlocks(withDraft(), active ?? blocks.length, sel, embeds);
    active = null;
    detached = false;
    draft = "";
    setBody(joinBlocks(r.blocks), "media");
    if (!editing) return;
    if (r.after < r.blocks.length) activate(r.after, 0);
    else appendBlock();
  }

  /** Files dropped on the editor go before the block under the pointer, or after it past its middle. */
  async function onMediaDrop(e: Event) {
    const { items = [], embeds: given, y } = (e as CustomEvent<MediaDrop>).detail;
    e.stopPropagation();
    const embeds = given ?? (await store.addMedia(items));
    if (!embeds.length || !container) return;
    deactivate();
    const before = [...container.querySelectorAll<HTMLElement>("[data-block]")].find((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    const r = before
      ? insertBlocks(blocks, Number(before.dataset.block), { start: 0, end: 0 }, embeds)
      : insertBlocks(blocks, blocks.length, null, embeds);
    setBody(joinBlocks(r.blocks), "media");
  }
  $effect(() => {
    const el = container;
    if (!el) return;
    el.addEventListener("media-drop", onMediaDrop);
    return () => el.removeEventListener("media-drop", onMediaDrop);
  });

  /** "Insert media…" for this note: at the caret, or at the end. */
  function onInsertMedia(e: Event) {
    const { id, embeds } = (e as CustomEvent<{ id: string; embeds: string[] }>).detail;
    if (id !== note.id) return;
    e.preventDefault();
    placeAtCaret(embeds);
  }
  $effect(() => {
    window.addEventListener("insert-media", onInsertMedia);
    return () => window.removeEventListener("insert-media", onInsertMedia);
  });

  /** Put an edit's text and selection into the textarea as if it had been typed. */
  function apply(el: HTMLTextAreaElement, next: { text: string; start: number; end: number }) {
    el.value = next.text;
    el.setSelectionRange(next.start, next.end);
    onInput().then(() => textarea?.setSelectionRange(next.start, next.end));
  }

  function lineOf(text: string, pos: number) {
    return { first: text.lastIndexOf("\n", pos - 1) === -1, last: text.indexOf("\n", pos) === -1 };
  }

  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLTextAreaElement;
    // At most one popup is open; it takes the keys it knows, and Escape closes it.
    if (mention || issue || iconTyped) {
      if (e.key === "Escape") {
        e.preventDefault();
        mention = issue = iconTyped = null;
        return;
      }
      if ((mention ? mentionPopup : issue ? issuePopup : iconPopup)?.handleKey(e)) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      void leave();
      return;
    }
    const { first, last } = lineOf(el.value, el.selectionStart);
    if (e.key === "ArrowUp" && first && active! > 0) {
      e.preventDefault();
      moveBy(-1);
      return;
    }
    if (e.key === "ArrowDown" && last && active! + (detached ? 0 : 1) < blocks.length) {
      e.preventDefault();
      moveBy(1);
      return;
    }
    if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0 && active! > 0) {
      // Merge this block into the previous one.
      e.preventDefault();
      const prevIdx = active! - 1;
      const prev = blocks[prevIdx];
      const merged = draft.trim() ? prev + "\n" + draft : prev;
      const next = [...blocks];
      next.splice(prevIdx, detached ? 1 : 2, merged);
      active = null;
      detached = false;
      setBody(joinBlocks(next));
      activate(prevIdx, prev.length);
      return;
    }
    const next = command(e, { text: el.value, start: el.selectionStart, end: el.selectionEnd });
    if (next) {
      e.preventDefault();
      apply(el, next);
    }
  }

  // ---- @ mentions ----------------------------------------------------------

  const MENTION_RE = /(^|[\s(])@([^\s@[\]]*)$/;
  /** `alias#query` right before the caret (alias must be a configured repo). */
  const ISSUE_RE = /(^|[\s(])([\w.-]+)#([^\s#]*)$/;

  function updateMention() {
    const el = textarea;
    if (!el || el.selectionStart !== el.selectionEnd) return void (mention = issue = iconTyped = null);
    const caret = el.selectionStart;
    const before = el.value.slice(Math.max(0, caret - 80), caret);
    const m = MENTION_RE.exec(before);
    if (m) {
      issue = null;
      const start = caret - m[2].length - 1;
      mention = { start, query: m[2], ...below(el, start) };
      return;
    }
    mention = null;
    const ic = activeIsCode ? null : typedIcon(before);
    if (ic) {
      issue = null;
      const start = caret - before.length + ic.start;
      const at = below(el, start);
      iconTyped = { start, query: ic.query, ...at, left: Math.max(0, Math.min(at.left, (container?.clientWidth ?? 0) - 240)) };
      return;
    }
    iconTyped = null;
    // An open picker stays anchored (so the query may hold spaces) until the caret leaves it.
    if (issue) {
      const from = issue.start + issue.alias.length + 1;
      const typed = el.value.slice(from, caret);
      if (caret >= from && el.value.slice(issue.start, from) === `${issue.alias}#` && !typed.includes("\n") && !/\s{2}$/.test(typed)) {
        issue.query = typed;
        return;
      }
      issue = null;
    }
    const g = ISSUE_RE.exec(before);
    const repo = g && store.repos[g[2]];
    if (!g || !repo) return void (issue = null);
    const start = caret - g[3].length - g[2].length - 1;
    issue = { start, alias: g[2], repo, query: g[3], ...below(el, start) };
  }

  /** Where a popup goes under offset `at` of the textarea, in the scrolled editor's coordinates. */
  function below(el: HTMLTextAreaElement, at: number): { left: number; top: number } {
    const c = caretCoords(el, at);
    const r = el.getBoundingClientRect();
    const box = container?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const scroll = container?.scrollTop ?? 0;
    return { left: r.left - box.left + c.left, top: r.top - box.top + scroll + c.top + c.height + 4 };
  }

  /** Replace what was typed from `start` up to the caret by `insert`. */
  function replaceTyped(start: number, insert: string) {
    const el = textarea;
    if (!el) return;
    el.value = el.value.slice(0, start) + insert + el.value.slice(el.selectionStart);
    const pos = start + insert.length;
    mention = issue = iconTyped = null;
    el.setSelectionRange(pos, pos);
    onInput();
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  /** Replace `alias#query` with `alias#123`. */
  function insertIssue(ref: IssueRef) {
    if (issue) replaceTyped(issue.start, `${issue.alias}#${ref.number} `);
  }

  function insertIcon(name: string) {
    if (iconTyped) replaceTyped(iconTyped.start, `:${name}: `);
  }

  /** "Insert icon…" for this note: the grid, then the icon at the caret, or after the last paragraph. */
  function onInsertIcon(e: Event) {
    if ((e as CustomEvent<{ id: string }>).detail.id !== note.id || !container) return;
    e.preventDefault();
    const el = active !== null ? textarea : null;
    const sel = el && { start: el.selectionStart, end: el.selectionEnd };
    let anchor: HTMLElement | { x: number; y: number } = container;
    if (el && sel) {
      const c = caretCoords(el, sel.start);
      const r = el.getBoundingClientRect();
      anchor = { x: r.left + c.left, y: r.top + c.top + c.height };
    }
    pickIcon(anchor, (name) => {
      const icon = `:${name}:`;
      if (el && sel && textarea === el) {
        // After a letter it wouldn't render, so it gets a space.
        const text = (/[\p{L}\p{N}]$/u.test(el.value.slice(0, sel.start)) ? " " : "") + icon;
        const at = sel.start + text.length;
        el.focus();
        return apply(el, { text: el.value.slice(0, sel.start) + text + el.value.slice(sel.end), start: at, end: at });
      }
      const list = [...blocks];
      const last = list.at(-1);
      if (last !== undefined && !isCode(last) && !isConflict(last)) list[list.length - 1] = last + (/\s$/.test(last) ? "" : " ") + icon;
      else list.push(icon);
      setBody(joinBlocks(list));
      activate(list.length - 1);
    });
  }
  $effect(() => {
    window.addEventListener("insert-icon", onInsertIcon);
    return () => window.removeEventListener("insert-icon", onInsertIcon);
  });

  function insertLink(title: string) {
    if (mention) replaceTyped(mention.start, `[[${title}]] `);
  }

  function createAndLink(title: string) {
    oncreatelink(title);
    insertLink(title);
  }
</script>

{#snippet input()}
  <textarea
    bind:this={textarea}
    value={draft}
    oninput={onInput}
    onkeydown={onKey}
    onpaste={onPaste}
    onkeyup={(e) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) updateMention();
    }}
    onclick={updateMention}
    onblur={() => setTimeout(() => (mention = issue = iconTyped = null), 150)}
    spellcheck={prose}
    autocapitalize={autocorrect ? "sentences" : "off"}
    {...{ autocorrect: autocorrect ? "on" : "off" }}
    rows="1"></textarea>
{/snippet}

{#snippet view(i: number)}
  {@const block = blocks[i]}
  {#if detached && active === i}
    <div class="block editing" class:code={activeIsCode}>
      {@render input()}
    </div>
  {/if}
  {#if !detached && active === i}
    <div class="block editing" class:code={activeIsCode} data-block={i}>
      {@render input()}
    </div>
  {:else if isConflict(block)}
    <div class="block" data-block={i}>
      <ConflictBlock {block} onresolve={(keep) => resolve(i, keep)} onedit={(e) => onBlockClick(e, i)} />
    </div>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="block" data-block={i} onclick={(e) => onBlockClick(e, i)} onpointerdown={(e) => onResizeStart(e, i)}>
      <Markdown source={block} />
    </div>
  {/if}
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="live" bind:this={container} onclick={onContainerClick} onloadcapture={onImageLoad} oncontextmenu={onLinkMenu}>
  {#each runs as run (run.start)}
    {#if run.gallery}
      {@const rowH = galleryHeight(blocks[run.start])}
      {@const h = rowDrag?.first === run.start ? rowDrag.height : rowH}
      <div class="gallery" style:--gallery-row={h ? `${h}px` : null} onclick={onGalleryClick}>
        {#each blocks.slice(run.start, run.end) as _, k (run.start + k)}{@render view(run.start + k)}{/each}
      </div>
    {:else}
      {@render view(run.start)}
    {/if}
  {/each}
  {#if detached && active !== null && active >= blocks.length}
    <div class="block editing" class:code={activeIsCode}>
      {@render input()}
    </div>
  {/if}
  {#if !blocks.length && active === null}
    <div class="block placeholder" onclick={() => appendBlock()}>
      {t("editor.placeholder")}
      {#if !isMobile}
        <span class="hint">{t("editor.placeholder.hint", { bold: keys.bold, italic: keys.italic, link: keys.link, esc: keys.escape })}</span
        >
      {/if}
    </div>
  {/if}
  {#if issue}
    <IssuePopup
      bind:this={issuePopup}
      alias={issue.alias}
      repo={issue.repo}
      query={issue.query}
      left={issue.left}
      top={issue.top}
      onpick={insertIssue}
    />
  {/if}
  {#if iconTyped}
    <IconPopup bind:this={iconPopup} query={iconTyped.query} left={iconTyped.left} top={iconTyped.top} onpick={insertIcon} />
  {/if}
  {#if mention}
    <MentionPopup
      bind:this={mentionPopup}
      query={mention.query}
      left={mention.left}
      top={mention.top}
      excludeId={note.id}
      onpick={(n) => insertLink(n.title)}
      oncreate={createAndLink}
    />
  {/if}
  <div class="tail" onclick={() => selecting() || appendBlock()}></div>
</div>

{#if viewer}
  <Lightbox
    items={viewer.items}
    bind:index={viewer.index}
    onclose={() => (viewer = null)}
    label={t("gallery.viewer")}
    closeLabel={t("pane.close")}
    previousLabel={t("gallery.previous")}
    nextLabel={t("gallery.next")}
  >
    {#snippet actions(item, i)}
      <MediaActions src={item.src} name={viewer?.names[i] ?? null} image />
    {/snippet}
  </Lightbox>
{/if}

<style>
  .live {
    position: relative;
    flex: 1;
    overflow-y: auto;
    /* Entering and leaving a block keep the clicked line in place themselves. */
    overflow-anchor: none;
    padding: 10px 16px 4px;
    cursor: text;
  }
  /* The textarea can't go below 16px on a phone (Safari zooms), so the rendered text matches it. */
  :global(body.mobile) .live {
    font-size: 16px;
  }
  .block {
    position: relative;
    padding: 2px 8px;
    margin: 0 -8px;
  }
  @media (hover: hover) {
    .block:hover:not(.editing) {
      background: color-mix(in srgb, var(--color2) 2%, transparent);
    }
  }
  .block :global(.md > :first-child) {
    margin-top: 0.3em;
  }
  .block :global(.md > :last-child) {
    margin-bottom: 0.3em;
  }
  .block :global(.media img) {
    cursor: zoom-in;
  }
  /* A long press on a picture offers the system's menu: share, save to Photos, copy. */
  :global(body.mobile) .block :global(.media img) {
    -webkit-touch-callout: default;
  }
  .block :global(.md input[type="checkbox"]) {
    pointer-events: auto;
    cursor: pointer;
  }
  .block :global(.media:hover .resize) {
    display: block;
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
    border-radius: 3px;
    background: linear-gradient(
      135deg,
      transparent 45%,
      #fff 45%,
      #fff 55%,
      transparent 55%,
      transparent 70%,
      #fff 70%,
      #fff 80%,
      transparent 80%
    );
    filter: drop-shadow(0 0 1px #000a);
  }
  /* Justified rows: each image grows by its width-to-height ratio, so a row shares one height. */
  /* Hovered and padded like a block, since its blocks have no box of their own. */
  .gallery {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-2);
    padding: calc(0.3em + 2px) 8px;
    margin: 0 -8px;
  }
  @media (hover: hover) {
    .gallery:hover {
      background: color-mix(in srgb, var(--color2) 2%, transparent);
    }
    .gallery :global(.media:hover img) {
      outline: 2px solid color-mix(in srgb, var(--theme2) 60%, transparent);
      outline-offset: 1px;
    }
  }
  .gallery::after {
    content: "";
    flex-grow: 1e4;
  }
  .gallery :global(:is(.block, .md, p)) {
    display: contents;
  }
  .gallery :global(.media) {
    flex: var(--r, 1) 1 calc(var(--r, 1) * var(--gallery-row, 90px));
    min-width: 0;
    /* A row that can't fill stops growing at about twice its base height instead of one huge image. */
    max-width: calc(var(--r, 1) * var(--gallery-row, 90px) * 2.2);
  }
  .gallery :global(.media img) {
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--radius-sm);
  }
  .editing {
    background: color-mix(in srgb, var(--color2) 2.5%, transparent);
  }
  textarea {
    display: block;
    width: 100%;
    resize: none;
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 0.3em 0;
    font-family: var(--font);
    font-size: var(--fs-base);
    line-height: 1.55;
    overflow: hidden;
  }
  .code textarea {
    font-family: var(--mono);
    font-size: var(--fs-sm);
  }
  .placeholder {
    -webkit-user-select: none;
    user-select: none;
    color: var(--faint);
    font-style: italic;
  }
  .hint {
    display: block;
    margin-top: var(--gap-2);
    font-size: var(--fs-micro);
    font-style: normal;
    color: var(--faint);
    opacity: 0.8;
  }
  .tail {
    min-height: 48px;
  }
</style>
