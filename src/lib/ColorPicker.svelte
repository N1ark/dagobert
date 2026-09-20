<script lang="ts">
  import { normalizeColor, TAG_PALETTE } from "./tags";
  import { store } from "./store.svelte";
  import Plus from "phosphor-svelte/lib/Plus";

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

  let input: HTMLInputElement;

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
  /** Swatch this panel session added to the palette, so tuning replaces it rather than piling up entries. */
  let added: string | null = null;

  /** The native colour input fires `input` while dragging and `change` per click (WebKit fires both for
   *  every selection), so neither closes the popover; the colour is applied live and the popover stays
   *  open until the user dismisses it. */
  function preview() {
    onpick(input.value);
  }
  function commit() {
    const c = normalizeColor(input.value);
    if (!c) return;
    if (added && added !== c) {
      store.removePaletteColor(added);
      added = null;
    }
    const existed = TAG_PALETTE.includes(c) || store.palette.includes(c);
    store.addPaletteColor(c);
    if (!existed) added = c;
    onpick(c);
  }
  function remove(e: MouseEvent, c: string) {
    e.preventDefault();
    store.removePaletteColor(c);
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onKey} />

<div class="color-picker" role="listbox" aria-label={label}>
  {#each TAG_PALETTE as color (color)}
    <button class="swatch" class:active={color === value} style="--c:{color}" aria-label={color} onclick={() => pick(color)}></button>
  {/each}
  {#each store.palette as color (color)}
    <button
      class="swatch"
      class:active={color === value}
      style="--c:{color}"
      title="{color} (right-click to remove from palette)"
      aria-label={color}
      onclick={() => pick(color)}
      oncontextmenu={(e) => remove(e, color)}
    ></button>
  {/each}
  {#if allowAuto}
    <button class="swatch auto" class:active={value === null} title="Automatic" aria-label="automatic" onclick={() => pick(null)}></button>
  {/if}
  <span class="add-wrap">
    <span class="swatch add" aria-hidden="true">
      <Plus size={11} weight="bold" />
    </span>
    <input
      bind:this={input}
      type="color"
      value={value ?? TAG_PALETTE[0]}
      oninput={preview}
      onchange={commit}
      title="Custom colour…"
      aria-label="add a custom colour"
    />
  </span>
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
  /* The native colour panel anchors to the input, so the input sits exactly over the swatch. */
  .add-wrap {
    position: relative;
    width: 18px;
    height: 18px;
  }
  .swatch.add {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    background: transparent;
    border: 1px dashed var(--color-dim);
    color: var(--color-dim);
  }
  .add-wrap:hover .swatch.add {
    transform: scale(1.15);
    border-color: var(--color2);
    color: var(--color2);
  }
  input[type="color"] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: pointer;
  }
</style>
