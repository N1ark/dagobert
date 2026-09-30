<script lang="ts">
  import { onEscape, rank } from "purr";
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

  // Best match first, then most recently edited.
  const results = $derived(
    rank(
      store.notes.filter((n) => !exclude.has(n.id) && filter(n)).sort((a, b) => b.modified.localeCompare(a.modified)),
      query,
      { keys: [(n) => n.title, (n) => n.tags.join(" ")], limit: 8 },
    ).map((r) => r.item),
  );

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
    } else
      onEscape(e, () => {
        open = false;
        input.blur();
      });
  }
</script>

<div class="picker">
  <input
    class="field-input"
    bind:this={input}
    bind:value={query}
    {placeholder}
    onfocus={() => (open = true)}
    onblur={() => setTimeout(() => (open = false), 120)}
    onkeydown={onKey}
  />
  {#if open && results.length}
    <ul class="results surface">
      {#each results as n, i (n.id)}
        <li>
          <button
            class="row-item"
            class:is-cursor={i === active}
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
    <ul class="results surface"><li class="none">{t("picker.noMatches")}</li></ul>
  {/if}
</div>

<style>
  .picker {
    position: relative;
  }
  .results {
    position: absolute;
    z-index: var(--z-popover);
    left: 0;
    right: 0;
    top: calc(100% + var(--gap-2));
    margin: 0;
    padding: var(--gap-2);
    list-style: none;
    max-height: 240px;
    overflow-y: auto;
    box-shadow: var(--shadow-lg);
  }
  .results button {
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
  .none {
    padding: var(--gap-3) var(--sp-4);
    color: var(--faint);
    font-size: var(--fs-sm);
  }
</style>
