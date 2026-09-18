<script lang="ts">
  import type { Component } from "svelte";
  import { store } from "./store.svelte";
  import type { Note } from "./types";
  import InlineMd from "./InlineMd.svelte";
  import { fuzzyMatch, parseQuery } from "./fuzzy";
  import { stageColor } from "./workflows";
  import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";
  import ArrowSquareOut from "phosphor-svelte/lib/ArrowSquareOut";
  import Plus from "phosphor-svelte/lib/Plus";
  import Terminal from "phosphor-svelte/lib/Terminal";

  export interface Action {
    id: string;
    label: string;
    hint?: string;
    /** Phosphor icon component. */
    icon?: Component<any>;
    run: () => void;
    /** Menu section (File / Edit / Note / View / Tools). */
    menu?: string;
    /** Static label for the menu bar when `label` is dynamic. */
    menuLabel?: string;
    enabled?: boolean;
  }

  /**
   * ⌘K quick switcher (fuzzy note titles, `#tag` narrows) or, with
   * `mode="commands"`, the ⇧⌘K command palette over the `actions` prop.
   */
  let {
    actions,
    onjump,
    oncreate,
    onclose,
    mode = "notes",
  }: {
    /** "notes" = quick switcher, "commands" = command palette. */
    mode?: "notes" | "commands";
    actions: Action[];
    onjump: (id: string) => void;
    oncreate: (title: string) => void;
    onclose: () => void;
  } = $props();

  let query = $state("");
  let active = $state(0);
  let input = $state<HTMLInputElement | null>(null);
  let list = $state<HTMLDivElement | null>(null);

  const parsed = $derived(parseQuery(query));

  type Row = { kind: "note"; note: Note; indices: number[] } | { kind: "action"; action: Action } | { kind: "create"; title: string };

  const rows = $derived.by((): Row[] => {
    if (mode === "commands") {
      return actions
        .filter((a) => a.enabled !== false)
        .map((action) => ({ action, m: fuzzyMatch(parsed.text, action.label) }))
        .filter((x) => x.m.score > 0)
        .sort((a, b) => b.m.score - a.m.score)
        .map(({ action }) => ({ kind: "action", action }));
    }
    const tag = parsed.tag;
    const notes = store.notes
      .filter((n) => !tag || n.tags.some((t) => t.toLowerCase().startsWith(tag)))
      .map((note) => ({ note, m: fuzzyMatch(parsed.text, note.title || "Untitled") }))
      .filter((x) => x.m.score > 0)
      .sort((a, b) => b.m.score - a.m.score || b.note.opened.localeCompare(a.note.opened))
      .slice(0, 10)
      .map(({ note, m }): Row => ({ kind: "note", note, indices: m.indices }));
    const text = parsed.text;
    const exact = notes.some((r) => r.kind === "note" && r.note.title.trim().toLowerCase() === text.toLowerCase());
    if (text && !tag && !exact) notes.push({ kind: "create", title: text });
    return notes;
  });

  $effect(() => {
    rows;
    active = 0;
  });

  $effect(() => {
    input?.focus();
  });

  function choose(i: number, newWindow = false) {
    const row = rows[i];
    if (!row) return;
    if (row.kind === "note") {
      if (newWindow) store.openInWindow(row.note.id);
      else onjump(row.note.id);
    } else if (row.kind === "action") {
      row.action.run();
    } else {
      oncreate(row.title);
    }
    onclose();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = rows.length ? (active + 1) % rows.length : 0;
      scrollActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = rows.length ? (active - 1 + rows.length) % rows.length : 0;
      scrollActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active, e.metaKey || e.ctrlKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onclose();
    }
  }

  function scrollActive() {
    list?.children[active]?.scrollIntoView({ block: "nearest" });
  }

  /** Split a title into plain/highlighted runs for the matched indices. */
  function runs(text: string, indices: number[]): { s: string; hit: boolean }[] {
    const set = new Set(indices);
    const out: { s: string; hit: boolean }[] = [];
    for (let i = 0; i < text.length; i++) {
      const hit = set.has(i);
      if (out.length && out[out.length - 1].hit === hit) out[out.length - 1].s += text[i];
      else out.push({ s: text[i], hit });
    }
    return out;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Quick open" tabindex="-1">
    <div class="field">
      {#if mode === "commands"}
        <Terminal size={16} />
      {:else}
        <MagnifyingGlass size={16} />
      {/if}
      <input bind:this={input} bind:value={query} onkeydown={onKey} placeholder={mode === "commands" ? "Run a command…" : "Jump to a note…  #tag to filter"} spellcheck="false" />
      <span class="mode">{mode === "commands" ? "⇧⌘K" : "⌘K"}</span>
    </div>
    <div class="list" bind:this={list}>
      {#each rows as row, i (row.kind === "note" ? row.note.id : row.kind === "action" ? "a:" + row.action.label : "create")}
        {#if row.kind === "note"}
          {@const n = row.note}
          {@const wf = store.workflowOf(n)}
          <button class="ghost row" class:active={i === active} onmousedown={(e) => e.preventDefault()} onclick={() => choose(i)} onmouseenter={() => (active = i)}>
            <span class="title" class:done={store.isDone(n)}>
              {#if row.indices.length && !/[*_`\[\]~]/.test(n.title)}
                {#each runs(n.title || "Untitled", row.indices) as r, j (j)}<span class:hit={r.hit}>{r.s}</span>{/each}
              {:else}
                <InlineMd source={n.title} fallback="Untitled" />
              {/if}
            </span>
            <span class="meta">
              {#each n.tags.slice(0, 3) as tag (tag)}
                <span class="tag-chip tag" style="--tag:{store.tagColor(tag)}">{tag}</span>
              {/each}
              {#if n.workflow !== null}
                <span class="status" style="--c:{stageColor(wf, n.status)}"><span class="pip"></span>{n.status}</span>
              {:else if store.isDone(n)}
                <span class="status" style="--c:var(--green)"><span class="pip"></span>done</span>
              {/if}
            </span>
            {#if i === active}<span class="kbd" title="⌘↩ opens in a new window"><ArrowSquareOut size={12} /></span>{/if}
          </button>
        {:else if row.kind === "action"}
          <button class="ghost row" class:active={i === active} onmousedown={(e) => e.preventDefault()} onclick={() => choose(i)} onmouseenter={() => (active = i)}>
            <span class="aicon">{#if row.action.icon}<row.action.icon size={14} />{/if}</span>
            <span class="title">{row.action.label}</span>
            {#if row.action.hint}<span class="kbd">{row.action.hint}</span>{/if}
          </button>
        {:else}
          <button class="ghost row create" class:active={i === active} onmousedown={(e) => e.preventDefault()} onclick={() => choose(i)} onmouseenter={() => (active = i)}>
            <Plus size={13} /> Create “{row.title}”
          </button>
        {/if}
      {:else}
        <div class="empty">{mode === "commands" ? "No matching command" : "No notes yet"}</div>
      {/each}
    </div>
    <footer>
      <span><kbd>↑↓</kbd> navigate</span>
      <span><kbd>↩</kbd> {mode === "commands" ? "run" : "open"}</span>
      {#if mode === "notes"}
        <span><kbd>⌘↩</kbd> new window</span>
        <span><kbd>#</kbd> tag</span>
      {/if}
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: #00000088;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 15vh;
  }
  .dialog {
    width: 560px;
    max-width: calc(100vw - 40px);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--bg2);
    border-radius: 10px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    outline: none;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--color-dim);
  }
  .field input {
    flex: 1;
    font-size: 15px;
    background: transparent;
    border: none;
    padding: 4px 0;
    color: var(--color2);
  }
  .list {
    overflow-y: auto;
    padding: 6px;
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    text-align: left;
    color: var(--color);
    font-size: 13px;
  }
  .row.active {
    background: #ffffff10;
    color: var(--color2);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title.done {
    text-decoration: line-through;
    color: var(--color-dim);
  }
  .hit {
    color: var(--accent2);
    font-weight: 600;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }
  .tag {
    font-size: 10px;
    padding: 0 6px;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: var(--c);
  }
  .pip {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--c);
  }
  .aicon {
    width: 16px;
    display: inline-flex;
    justify-content: center;
    color: var(--color-dim);
    flex: none;
  }
  .mode {
    flex: none;
    font-size: 11px;
    color: var(--color-dim);
  }
  .kbd {
    flex: none;
    font-size: 11px;
    color: var(--color-dim);
  }
  .create {
    color: var(--accent2);
  }
  .empty {
    padding: 18px;
    text-align: center;
    color: var(--color-dim);
    font-size: 13px;
  }
  footer {
    display: flex;
    gap: 14px;
    padding: 6px 14px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--color-dim);
  }
  kbd {
    font-family: inherit;
    padding: 0 4px;
    border-radius: 3px;
    background: #ffffff0c;
    color: var(--color);
  }
</style>
