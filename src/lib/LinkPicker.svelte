<script lang="ts">
  import { store } from "./store.svelte";
  import type { Note } from "./types";
  import InlineMd from "./InlineMd.svelte";
  import { t } from "./i18n";

  let {
    exclude,
    filter,
    placeholder,
    onpick,
    autofocus = false,
  }: {
    exclude: Set<string>;
    filter: (n: Note) => boolean;
    placeholder: string;
    onpick: (id: string) => void;
    autofocus?: boolean;
  } = $props();

  $effect(() => {
    if (autofocus) input?.focus();
  });

  let query = $state("");
  let open = $state(false);
  let active = $state(0);
  let input: HTMLInputElement;

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return store.notes
      .filter((n) => !exclude.has(n.id) && filter(n))
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => b.modified.localeCompare(a.modified))
      .slice(0, 8);
  });

  $effect(() => {
    void results;
    active = 0;
  });

  function pick(id: string) {
    onpick(id);
    query = "";
    open = false;
    input?.blur();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(active + 1, results.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) pick(results[active].id);
    } else if (e.key === "Escape") {
      open = false;
      input.blur();
    }
  }
</script>

<div class="picker">
  <input
    bind:this={input}
    bind:value={query}
    {placeholder}
    onfocus={() => (open = true)}
    onblur={() => setTimeout(() => (open = false), 120)}
    onkeydown={onKey}
  />
  {#if open && results.length}
    <ul class="results">
      {#each results as n, i (n.id)}
        <li>
          <button
            class="ghost"
            class:active={i === active}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => pick(n.id)}
            onmouseenter={() => (active = i)}
          >
            <span class="t" class:done={store.isDone(n)}><InlineMd source={n.title} fallback={t("app.untitled")} /></span>
            {#if n.tags.length}<span class="tags">{n.tags.join(", ")}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else if open && query}
    <ul class="results"><li class="none">{t("picker.noMatches")}</li></ul>
  {/if}
</div>

<style>
  .picker {
    position: relative;
  }
  input {
    width: 100%;
    font-size: 13px;
  }
  .results {
    -webkit-user-select: none;
    user-select: none;
    position: absolute;
    z-index: 5;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--bg3);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    max-height: 240px;
    overflow-y: auto;
  }
  .results button {
    width: 100%;
    text-align: left;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: var(--color);
  }
  .results button.active {
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
  .none {
    padding: 6px 10px;
    color: #555;
    font-size: 13px;
  }
</style>
