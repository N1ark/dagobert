<script lang="ts">
  import { rank } from "purr";
  import { store } from "./store.svelte";
  import type { Note } from "./types";
  import InlineMd from "./InlineMd.svelte";
  import { t } from "./i18n";

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

  // Best match first, then most recently edited.
  const results = $derived(
    rank(
      store.notes.filter((n) => n.id !== excludeId && n.title.trim()).sort((a, b) => b.modified.localeCompare(a.modified)),
      query,
      { keys: [(n) => n.title, (n) => n.tags.join(" ")], limit: 8 },
    ).map((r) => r.item),
  );
  const canCreate = $derived(query.trim().length > 0 && !results.some((n) => n.title.trim().toLowerCase() === query.trim().toLowerCase()));
  const count = $derived(results.length + (canCreate ? 1 : 0));

  $effect(() => {
    void results;
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
  <div class="mention surface" style="left:{left}px; top:{top}px" role="listbox">
    {#each results as n, i (n.id)}
      <button
        class="row-item row"
        class:is-cursor={i === active}
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
        class="row-item row create"
        class:is-cursor={active === results.length}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => choose(results.length)}
        onmouseenter={() => (active = results.length)}
      >
        {t("editor.mention.create", { title: query.trim() })}
      </button>
    {/if}
  </div>
{/if}

<style>
  .mention {
    position: absolute;
    z-index: var(--z-popover);
    width: 280px;
    padding: var(--gap-2);
    max-height: 260px;
    overflow-y: auto;
    box-shadow: var(--shadow-lg);
  }
  .row {
    justify-content: space-between;
  }
  .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .t.done {
    text-decoration: line-through;
    color: var(--muted);
  }
  .tags {
    color: var(--muted);
    font-size: var(--fs-micro);
    flex: none;
  }
  .create {
    color: var(--theme2);
  }
</style>
