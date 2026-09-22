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
  /** Off-screen for the first frame, so it slides up rather than appearing. */
  let entering = $state(true);
  let leaving = $state(false);
  $effect(() => {
    // A frame later, so the browser paints the off-screen position first. The
    // timeout is the safety net: frames don't run while the app is backgrounded,
    // and the panel must not be stuck off-screen when it comes back.
    const frame = requestAnimationFrame(() => (entering = false));
    const timer = setTimeout(() => (entering = false), 100);
    return () => (cancelAnimationFrame(frame), clearTimeout(timer));
  });
  let y = $state<number | null>(null);
  let drag: { pointer: number; y: number; from: number; max: number; engaged: boolean; tap: boolean; el: HTMLElement } | null = null;

  /** Slides out before it's unmounted, so it leaves the way it arrived. */
  export function dismiss() {
    if (leaving) return;
    leaving = true;
    setTimeout(onclose, 220);
  }

  function cssPx(name: string, fallback: number) {
    const v = parseFloat(getComputedStyle(el ?? document.body).getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  }
  const topStop = () => cssPx("--sheet-top", 96);
  const peek = () => cssPx("--sheet-peek", 148);

  function begin(e: PointerEvent, engaged: boolean) {
    if (!el) return;
    const max = el.getBoundingClientRect().height;
    drag = {
      pointer: e.pointerId,
      y: e.clientY,
      from: full ? topStop() : max - peek(),
      max,
      engaged,
      tap: engaged,
      el: e.currentTarget as HTMLElement,
    };
    if (engaged) {
      y = drag.from;
      // Capturing before we know it's a drag would steal the click off whatever
      // was tapped, so content waits until the gesture commits.
      drag.el.setPointerCapture(e.pointerId);
    }
  }

  const onDown = (e: PointerEvent) => begin(e, true);

  /**
   * Anywhere that isn't a control drags the panel too, but only downwards and
   * only from the top of its scroll, so reading the contents still scrolls.
   */
  function onBodyDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [contenteditable], .grab")) return;
    const scroller = target.closest<HTMLElement>(".scroll, [data-scroll]") ?? scrollableAncestor(target);
    if (scroller && scroller.scrollTop > 0) return;
    begin(e, false);
  }

  function scrollableAncestor(from: HTMLElement | null): HTMLElement | null {
    for (let n = from; n && n !== el; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 1 && getComputedStyle(n).overflowY !== "visible") return n;
    }
    return null;
  }

  function onMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const dy = e.clientY - drag.y;
    if (!drag.engaged) {
      // Upwards means they meant to scroll the contents; let go of the gesture.
      if (dy < -6) return void (drag = null);
      if (dy < 8) return;
      drag.engaged = true;
      drag.el.setPointerCapture(e.pointerId);
    }
    y = Math.max(topStop(), Math.min(drag.max, drag.from + dy));
  }

  function onUp(e: PointerEvent) {
    if (!drag) return;
    const { max, from } = drag;
    const at = y ?? from;
    const tapped = drag.tap && Math.abs(e.clientY - drag.y) < 6;
    const engaged = drag.engaged;
    drag = null;
    y = null;
    if (tapped) {
      full = !full;
      return;
    }
    // A tap on the contents is theirs, not a gesture on the panel.
    if (!engaged) return;
    // Settle on whichever stop it was left nearest.
    const stops = [topStop(), max - peek(), max];
    const nearest = stops.reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a));
    if (nearest === max) dismiss();
    else full = nearest === topStop();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="sheet"
  class:full
  class:off={entering || leaving}
  class:dragging={y !== null}
  style={y === null ? undefined : `transform: translateY(${y}px)`}
  bind:this={el}
  onpointerdown={onBodyDown}
  onpointermove={onMove}
  onpointerup={onUp}
  onpointercancel={onUp}
>
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
    top: 0;
    /* Pulled in from the edges so the rounded top corners are fully on screen
       rather than dying into the side of the display. */
    left: max(2px, var(--safe-left));
    right: max(2px, var(--safe-right));
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
  .sheet.off,
  .sheet.off.full {
    transform: translateY(100%);
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
