<script lang="ts">
  import { tick, untrack } from "svelte";
  import { store } from "./store.svelte";
  import type { Note } from "./types";
  import Markdown from "./Markdown.svelte";
  import ConflictBlock from "./ConflictBlock.svelte";
  import MentionPopup from "./MentionPopup.svelte";
  import { isMobile } from "./backend";
  import IssuePopup from "./IssuePopup.svelte";
  import type { IssueRef } from "./github";
  import { copyText, matches, menu } from "purr";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { previews } from "./previews.svelte";
  import { continueList, embedToLink, indent, link, linkToEmbed, pasteLink, setMediaWidth, toggleWrap, type Sel } from "./editor";
  import { caretCoords } from "./wikilinks";
  import { t, type HistoryLabel } from "./i18n";
  import { keys } from "./keys";
  import { splitBlocks, joinBlocks, locate, toggleCheckbox, isCode, isConflict, resolveConflict, insertBlocks } from "./blocks";
  import { fileExt, galleryRuns, kindOf, type MediaDrop } from "./media";

  /** Live preview: blocks are rendered, and the one holding the caret becomes a textarea. */
  let { note, oncreatelink }: { note: Note; oncreatelink: (title: string) => void } = $props();

  let container = $state<HTMLDivElement | null>(null);
  let textarea = $state<HTMLTextAreaElement | null>(null);
  let mentionPopup = $state<MentionPopup | null>(null);
  let issuePopup = $state<IssuePopup | null>(null);
  /** Active `alias#query` GitHub picker. */
  let issue = $state<{ start: number; alias: string; repo: string; query: string; left: number; top: number } | null>(null);

  const blocks = $derived(splitBlocks(note.body));
  /** Index of the block being edited, or null when everything is rendered. */
  let active = $state<number | null>(null);
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
    if (active !== null) next[active] = draft;
    return next;
  }

  /** Write the draft into the body. Returns the resulting block list. */
  function commit(): string[] {
    if (active === null) return blocks;
    const body = joinBlocks(withDraft());
    setBody(body);
    return splitBlocks(body);
  }

  /** Start editing block `index` (of the current body) with the caret at `caret`. */
  async function activate(index: number, caret: number | "end" = "end") {
    const list = commit();
    active = null;
    if (!list.length) return appendBlock();
    const i = Math.max(0, Math.min(index, list.length - 1));
    draft = list[i];
    active = i;
    pendingCaret = caret === "end" ? draft.length : Math.min(caret, draft.length);
    await tick();
    focusCaret();
  }

  function focusCaret() {
    const el = textarea;
    if (!el) return;
    el.focus();
    if (pendingCaret !== null) {
      el.setSelectionRange(pendingCaret, pendingCaret);
      pendingCaret = null;
    }
    autosize();
    revealCaret();
  }

  // Another window changed the body under an active block: reload the draft, keeping the caret.
  $effect(() => {
    const body = note.body;
    if (active === null) return;
    untrack(() => {
      if (joinBlocks(withDraft()) === body) return;
      const list = splitBlocks(body);
      if (active! >= list.length) {
        active = list.length;
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

  function deactivate() {
    if (active === null) return;
    commit();
    active = null;
    draft = "";
    mention = null;
    issue = null;
  }

  function autosize() {
    const el = textarea;
    if (!el) return;
    el.style.height = "0";
    el.style.height = `${el.scrollHeight}px`;
  }

  /** Keeps the caret in view on a phone, where the keyboard shrinks the editor under it. */
  function revealCaret() {
    const el = textarea;
    if (!isMobile || !el || !container || document.activeElement !== el) return;
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

  /** Start a fresh paragraph after the last block ("virtual" until it has text). */
  async function appendBlock() {
    const list = commit();
    active = null;
    draft = "";
    active = list.length;
    pendingCaret = 0;
    await tick();
    focusCaret();
  }

  /** Move editing to a neighbouring block, accounting for the active one being dropped if empty. */
  function moveBy(delta: -1 | 1) {
    if (active === null) return;
    const dropped = draft.trim() === "" && active < blocks.length ? 1 : 0;
    const target = delta < 0 ? active - 1 : active + 1 - dropped;
    activate(target, delta < 0 ? "end" : 0);
  }

  // ---- rendered block interactions -----------------------------------------

  /** Best-effort: place the caret in the raw text near the clicked rendered text. */
  function caretFromClick(e: MouseEvent, raw: string): number {
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    const node = range?.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return raw.length;
    const text = node.textContent ?? "";
    const off = range!.startOffset;
    // Search for the words around the click in the raw block.
    for (let len = 16; len >= 3; len -= 3) {
      const before = text.slice(Math.max(0, off - len), off);
      if (before.trim().length < 2) continue;
      const at = raw.indexOf(before);
      if (at >= 0) return at + before.length;
    }
    const after = text.slice(off, off + 12);
    const at = after.trim() ? raw.indexOf(after) : -1;
    return at >= 0 ? at : raw.length;
  }

  function onBlockClick(e: MouseEvent, i: number) {
    const target = e.target as HTMLElement;
    // Links are handled by <Markdown>; players keep their own clicks.
    if (target.closest("a, .resize, video, audio")) return;
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      e.preventDefault();
      const boxes = [...(target.closest(".block")?.querySelectorAll('input[type="checkbox"]') ?? [])];
      const next = [...blocks];
      next[i] = toggleCheckbox(blocks[i], boxes.indexOf(target));
      setBody(joinBlocks(next));
      return;
    }
    activate(i, caretFromClick(e, blocks[i]));
  }

  /** The block's `index`-th embed, rewritten to `width` (null = natural size). */
  function resizeMedia(i: number, index: number, width: number | null) {
    const next = [...blocks];
    next[i] = setMediaWidth(blocks[i], index, width);
    setBody(joinBlocks(next), "resizeMedia");
  }

  /** Right-click on a web link or a preview card: open, copy, or switch between the two. */
  function onLinkMenu(e: MouseEvent) {
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

  /** A gallery sizes each image by its shape, known once it loads. */
  function onImageLoad(e: Event) {
    const img = e.target as HTMLElement;
    if (!(img instanceof HTMLImageElement) || !img.closest(".gallery") || !img.naturalHeight) return;
    img.parentElement?.style.setProperty("--r", String(img.naturalWidth / img.naturalHeight));
  }

  /** Dragging an embed's corner handle resizes it live; the width lands in the source on release. */
  function onResizeStart(e: PointerEvent, i: number) {
    const handle = (e.target as HTMLElement).closest<HTMLElement>(".resize");
    const wrap = handle?.parentElement;
    const media = wrap?.querySelector<HTMLElement>("img, video");
    const block = e.currentTarget as HTMLElement;
    if (!handle || !wrap || !media || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
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

  /** Double-clicking the handle goes back to the natural size. */
  function onResizeReset(e: MouseEvent, i: number) {
    const wrap = (e.target as HTMLElement).closest(".resize")?.parentElement;
    if (!wrap) return;
    const index = [...(e.currentTarget as HTMLElement).querySelectorAll(".media")].indexOf(wrap);
    resizeMedia(i, index, null);
  }

  /** A click between a gallery's images edits the nearest one. */
  function onGalleryClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest("[data-block]")) return;
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
    if (e.target === container) appendBlock();
  }

  // ---- textarea ------------------------------------------------------------

  async function onInput() {
    const el = textarea!;
    draft = el.value;
    autosize();
    revealCaret();
    // A blank line splits the draft in two; follow the caret into the right block.
    const parts = splitBlocks(draft);
    if (parts.length > 1) {
      const { index, offset } = locate(draft, el.selectionStart);
      activate(active! + index, offset);
      return;
    }
    // Sync as we type so cards and search see the edit; an empty draft has no markdown to sync.
    if (draft.trim() !== "") {
      const caret = el.selectionStart;
      setBody(joinBlocks(withDraft()));
      await tick();
      // The textarea may have been re-mounted (virtual block became real).
      if (textarea !== el) {
        pendingCaret = caret;
        focusCaret();
      }
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
    if (mention || issue) {
      if (e.key === "Escape") {
        e.preventDefault();
        mention = issue = null;
        return;
      }
      if ((mention ? mentionPopup : issuePopup)?.handleKey(e)) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      deactivate();
      return;
    }
    const { first, last } = lineOf(el.value, el.selectionStart);
    if (e.key === "ArrowUp" && first && active! > 0) {
      e.preventDefault();
      moveBy(-1);
      return;
    }
    if (e.key === "ArrowDown" && last && active! < blocks.length - 1) {
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
      next.splice(prevIdx, 2, merged);
      active = null;
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
    if (!el || el.selectionStart !== el.selectionEnd) return void (mention = issue = null);
    const caret = el.selectionStart;
    const before = el.value.slice(Math.max(0, caret - 80), caret);
    const m = MENTION_RE.exec(before);
    if (m) {
      issue = null;
      const start = caret - m[2].length - 1;
      const c = caretCoords(el, start);
      mention = { start, query: m[2], left: el.offsetLeft + c.left, top: el.offsetTop + c.top + c.height + 4 };
      return;
    }
    mention = null;
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
    const c = caretCoords(el, start);
    issue = { start, alias: g[2], repo, query: g[3], left: el.offsetLeft + c.left, top: el.offsetTop + c.top + c.height + 4 };
  }

  /** Replace what was typed from `start` up to the caret by `insert`. */
  function replaceTyped(start: number, insert: string) {
    const el = textarea;
    if (!el) return;
    el.value = el.value.slice(0, start) + insert + el.value.slice(el.selectionStart);
    const pos = start + insert.length;
    mention = issue = null;
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
    onblur={() => setTimeout(() => (mention = issue = null), 150)}
    spellcheck={prose}
    autocapitalize={autocorrect ? "sentences" : "off"}
    {...{ autocorrect: autocorrect ? "on" : "off" }}
    rows="1"></textarea>
{/snippet}

{#snippet view(i: number)}
  {@const block = blocks[i]}
  {#if active === i}
    <div class="block editing" class:code={activeIsCode} data-block={i}>
      {@render input()}
    </div>
  {:else if isConflict(block)}
    <div class="block" data-block={i}>
      <ConflictBlock {block} onresolve={(keep) => resolve(i, keep)} onedit={(e) => onBlockClick(e, i)} />
    </div>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="block"
      data-block={i}
      onclick={(e) => onBlockClick(e, i)}
      onpointerdown={(e) => onResizeStart(e, i)}
      ondblclick={(e) => onResizeReset(e, i)}
    >
      <Markdown source={block} />
    </div>
  {/if}
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="live" bind:this={container} onclick={onContainerClick} onloadcapture={onImageLoad} oncontextmenu={onLinkMenu}>
  {#each runs as run (run.start)}
    {#if run.gallery}
      <div class="gallery" onclick={onGalleryClick}>
        {#each blocks.slice(run.start, run.end) as _, k (run.start + k)}{@render view(run.start + k)}{/each}
      </div>
    {:else}
      {@render view(run.start)}
    {/if}
  {/each}
  {#if active !== null && active >= blocks.length}
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
  <div class="tail" onclick={() => appendBlock()}></div>
</div>

<style>
  .live {
    position: relative;
    flex: 1;
    overflow-y: auto;
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
    flex: var(--r, 1) 1 calc(var(--r, 1) * 90px);
    min-width: 0;
    /* A row that can't fill stops growing at 200px high instead of one huge image. */
    max-width: calc(var(--r, 1) * 200px);
  }
  .gallery :global(.media img) {
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--radius-sm);
  }
  .gallery :global(.media .resize) {
    display: none !important;
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
