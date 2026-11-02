<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { EditorSelection, EditorState, Prec, Transaction } from "@codemirror/state";
  import { EditorView, keymap, placeholder, type ViewUpdate } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands";
  import { store } from "./store.svelte";
  import type { Note } from "./types";
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
  import { isLocalHref } from "./filelinks";
  import { continueList, embedToLink, indent, link, linkToEmbed, pasteLink, toggleWrap, type Sel } from "./editor";
  import { t, type HistoryLabel } from "./i18n";
  import { keys } from "./keys";
  import { fileExt, kindOf, type MediaDrop } from "./media";
  import { diff, editLabel, external, focusTracking, replaceRange } from "./liveCore";
  import { applySel, embedChange, inCode, linkAt, tailOf, topBlockAt } from "./liveCommands";
  import { liveMarkdown } from "./liveSyntax";
  import { livePreview } from "./livePreview";
  import { liveBlocks } from "./liveBlocks";

  interface Props {
    note: Note;
    oncreatelink: (title: string) => void;
  }

  /** Live preview: the whole body is one CodeMirror document, markdown styled in place. */
  let { note, oncreatelink }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let host = $state<HTMLDivElement | null>(null);
  let view: EditorView | null = null;
  let mentionPopup = $state<MentionPopup | null>(null);
  let issuePopup = $state<IssuePopup | null>(null);
  let iconPopup = $state<IconPopup | null>(null);
  let mention = $state<{ start: number; query: string; left: number; top: number } | null>(null);
  /** Active `:name` icon autocomplete. */
  let iconTyped = $state<{ start: number; query: string; left: number; top: number } | null>(null);
  /** Active `alias#query` GitHub picker. */
  let issue = $state<{ start: number; alias: string; repo: string; query: string; left: number; top: number } | null>(null);
  /** The caret is where insertions go: set on focus, cleared by Esc (clicking elsewhere keeps it, as before). */
  let editing = false;
  /** The whitespace the body ended with before this editing session; extra blank lines are trimmed on blur. */
  let baseTail = "";
  /** The caret's line and where it was on screen when Esc blurred, to keep it there as the note renders. */
  let hold: { pos: number; y: number } | null = null;

  // A note being shown checks its file links again.
  fileTargets.recheck();

  /** Map a keydown to a command on the selection, or null. */
  function command(e: KeyboardEvent): ((s: Sel) => Sel | null) | null {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Enter" && !mod && !e.shiftKey && !e.altKey) return continueList;
    if (e.key === "Tab" && !mod && !e.altKey) return (s) => indent(s, e.shiftKey);
    if (!mod) return null;
    if (matches(keys.bold, e)) return (s) => toggleWrap(s, "**");
    if (matches(keys.italic, e)) return (s) => toggleWrap(s, "*");
    if (matches(keys.code, e) || matches(keys["code-alt"], e)) return (s) => toggleWrap(s, "`");
    if (matches(keys.link, e)) return link;
    if (matches(keys.strike, e)) return (s) => toggleWrap(s, "~~");
    if (matches(keys.highlight, e)) return (s) => toggleWrap(s, "==");
    return null;
  }

  const popupOpen = () => !!(mention || issue || iconTyped);
  const closePopups = () => (mention = issue = iconTyped = null);

  function onKeydown(e: KeyboardEvent, v: EditorView): boolean {
    if (e.isComposing) return false;
    // At most one popup is open; it takes the keys it knows, and Escape closes it.
    if (popupOpen()) {
      if (e.key === "Escape") {
        e.preventDefault();
        closePopups();
        return true;
      }
      if ((mention ? mentionPopup : issue ? issuePopup : iconPopup)?.handleKey(e)) {
        e.preventDefault();
        return true;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      leave(v);
      return true;
    }
    const fn = command(e);
    if (!fn || !applySel(v, fn)) return false;
    e.preventDefault();
    // ⌘K is also quick open at the window level.
    if (e.metaKey || e.ctrlKey) e.stopPropagation();
    return true;
  }

  /** Esc: out of the editor, keeping the caret's line where it is on screen as the markdown hides. */
  function leave(v: EditorView) {
    const pos = v.state.selection.main.head;
    const c = v.coordsAtPos(pos);
    hold = c ? { pos, y: (c.top + c.bottom) / 2 } : null;
    editing = false;
    v.contentDOM.blur();
  }

  function onPaste(e: ClipboardEvent, v: EditorView): boolean {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => kindOf(fileExt(f)));
    if (files.length) {
      e.preventDefault();
      void pasteMedia(files);
      return true;
    }
    const pasted = e.clipboardData?.getData("text/plain") ?? "";
    if (!applySel(v, (s) => pasteLink(s, pasted), "input.paste")) return false;
    e.preventDefault();
    return true;
  }

  async function pasteMedia(files: File[]) {
    const embeds = await store.addMedia(files, false);
    if (embeds.length) placeAtCaret(embeds);
  }

  /** `embeds` as paragraphs of their own at the caret, typing going on after them; appended when not editing. */
  function placeAtCaret(embeds: string[]) {
    const v = view;
    if (!v) return;
    const text = v.state.doc.toString();
    const { from, to } = v.state.selection.main;
    const c = editing ? embedChange(text, from, to, embeds, true) : embedChange(text, text.length, text.length, embeds, false);
    v.dispatch({
      changes: { from: c.from, to: c.to, insert: c.insert },
      selection: editing ? EditorSelection.cursor(c.caret) : undefined,
      scrollIntoView: editing,
      annotations: editLabel.of("media"),
      userEvent: "input.paste",
    });
    if (editing) v.focus();
  }

  /** Writes local edits to the note, under the store label the transaction carries. */
  function sync(u: ViewUpdate) {
    const local = u.transactions.filter((tr) => tr.docChanged && !tr.annotation(external));
    if (!local.length) return;
    // Through the store: the note is the store's, the panel only passes it in.
    const n = store.byId(note.id) ?? note;
    n.body = u.state.doc.toString();
    const label: HistoryLabel | undefined = local.map((tr) => tr.annotation(editLabel)).find(Boolean);
    store.touch(note.id, { label });
  }

  function onUpdate(u: ViewUpdate) {
    if (u.docChanged) sync(u);
    if (u.focusChanged) {
      if (u.view.hasFocus) editing = true;
      else blurred(u.view);
    }
    if ((u.docChanged || u.selectionSet) && u.view.hasFocus) updateMention(u.view);
  }

  function blurred(v: EditorView) {
    setTimeout(closePopups, 150);
    const h = hold;
    hold = null;
    if (h) {
      v.requestMeasure({
        read: () => v.coordsAtPos(Math.min(h.pos, v.state.doc.length)),
        write: (c) => {
          if (c && container) container.scrollTop += (c.top + c.bottom) / 2 - h.y;
        },
      });
    }
    queueMicrotask(() => trimTail(v));
  }

  /** Blank lines left empty at the end (a new paragraph never typed in) go, without an undo step. */
  function trimTail(v: EditorView) {
    if (v.hasFocus) return;
    const doc = v.state.doc;
    const tail = tailOf(doc.sliceString(Math.max(0, doc.length - 400)));
    if (tail.length > baseTail.length && tail.includes("\n")) {
      v.dispatch({
        changes: { from: doc.length - tail.length, to: doc.length, insert: baseTail },
        annotations: Transaction.addToHistory.of(false),
      });
    } else baseTail = tail;
  }

  /** Clicking below the text puts the caret at the end, in a new paragraph when the last line has text. */
  function toEnd() {
    const v = view;
    if (!v || !padDown) return;
    const doc = v.state.doc;
    const tail = tailOf(doc.sliceString(Math.max(0, doc.length - 400)));
    const breaks = tail.split("\n").length - 1;
    const add = doc.length === tail.length || breaks >= 2 ? "" : "\n".repeat(2 - breaks);
    v.dispatch({
      changes: add ? { from: doc.length, insert: add } : [],
      selection: EditorSelection.cursor(doc.length + add.length),
      scrollIntoView: true,
      annotations: Transaction.addToHistory.of(false),
      userEvent: "select.pointer",
    });
    v.focus();
  }

  /** The press was on the empty space around the text, not the end of a drag-selection begun in it. */
  let padDown = false;

  function onContainerDown(e: MouseEvent) {
    padDown = e.target === container || (e.target as HTMLElement).classList.contains("tail");
    // Keeps the editor focused (nothing re-renders) while the click decides where the caret goes.
    if (padDown) e.preventDefault();
  }

  function onContainerClick(e: MouseEvent) {
    const v = view;
    if (!v || e.target !== container || !padDown) return;
    if (e.clientY > v.dom.getBoundingClientRect().bottom) return toEnd();
    const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }, false);
    v.dispatch({ selection: EditorSelection.cursor(pos), userEvent: "select.pointer" });
    v.focus();
  }

  // Another window, the store's undo or a rename changed the body: bring it in, the selection mapped through it.
  $effect(() => {
    const body = note.body;
    untrack(() => {
      const v = view;
      const change = v && diff(v.state.doc, body);
      if (!v || !change) return;
      v.dispatch({ changes: change, annotations: [external.of(true), Transaction.addToHistory.of(false)] });
      if (!v.hasFocus) baseTail = tailOf(body);
    });
  });

  // On a phone the keyboard shrinks the editor: keep the caret in view.
  $effect(() => {
    if (!isMobile || !container) return;
    const ro = new ResizeObserver(() => {
      if (view?.hasFocus) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { yMargin: 12 }) });
    });
    ro.observe(container);
    return () => ro.disconnect();
  });

  /** Scrolls the line at `pos` to the top of the editor (the table of contents). */
  export function scrollTo(pos: number) {
    const v = view;
    const box = container;
    if (!v || !box) return;
    const at = Math.min(pos, v.state.doc.length);
    const top = () => box.scrollTop + v.documentTop + v.lineBlockAt(at).top - box.getBoundingClientRect().top;
    box.scrollTo({ top: top(), behavior: "smooth" });
    // Lines out of view have estimated heights; once there, measure again and settle.
    let passes = 3;
    const settle = () => {
      box.removeEventListener("scrollend", settle);
      clearTimeout(timer);
      v.requestMeasure({
        read: top,
        write: (want) => {
          if (Math.abs(want - box.scrollTop) < 2 || !passes--) return;
          box.scrollTop = want;
          requestAnimationFrame(settle);
        },
      });
    };
    box.addEventListener("scrollend", settle);
    const timer = setTimeout(settle, 900);
  }

  /** The note's images, open in the viewer at `index`; `names` are their files in `assets/`. */
  let viewer = $state<{ items: LightboxItem[]; names: (string | null)[]; index: number } | null>(null);

  /** Shows `img` full screen, with the note's other images a step away. */
  function viewImage(img: HTMLImageElement) {
    if (!container) return;
    const all = [...container.querySelectorAll<HTMLImageElement>(".media img")];
    viewer = {
      items: all.map((el) => ({ src: el.currentSrc || el.src, kind: "image", alt: el.alt })),
      names: all.map((el) => el.dataset.asset ?? null),
      index: Math.max(0, all.indexOf(img)),
    };
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
  function onContextMenu(e: MouseEvent) {
    const v = view;
    if (onImageMenu(e) || !v) return;
    const target = e.target as HTMLElement;
    const file = target.closest<HTMLElement>("a.filelink[data-path]")?.dataset.path;
    if (file) return fileMenu(e, file);
    if (!v.contentDOM.contains(target) || target === v.contentDOM) return;
    let row = target;
    while (row.parentElement && row.parentElement !== v.contentDOM) row = row.parentElement;
    const a = target.closest<HTMLAnchorElement>("a[href]");
    if (a && !row.classList.contains("cm-line")) return widgetLinkMenu(e, v, row, a);
    const l = linkAt(v.state, v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.posAtDOM(target));
    if (!l) return;
    if (!/^https?:/i.test(l.url)) return isLocalHref(l.url) ? fileMenu(e, l.url) : undefined;
    webMenu(e, l.url, l.card, () => {
      const src = v.state.sliceDoc(l.from, l.to);
      const next = l.card ? embedToLink(src, l.url, previews.get(l.url)?.title ?? null) : linkToEmbed(src, l.url);
      if (next !== src) replaceRange(v, l.from, l.to, next, l.card ? "unpreview" : "preview");
    });
  }

  /** A link inside a rendered block (a card, a table): the `n`-th of its kind in the block's source. */
  function widgetLinkMenu(e: MouseEvent, v: EditorView, row: HTMLElement, a: HTMLAnchorElement) {
    const url = a.getAttribute("href");
    if (!url || !/^https?:/i.test(url)) return;
    const card = a.classList.contains("link-card");
    const same = [...row.querySelectorAll("a[href]")].filter(
      (x) => x.getAttribute("href") === url && x.classList.contains("link-card") === card,
    );
    const n = same.indexOf(a);
    const pos = v.posAtDOM(row);
    const line = v.lineBlockAt(pos);
    const top = topBlockAt(v.state, pos);
    const from = Math.min(line.from, top.from);
    const to = Math.max(line.to, top.to);
    webMenu(e, url, card, () => {
      const src = v.state.sliceDoc(from, to);
      const next = card ? embedToLink(src, url, previews.get(url)?.title ?? null, n) : linkToEmbed(src, url, n);
      if (next !== src) replaceRange(v, from, to, next, card ? "unpreview" : "preview");
    });
  }

  function webMenu(e: MouseEvent, url: string, card: boolean, swap: () => void) {
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

  /** Files dropped on the editor go before the paragraph under the pointer, or after it past its middle. */
  async function onMediaDrop(e: Event) {
    const { items = [], embeds: given, y } = (e as CustomEvent<MediaDrop>).detail;
    e.stopPropagation();
    const embeds = given ?? (await store.addMedia(items));
    const v = view;
    if (!embeds.length || !v) return;
    const text = v.state.doc.toString();
    let at = text.length;
    if (text.trim()) {
      const h = y - v.documentTop;
      const block = topBlockAt(v.state, v.lineBlockAtHeight(h).from);
      const mid = (v.lineBlockAt(block.from).top + v.lineBlockAt(block.to).bottom) / 2;
      at = h < mid ? block.from : block.to;
    }
    const c = embedChange(text, at, at, embeds, false);
    v.dispatch({ changes: { from: c.from, to: c.to, insert: c.insert }, annotations: editLabel.of("media"), userEvent: "input.drop" });
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
    if (id !== note.id || !view) return;
    e.preventDefault();
    placeAtCaret(embeds);
  }
  $effect(() => {
    window.addEventListener("insert-media", onInsertMedia);
    return () => window.removeEventListener("insert-media", onInsertMedia);
  });

  // ---- popups ---------------------------------------------------------------

  const MENTION_RE = /(^|[\s(])@([^\s@[\]]*)$/;
  /** `alias#query` right before the caret (alias must be a configured repo). */
  const ISSUE_RE = /(^|[\s(])([\w.-]+)#([^\s#]*)$/;

  function updateMention(v: EditorView) {
    const { state } = v;
    const sel = state.selection.main;
    if (!sel.empty) return closePopups();
    const caret = sel.head;
    const before = state.sliceDoc(Math.max(state.doc.lineAt(caret).from, caret - 80), caret);
    const m = MENTION_RE.exec(before);
    if (m) {
      issue = iconTyped = null;
      const start = caret - m[2].length - 1;
      mention = { start, query: m[2], ...below(v, start) };
      return;
    }
    mention = null;
    const ic = inCode(state, caret) ? null : typedIcon(before);
    if (ic) {
      issue = null;
      const start = caret - before.length + ic.start;
      const at = below(v, start);
      iconTyped = { start, query: ic.query, ...at, left: Math.max(0, Math.min(at.left, (container?.clientWidth ?? 0) - 240)) };
      return;
    }
    iconTyped = null;
    // An open picker stays anchored (so the query may hold spaces) until the caret leaves it.
    if (issue) {
      const from = issue.start + issue.alias.length + 1;
      const typed = state.sliceDoc(from, Math.max(from, caret));
      if (caret >= from && state.sliceDoc(issue.start, from) === `${issue.alias}#` && !typed.includes("\n") && !/\s{2}$/.test(typed)) {
        issue.query = typed;
        return;
      }
      issue = null;
    }
    const g = ISSUE_RE.exec(before);
    const repo = g && store.repos[g[2]];
    if (!g || !repo) return void (issue = null);
    const start = caret - g[3].length - g[2].length - 1;
    issue = { start, alias: g[2], repo, query: g[3], ...below(v, start) };
  }

  /** Where a popup goes under offset `at`, in the scrolled editor's coordinates. */
  function below(v: EditorView, at: number): { left: number; top: number } {
    const c = v.coordsAtPos(at);
    if (!c || !container) return { left: 0, top: 0 };
    const box = container.getBoundingClientRect();
    return { left: c.left - box.left, top: c.bottom - box.top + container.scrollTop + 4 };
  }

  /** Replace what was typed from `start` up to the caret by `insert`. */
  function replaceTyped(start: number, insert: string) {
    const v = view;
    if (!v) return;
    const head = v.state.selection.main.head;
    closePopups();
    v.dispatch({
      changes: { from: start, to: Math.max(start, head), insert },
      selection: EditorSelection.cursor(start + insert.length),
      scrollIntoView: true,
      userEvent: "input.complete",
    });
    v.focus();
  }

  /** Replace `alias#query` with `alias#123`. */
  function insertIssue(ref: IssueRef) {
    if (issue) replaceTyped(issue.start, `${issue.alias}#${ref.number} `);
  }

  function insertIcon(name: string) {
    if (iconTyped) replaceTyped(iconTyped.start, `:${name}: `);
  }

  function insertLink(title: string) {
    if (mention) replaceTyped(mention.start, `[[${title}]] `);
  }

  function createAndLink(title: string) {
    oncreatelink(title);
    insertLink(title);
  }

  /** "Insert icon…" for this note: the grid, then the icon at the caret, or after the last paragraph. */
  function onInsertIcon(e: Event) {
    const v = view;
    if ((e as CustomEvent<{ id: string }>).detail.id !== note.id || !v || !container) return;
    e.preventDefault();
    const at = editing ? v.state.selection.main.from : null;
    const c = at === null ? null : v.coordsAtPos(at);
    pickIcon(c ? { x: c.left, y: c.bottom } : container, (name) => {
      const icon = `:${name}:`;
      const { state } = v;
      if (editing) {
        const { from, to } = state.selection.main;
        // After a letter it wouldn't render, so it gets a space.
        const insert = (/[\p{L}\p{N}]/u.test(state.sliceDoc(Math.max(0, from - 1), from)) ? " " : "") + icon;
        v.dispatch({
          changes: { from, to, insert },
          selection: EditorSelection.cursor(from + insert.length),
          scrollIntoView: true,
          userEvent: "input",
        });
      } else {
        const end = state.doc.toString().trimEnd().length;
        const own = !end || inCode(state, end) || /^>{7}( |$)/.test(state.doc.lineAt(end).text);
        const insert = (own ? (end ? "\n\n" : "") : " ") + icon;
        v.dispatch({
          changes: { from: end, insert },
          selection: EditorSelection.cursor(end + insert.length),
          scrollIntoView: true,
          userEvent: "input",
        });
      }
      v.focus();
    });
  }
  $effect(() => {
    window.addEventListener("insert-icon", onInsertIcon);
    return () => window.removeEventListener("insert-icon", onInsertIcon);
  });

  function placeholderEl(): HTMLElement {
    const el = document.createElement("span");
    el.textContent = t("editor.placeholder");
    if (!isMobile) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = t("editor.placeholder.hint", { bold: keys.bold, italic: keys.italic, link: keys.link, esc: keys.escape });
      el.append(hint);
    }
    return el;
  }

  // Safari's smart punctuation turns markdown into curly quotes and en-dashes; a phone keyboard needs it for prose.
  const textAttributes = EditorView.contentAttributes.compute(["doc", "selection"], (state) => {
    const prose = !inCode(state, state.selection.main.head);
    const fix = isMobile && prose;
    return { spellcheck: String(prose), autocorrect: fix ? "on" : "off", autocapitalize: fix ? "sentences" : "off" };
  });

  const hostTheme = EditorView.theme({
    "&": { height: "auto" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { overflow: "visible" },
  });

  onMount(() => {
    baseTail = tailOf(note.body);
    view = new EditorView({
      parent: host!,
      state: EditorState.create({
        doc: note.body,
        extensions: [
          liveMarkdown(),
          livePreview(),
          liveBlocks({ viewImage }),
          focusTracking(),
          history(),
          EditorView.lineWrapping,
          Prec.highest(EditorView.domEventHandlers({ keydown: onKeydown, paste: onPaste })),
          keymap.of([{ key: "Enter", run: insertNewline, shift: insertNewline }, ...defaultKeymap, ...historyKeymap]),
          textAttributes,
          placeholder(placeholderEl()),
          hostTheme,
          EditorView.updateListener.of(onUpdate),
        ],
      }),
    });
    return () => {
      view?.destroy();
      view = null;
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="live" bind:this={container} onmousedown={onContainerDown} onclick={onContainerClick} oncontextmenu={onContextMenu}>
  <div class="doc" bind:this={host}></div>
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
  <div class="tail" onclick={toEnd}></div>
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
    /* The editor keeps the caret's line in place itself (Esc, the table of contents). */
    overflow-anchor: none;
    padding: 10px 16px 4px;
    cursor: text;
  }
  /* Safari zooms into text under 16px on a phone. */
  :global(body.mobile) .live {
    font-size: 16px;
  }
  .live :global(.cm-placeholder) {
    color: var(--faint);
    font-style: italic;
  }
  .live :global(.cm-placeholder .hint) {
    display: block;
    margin-top: var(--gap-2);
    font-size: var(--fs-micro);
    font-style: normal;
    opacity: 0.8;
  }
  /* A long press on a picture offers the system's menu: share, save to Photos, copy. */
  :global(body.mobile) .live :global(.media img) {
    -webkit-touch-callout: default;
  }
  .tail {
    min-height: 48px;
  }
</style>
