<script lang="ts">
  import { store } from "./store.svelte";
  import type { Note } from "./types";
  import InlineMd from "./InlineMd.svelte";

  let {
    query,
    left,
    top,
    excludeId,
    onpick,
    oncreate,
  }: {
    query: string;
    left: number;
    top: number;
    excludeId: string;
    onpick: (n: Note) => void;
    oncreate: (title: string) => void;
  } = $props();

  let active = $state(0);

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return store.notes
      .filter((n) => n.id !== excludeId && n.title.trim())
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => {
        // Prefix matches first, then most recently opened.
        const ap = q && a.title.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = q && b.title.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || b.opened.localeCompare(a.opened);
      })
      .slice(0, 8);
  });
  const canCreate = $derived(query.trim().length > 0 && !results.some((n) => n.title.trim().toLowerCase() === query.trim().toLowerCase()));
  const count = $derived(results.length + (canCreate ? 1 : 0));

  $effect(() => {
    results;
    active = 0;
  });

  /** Returns true when the key was consumed. */
  export function handleKey(e: KeyboardEvent): boolean {
    if (e.key === "ArrowDown") {
      active = (active + 1) % Math.max(1, count);
      return true;
    }
    if (e.key === "ArrowUp") {
      active = (active - 1 + count) % Math.max(1, count);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      if (!count) return false;
      choose(active);
      return true;
    }
    return false;
  }

  function choose(i: number) {
    if (i < results.length) onpick(results[i]);
    else if (canCreate) oncreate(query.trim());
  }
</script>

{#if count}
  <div class="mention" style="left:{left}px; top:{top}px" role="listbox">
    {#each results as n, i (n.id)}
      <button
        class="ghost row"
        class:active={i === active}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => choose(i)}
        onmouseenter={() => (active = i)}
      >
        <span class="t" class:done={store.isDone(n)}><InlineMd source={n.title} /></span>
        {#if n.tags.length}<span class="tags">{n.tags.join(", ")}</span>{/if}
      </button>
    {/each}
    {#if canCreate}
      <button
        class="ghost row create"
        class:active={active === results.length}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => choose(results.length)}
        onmouseenter={() => (active = results.length)}
      >
        + Create “{query.trim()}”
      </button>
    {/if}
  </div>
{/if}

<style>
  .mention {
    position: absolute;
    z-index: 30;
    width: 280px;
    padding: 4px;
    background: var(--bg3);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    max-height: 260px;
    overflow-y: auto;
  }
  .row {
    width: 100%;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    text-align: left;
    color: var(--color);
    font-size: 13px;
  }
  .row.active {
    background: #ffffff10;
    color: var(--color2);
  }
  .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .t.done {
    text-decoration: line-through;
    color: var(--color-dim);
  }
  .tags {
    color: var(--color-dim);
    font-size: 11px;
    flex: none;
  }
  .create {
    color: var(--accent2);
  }
</style>
