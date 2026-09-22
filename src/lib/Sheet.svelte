<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "./i18n";

  /**
   * The one panel a phone shows at a time: a note, the pull requests or the
   * settings. Always full height and slid down by a transform, so dragging it
   * moves it on the compositor rather than re-laying out its contents. It stops
   * short of the top bar so the thumb and the panel's own header stay clear of
   * the status bar.
   */
  let { full = $bindable(false), onclose, children }: { full?: boolean; onclose: () => void; children: Snippet } = $props();

  let el = $state<HTMLDivElement | null>(null);
  let y = $state<number | null>(null);
  let drag: { pointer: number; y: number; from: number; max: number } | null = null;

  function cssPx(name: string, fallback: number) {
    const v = parseFloat(getComputedStyle(el ?? document.body).getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  }
  const topStop = () => cssPx("--sheet-top", 96);
  const peek = () => cssPx("--sheet-peek", 148);

  function onDown(e: PointerEvent) {
    if (!el) return;
    const max = el.getBoundingClientRect().height;
    drag = { pointer: e.pointerId, y: e.clientY, from: full ? topStop() : max - peek(), max };
    y = drag.from;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    y = Math.max(topStop(), Math.min(drag.max, drag.from + (e.clientY - drag.y)));
  }

  function onUp(e: PointerEvent) {
    if (!drag) return;
    const { max, from } = drag;
    const at = y ?? from;
    const tapped = Math.abs(e.clientY - drag.y) < 6;
    drag = null;
    y = null;
    if (tapped) {
      full = !full;
      return;
    }
    // Settle on whichever stop it was left nearest.
    const stops = [topStop(), max - peek(), max];
    const nearest = stops.reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a));
    if (nearest === max) onclose();
    else full = nearest === topStop();
  }
</script>

<div class="sheet" class:full class:dragging={y !== null} style={y === null ? undefined : `transform: translateY(${y}px)`} bind:this={el}>
  <button
    class="grab"
    aria-label={t(full ? "panel.sheet.collapse" : "panel.sheet.expand")}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
  ></button>
  {@render children()}
</div>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    position: fixed;
    inset: 0;
    bottom: var(--kb, 0px);
    z-index: 6;
    background: var(--bg2);
    border-top: 1px solid var(--border2);
    border-radius: 12px 12px 0 0;
    box-shadow: var(--shadow-lg);
    padding-bottom: var(--safe-bottom);
    transform: translateY(calc(100% - var(--sheet-peek)));
    transition: transform 0.22s ease;
    will-change: transform;
    overflow: hidden;
  }
  .sheet.full {
    transform: translateY(var(--sheet-top));
  }
  .sheet.dragging {
    transition: none;
  }
  .grab {
    flex: none;
    align-self: center;
    width: 44px;
    height: 20px;
    padding: 0;
    background: none;
    border: none;
    touch-action: none;
  }
  .grab::before {
    content: "";
    display: block;
    width: 36px;
    height: 4px;
    margin: 8px auto;
    border-radius: 2px;
    background: var(--border2);
  }
  /* Whatever is inside fills what's left, and starts at the top. */
  .sheet :global(> :not(.grab)) {
    flex: 1;
    min-height: 0;
    width: 100%;
  }
</style>
