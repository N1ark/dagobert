<script lang="ts">
  import { tick, untrack } from "svelte";
  import { store } from "./store.svelte";
  import type { Note } from "./types";
  import Markdown from "./Markdown.svelte";
  import ConflictBlock from "./ConflictBlock.svelte";
  import MentionPopup from "./MentionPopup.svelte";
  import IssuePopup from "./IssuePopup.svelte";
  import type { IssueRef } from "./github";
  import { command, pasteLink } from "./editor";
  import { caretCoords } from "./wikilinks";
  import { t, type HistoryLabel } from "./i18n";
  import { keys } from "./keys";
  import { splitBlocks, joinBlocks, locate, toggleCheckbox, isCode, isConflict, resolveConflict } from "./blocks";

  /**
   * Obsidian-style live preview: the body is shown rendered, block by block.
   * The block holding the cursor is swapped for a textarea with its raw markdown.
   */
  let { note, oncreatelink }: { note: Note; oncreatelink: (title: string) => void } = $props();

  let container = $state<HTMLDivElement | null>(null);
  let textarea = $state<HTMLTextAreaElement | null>(null);
  let mentionPopup = $state<MentionPopup | null>(null);
  // Safari's smart punctuation turns markdown into curly quotes and en-dashes.
  const autocorrectOff = { autocorrect: "off" };
  let issuePopup = $state<IssuePopup | null>(null);
  /** Active `alias#query` GitHub picker. */
  let issue = $state<{ start: number; alias: string; repo: string; query: string; left: number; top: number } | null>(null);

  const blocks = $derived(splitBlocks(note.body));
  /** Index of the block being edited, or null when everything is rendered. */
  let active = $state<number | null>(null);
  /** Raw text of the active block while it's being edited. */
  let draft = $state("");
  let mention = $state<{ start: number; query: string; left: number; top: number } | null>(null);
  /** Caret to apply once the textarea mounts. */
  let pendingCaret: number | null = null;

  const activeIsCode = $derived(isCode(draft));

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
    if (target.closest("a")) return; // links are handled by <Markdown>
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

  function onContainerClick(e: MouseEvent) {
    if (e.target === container) appendBlock();
  }

  // ---- textarea ------------------------------------------------------------

  async function onInput() {
    const el = textarea!;
    draft = el.value;
    autosize();
    // A blank line inside the draft splits it into several blocks; keep the
    // caret in the right one.
    const parts = splitBlocks(draft);
    if (parts.length > 1) {
      const { index, offset } = locate(draft, el.selectionStart);
      activate(active! + index, offset);
      return;
    }
    // Live-sync so the card preview and search see edits. An empty draft is
    // not synced (it can't be represented in markdown) until we leave it.
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

  /** Pasting a URL over selected text turns the selection into a link. */
  function onPaste(e: ClipboardEvent) {
    const el = e.target as HTMLTextAreaElement;
    const pasted = e.clipboardData?.getData("text/plain") ?? "";
    const next = pasteLink({ text: el.value, start: el.selectionStart, end: el.selectionEnd }, pasted);
    if (!next) return;
    e.preventDefault();
    el.value = next.text;
    el.setSelectionRange(next.start, next.end);
    onInput().then(() => textarea?.setSelectionRange(next.start, next.end));
  }

  function lineOf(text: string, pos: number) {
    return { first: text.lastIndexOf("\n", pos - 1) === -1, last: text.indexOf("\n", pos) === -1 };
  }

  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLTextAreaElement;
    if (mention) {
      if (e.key === "Escape") {
        e.preventDefault();
        mention = null;
        return;
      }
      if (mentionPopup?.handleKey(e)) {
        e.preventDefault();
        return;
      }
    }
    if (issue) {
      if (e.key === "Escape") {
        e.preventDefault();
        issue = null;
        return;
      }
      if (issuePopup?.handleKey(e)) {
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
      el.value = next.text;
      el.setSelectionRange(next.start, next.end);
      onInput().then(() => textarea?.setSelectionRange(next.start, next.end));
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
    // Once open, the picker stays anchored so the query may contain spaces;
    // it closes on Escape, a pick, a newline, or the caret leaving the query.
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

  /** Replace `alias#query` with `alias#123`. */
  function insertIssue(ref: IssueRef) {
    const el = textarea;
    if (!el || !issue) return;
    const end = el.selectionStart;
    const insert = `${issue.alias}#${ref.number} `;
    el.value = el.value.slice(0, issue.start) + insert + el.value.slice(end);
    const pos = issue.start + insert.length;
    issue = null;
    el.setSelectionRange(pos, pos);
    onInput();
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function insertLink(title: string) {
    const el = textarea;
    if (!el || !mention) return;
    const end = el.selectionStart;
    const insert = `[[${title}]] `;
    el.value = el.value.slice(0, mention.start) + insert + el.value.slice(end);
    const pos = mention.start + insert.length;
    mention = null;
    el.setSelectionRange(pos, pos);
    onInput();
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function createAndLink(title: string) {
    oncreatelink(title);
    insertLink(title);
  }

  /** Public: start editing at the end (used when a note is brand new). */
  export function focusEnd() {
    if (blocks.length) activate(blocks.length - 1, "end");
    else appendBlock();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="live" bind:this={container} onclick={onContainerClick}>
  {#each blocks as block, i (i)}
    {#if active === i}
      <div class="block editing" class:code={activeIsCode} data-block={i}>
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
          spellcheck="false"
          autocapitalize="sentences"
          {...autocorrectOff}
          rows="1"></textarea>
      </div>
    {:else if isConflict(block)}
      <div class="block" data-block={i}>
        <ConflictBlock {block} onresolve={(keep) => resolve(i, keep)} onedit={(e) => onBlockClick(e, i)} />
      </div>
    {:else}
      <div class="block" data-block={i} onclick={(e) => onBlockClick(e, i)}>
        <Markdown source={block} />
      </div>
    {/if}
  {/each}
  {#if active !== null && active >= blocks.length}
    <div class="block editing" class:code={activeIsCode}>
      <textarea
        bind:this={textarea}
        value={draft}
        oninput={onInput}
        onkeydown={onKey}
        onpaste={onPaste}
        onblur={() => setTimeout(() => (mention = issue = null), 150)}
        spellcheck="false"
        autocapitalize="sentences"
        {...autocorrectOff}
        rows="1"></textarea>
    </div>
  {/if}
  {#if !blocks.length && active === null}
    <div class="block placeholder" onclick={() => appendBlock()}>
      {t("editor.placeholder")}
      <span class="hint">{t("editor.placeholder.hint", { bold: keys.bold, italic: keys.italic, link: keys.link, esc: keys.escape })}</span>
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
  .block {
    position: relative;
    padding: 2px 8px;
    margin: 0 -8px;
  }
  .block:hover:not(.editing) {
    background: #ffffff05;
  }
  .block :global(.markdown > :first-child) {
    margin-top: 0.3em;
  }
  .block :global(.markdown > :last-child) {
    margin-bottom: 0.3em;
  }
  .block :global(.markdown input[type="checkbox"]) {
    pointer-events: auto;
    cursor: pointer;
  }
  .editing {
    background: #ffffff06;
  }
  textarea {
    display: block;
    width: 100%;
    resize: none;
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 0.3em 0;
    font-family: var(--sans);
    font-size: 14px;
    line-height: 1.55;
    overflow: hidden;
  }
  .code textarea {
    font-family: var(--mono);
    font-size: 13px;
  }
  .placeholder {
    color: #555;
    font-style: italic;
  }
  .hint {
    display: block;
    margin-top: 4px;
    font-size: 11px;
    font-style: normal;
    color: #444;
  }
  .tail {
    min-height: 48px;
  }
</style>
