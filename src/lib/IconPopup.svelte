<script lang="ts">
  import { rank } from "purr";
  import { iconGlyph, iconNames } from "./icons.svelte";

  /** The `:name` autocomplete; the parent forwards keys via `handleKey`. */
  let { query, left, top, onpick }: { query: string; left: number; top: number; onpick: (name: string) => void } = $props();

  let active = $state(0);

  const results = $derived(rank(iconNames, query, { keys: [(n) => n], limit: 8 }).map((r) => r.item));

  $effect(() => {
    void results;
    active = 0;
  });

  /** Returns true when the key was consumed. */
  export function handleKey(e: KeyboardEvent): boolean {
    if (!results.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      onpick(results[active]);
      return true;
    }
    return false;
  }
</script>

{#if results.length}
  <div class="icons surface" style="left:{left}px; top:{top}px" role="listbox">
    {#each results as name, i (name)}
      {@const Icon = iconGlyph(name)}
      <button
        class="row-item"
        class:is-cursor={i === active}
        role="option"
        aria-selected={i === active}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => onpick(name)}
        onmouseenter={() => (active = i)}
      >
        <span class="glyph"
          >{#if Icon}<Icon />{/if}</span
        >
        <span class="name truncate">{name}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .icons {
    position: absolute;
    z-index: var(--z-popover);
    width: 240px;
    padding: var(--gap-2);
    box-shadow: var(--shadow-lg);
  }
  .glyph {
    display: inline-flex;
    flex: none;
    width: 1em;
    height: 1em;
    font-size: var(--fs-lg);
  }
</style>
