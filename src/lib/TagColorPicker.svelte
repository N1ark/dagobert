<script lang="ts">
  import { store } from "./store.svelte";
  import { TAG_PALETTE } from "./tags";

  let { tag, onclose }: { tag: string; onclose: () => void } = $props();

  const current = $derived(store.tagColor(tag));

  function onWindowPointerDown(e: PointerEvent) {
    if (!(e.target as HTMLElement).closest(".color-picker")) onclose();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onKey} />

<div class="color-picker" role="listbox" aria-label="tag colour">
  {#each TAG_PALETTE as color (color)}
    <button
      class="swatch"
      class:active={color === current}
      style="--c:{color}"
      aria-label={color}
      onclick={() => {
        store.setTagColor(tag, color);
        onclose();
      }}
    ></button>
  {/each}
</div>

<style>
  .color-picker {
    position: absolute;
    z-index: 20;
    top: calc(100% + 6px);
    left: 0;
    display: grid;
    grid-template-columns: repeat(5, 18px);
    gap: 6px;
    padding: 8px;
    background: var(--bg3);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
  }
  .swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid transparent;
    background: var(--c);
    transition: transform 0.1s, border-color 0.1s;
  }
  .swatch:hover {
    transform: scale(1.15);
    background: var(--c);
  }
  .swatch.active {
    border-color: var(--color2);
  }
</style>
