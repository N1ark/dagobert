<script lang="ts">
  import { TAG_PALETTE } from "./tags";

  /** Swatch popover. `value` is the current colour; `onpick(null)` means "automatic". */
  let {
    value,
    onpick,
    onclose,
    allowAuto = false,
    label = "colour",
  }: {
    value: string | null;
    onpick: (color: string | null) => void;
    onclose: () => void;
    allowAuto?: boolean;
    label?: string;
  } = $props();

  function onWindowPointerDown(e: PointerEvent) {
    if (!(e.target as HTMLElement).closest(".color-picker")) onclose();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }
  function pick(c: string | null) {
    onpick(c);
    onclose();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onKey} />

<div class="color-picker" role="listbox" aria-label={label}>
  {#each TAG_PALETTE as color (color)}
    <button class="swatch" class:active={color === value} style="--c:{color}" aria-label={color} onclick={() => pick(color)}></button>
  {/each}
  {#if allowAuto}
    <button class="swatch auto" class:active={value === null} title="Automatic" aria-label="automatic" onclick={() => pick(null)}></button>
  {/if}
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
    transition:
      transform 0.1s,
      border-color 0.1s;
  }
  .swatch:hover {
    transform: scale(1.15);
    background: var(--c);
  }
  .swatch.active {
    border-color: var(--color2);
  }
  .swatch.auto {
    background: conic-gradient(var(--color-dim), var(--yellow), var(--green), var(--color-dim));
    opacity: 0.8;
  }
</style>
