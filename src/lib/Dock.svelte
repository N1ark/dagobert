<script lang="ts">
  import { getContext, setContext, type Snippet } from "svelte";
  import { DOCK, TILES, type DockHandle, type TilesHandle } from "./panes.svelte";
  import { POPUP, type Pane, type Rect } from "./tiles";
  import { onEscape } from "./keys";
  import { t, type Key } from "./i18n";

  /** One panel's frame: a tile of the layout, or popped up over it when it has no `rect`. */
  let { pane, rect = null, onclose, children }: { pane: Pane; rect?: Rect | null; onclose: () => void; children: Snippet } = $props();

  const LABEL: Record<Pane, Key> = { note: "menu.note", prs: "prs.title", trash: "trash.title", settings: "settings.aria" };

  const tiles = getContext<TilesHandle | undefined>(TILES);
  if (tiles)
    setContext<DockHandle>(DOCK, {
      grab: (e) => tiles.grab(e, pane),
      toggle: (button) => tiles.toggle(button, pane),
      get open() {
        return tiles.menu === pane;
      },
    });

  let el = $state<HTMLDivElement | null>(null);
  let backdrop = $state<HTMLDivElement | null>(null);
  const size = $derived(POPUP[pane]);

  /** The pane's own header drags it, like a title bar, wherever there's no control. */
  function onDown(e: PointerEvent) {
    const at = e.target as HTMLElement;
    if (!tiles || !el?.querySelector("header")?.contains(at)) return;
    if (!at.closest("button, input, select, textarea, a, label, [contenteditable]")) tiles.grab(e, pane);
  }

  function onKey(e: KeyboardEvent) {
    if (rect || e.defaultPrevented) return;
    // Only the topmost modal takes the Escape.
    const all = document.querySelectorAll(".backdrop");
    if (all[all.length - 1] === backdrop) onEscape(e, onclose);
  }
</script>

<svelte:window onkeydown={onKey} />

{#if !rect}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" bind:this={backdrop} onclick={onclose}></div>
{/if}

<div
  class="dock"
  class:popup={!rect}
  style:left={rect && `${rect.x}px`}
  style:top={rect && `${rect.y}px`}
  style:width={rect ? `${rect.w}px` : `min(${size.w}px, 100vw - 40px)`}
  style:height={rect ? `${rect.h}px` : size.fit ? "fit-content" : `min(${size.h}px, 100vh - 80px)`}
  style:max-height={rect ? undefined : `min(${size.h}px, 100vh - 80px)`}
  role={rect ? undefined : "dialog"}
  aria-label={t(LABEL[pane])}
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
    background: var(--bg2);
  }
  .dock.popup {
    position: fixed;
    inset: 0;
    z-index: 50;
    margin: auto;
    border-radius: 10px;
    box-shadow: var(--shadow-lg);
  }
  /* Whatever is inside fills the dock. */
  .dock > :global(*) {
    flex: 1;
    min-height: 0;
    width: 100%;
  }
</style>
