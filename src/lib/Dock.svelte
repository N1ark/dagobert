<script lang="ts">
  import { getContext, setContext, type Snippet } from "svelte";
  import { DOCK, TILES, type DockHandle, type TilesHandle } from "./panes.svelte";
  import { registerOverlay } from "purr";
  import { PANE_LABEL, POPUP, type Pane, type Rect } from "./tiles";
  import { t } from "./i18n";

  /** One panel's frame: a tile of the layout, or popped up over it when it has no `rect`. */
  let { pane, rect = null, onclose, children }: { pane: Pane; rect?: Rect | null; onclose: () => void; children: Snippet } = $props();

  const tiles = getContext<TilesHandle | undefined>(TILES);
  if (tiles)
    setContext<DockHandle>(DOCK, {
      grab: (e) => tiles.grab(e, pane),
      toggle: (button) => tiles.toggle(button, pane),
    });

  let el = $state<HTMLDivElement | null>(null);
  const size = $derived(POPUP[pane]);

  /** The pane's own header drags it, like a title bar, wherever there's no control. */
  function onDown(e: PointerEvent) {
    const at = e.target as HTMLElement;
    if (!tiles || !el?.querySelector("header")?.contains(at)) return;
    if (!at.closest("button, input, select, textarea, a, label, [contenteditable]")) tiles.grab(e, pane);
  }

  // Popped up it is a modal: Escape closes it, if nothing is open above it.
  $effect(() => (rect ? undefined : registerOverlay(() => onclose())));
</script>

{#if !rect}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={onclose}></div>
{/if}

<div
  class="dock"
  class:popup={!rect}
  class:movable={!!tiles}
  class:fit={!rect && size.fit}
  style:left={rect && `${rect.x}px`}
  style:top={rect && `${rect.y}px`}
  style:width={rect ? `${rect.w}px` : `min(${size.w}px, 100vw - 40px)`}
  style:height={rect ? `${rect.h}px` : size.fit ? "fit-content" : `min(${size.h}px, 100vh - 80px)`}
  style:max-height={rect ? undefined : `min(${size.h}px, 100vh - 80px)`}
  role={rect ? undefined : "dialog"}
  aria-label={t(PANE_LABEL[pane])}
  aria-modal={rect ? undefined : "true"}
  bind:this={el}
  onpointerdown={onDown}
>
  {@render children()}
</div>

<style>
  .dock {
    position: absolute;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: var(--scrim);
  }
  .dock.popup {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    margin: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-modal);
  }
  /* The header is a title bar: it drags the panel wherever there's no control. */
  .movable > :global(* > header) {
    cursor: grab;
    transition: background var(--dur);
  }
  .movable > :global(* > header:hover:not(:has(:is(button, input, select, textarea, a, label, [contenteditable]):hover))) {
    background: var(--theme-soft);
  }
  /* Whatever is inside fills the dock. */
  .dock > :global(*) {
    flex: 1;
    min-height: 0;
    width: 100%;
  }
  /* Sized by its content: WebKit measures a zero basis or a 100% height as nothing. */
  .dock.fit > :global(*) {
    flex: 0 1 auto;
    height: auto;
  }
</style>
