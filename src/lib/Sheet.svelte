<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "./i18n";

  /** The one panel a phone shows at a time, slid down by a transform so dragging stays on the GPU. */
  let { full = $bindable(false), onclose, children }: { full?: boolean; onclose: () => void; children: Snippet } = $props();

  let el = $state<HTMLDivElement | null>(null);
  /** Off-screen for the first frame, so it slides up rather than appearing. */
  let entering = $state(true);
  let leaving = $state(false);
  $effect(() => {
    // A frame later, so the off-screen position is painted first; the timer covers a lost frame.
    const frame = requestAnimationFrame(() => (entering = false));
    const timer = setTimeout(() => (entering = false), 100);
    return () => (cancelAnimationFrame(frame), clearTimeout(timer));
  });
  let y = $state<number | null>(null);
  /** The three stops, read once per gesture: full, peek, and gone. */
  let stops = $state<{ top: number; peek: number; max: number } | null>(null);
  let drag: {
    pointer: number;
    y: number;
    from: number;
    engaged: boolean;
    tap: boolean;
    el: HTMLElement;
    at: number;
    lastY: number;
    v: number;
  } | null = null;

  /** Past this, a flick decides the stop rather than where the finger let go. */
  const FLING = 0.45; // px/ms
  /** How far the sheet gives above its top stop before it stops moving at all. */
  const RUBBER = 32;

  /** How dimmed the canvas behind is: nothing at the peek, fully at the top. */
  const dim = $derived.by(() => {
    if (entering || leaving) return 0;
    if (y === null || !stops) return full ? 1 : 0;
    const span = Math.max(1, stops.peek - stops.top);
    return Math.max(0, Math.min(1, (stops.peek - y) / span));
  });

  /** How far the bottom bar rides up, so it follows the sheet frame by frame. */
  const lift = $derived.by(() => {
    const peek = cssPx("--sheet-peek", 148);
    if (entering || leaving) return 0;
    if (y === null || !stops) return peek;
    return Math.max(0, Math.min(peek, stops.max - y));
  });

  $effect(() => {
    const s = document.documentElement.style;
    s.setProperty("--sheet-lift", `${lift}px`);
    s.setProperty("--sheet-dim", `${dim}`);
    document.body.classList.toggle("sheet-dragging", y !== null);
    return () => {
      s.removeProperty("--sheet-lift");
      s.removeProperty("--sheet-dim");
      document.body.classList.remove("sheet-dragging");
    };
  });

  /** Slides out before it's unmounted, so it leaves the way it arrived. */
  export function dismiss() {
    if (leaving) return;
    leaving = true;
    y = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      onclose();
    };
    // Whichever comes first: the slide finishing, or the app never painting it.
    const timer = setTimeout(finish, 600);
    el?.addEventListener("transitionend", (e) => (e as TransitionEvent).propertyName === "transform" && finish());
  }

  function cssPx(name: string, fallback: number) {
    const v = parseFloat(getComputedStyle(el ?? document.body).getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  }

  /** Where the sheet actually is, transition included, so a re-grab never jumps. */
  function currentY(fallback: number) {
    if (!el) return fallback;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return Number.isFinite(m.m42) ? m.m42 : fallback;
  }

  function begin(e: PointerEvent, engaged: boolean) {
    if (!el || leaving) return;
    const max = el.getBoundingClientRect().height;
    stops = { top: cssPx("--sheet-top", 96), peek: max - cssPx("--sheet-peek", 148), max };
    const from = currentY(full ? stops.top : stops.peek);
    drag = {
      pointer: e.pointerId,
      y: e.clientY,
      from,
      engaged,
      tap: engaged,
      el: e.currentTarget as HTMLElement,
      at: e.timeStamp,
      lastY: e.clientY,
      v: 0,
    };
    // Freeze it where it is: a gesture that starts mid-transition picks it up there.
    y = from;
    if (engaged) {
      // Content waits for the gesture to commit: capturing early steals the tap.
      drag.el.setPointerCapture(e.pointerId);
    }
  }

  const onDown = (e: PointerEvent) => begin(e, true);

  /** Anything but a control drags the panel, but only from the top of its scroll. */
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

  /** Past the top stop the sheet gives a little and then stops: iOS's rubber band. */
  const resist = (over: number) => (over * RUBBER) / (over + RUBBER);

  function onMove(e: PointerEvent) {
    if (!drag || !stops || e.pointerId !== drag.pointer) return;
    const dy = e.clientY - drag.y;
    if (!drag.engaged) {
      // Upwards means they meant to scroll the contents; let go of the gesture.
      if (dy < -6) return void ((drag = null), (y = null));
      if (dy < 8) return;
      drag.engaged = true;
      drag.at = e.timeStamp;
      drag.lastY = e.clientY;
      drag.el.setPointerCapture(e.pointerId);
    }
    const dt = e.timeStamp - drag.at;
    // Smoothed, so one stuttering frame at the end can't decide the whole gesture.
    if (dt > 0) {
      drag.v = 0.7 * ((e.clientY - drag.lastY) / dt) + 0.3 * drag.v;
      drag.at = e.timeStamp;
      drag.lastY = e.clientY;
    }
    const to = drag.from + dy;
    y = to < stops.top ? stops.top - resist(stops.top - to) : Math.min(stops.max, to);
  }

  function onUp(e: PointerEvent) {
    if (!drag || !stops) return;
    const { max, top, peek } = stops;
    const at = y ?? drag.from;
    const tapped = drag.tap && Math.abs(e.clientY - drag.y) < 6;
    const { engaged } = drag;
    // A finger that came to rest before lifting was placing the sheet, not throwing it.
    const v = e.timeStamp - drag.at > 80 ? 0 : drag.v;
    drag = null;
    y = null;
    if (tapped) {
      full = !full;
      return;
    }
    // A tap on the contents is theirs, not a gesture on the panel.
    if (!engaged) return;
    const ordered = [top, peek, max];
    // A flick carries to the next stop the way it was thrown; a slow drag settles on the nearest.
    const target =
      Math.abs(v) > FLING
        ? v > 0
          ? (ordered.find((s) => s > at + 1) ?? max)
          : ([...ordered].reverse().find((s) => s < at - 1) ?? top)
        : ordered.reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a));
    if (target === max) dismiss();
    else full = target === top;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="scrim" class:hit={dim > 0.05} class:dragging={y !== null} style="opacity:{dim * 0.45}" onpointerdown={dismiss}></div>

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
  .scrim {
    z-index: 5;
  }
  .sheet {
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0;
    /* Flush with the edges; the safe-area insets are only non-zero in landscape. */
    left: var(--safe-left);
    right: var(--safe-right);
    bottom: var(--kb, 0px);
    z-index: 6;
    background: var(--bg2);
    border-top: 1px solid var(--border2);
    border-radius: 12px 12px 0 0;
    box-shadow: var(--shadow-lg);
    /* The sheet is a whole viewport tall and slid down, so its last
       `--sheet-top` pixels sit below the screen even at the top stop. */
    padding-bottom: calc(var(--safe-bottom) + var(--sheet-top));
    transform: translateY(calc(100% - var(--sheet-peek)));
    transition: transform var(--dur-sheet) var(--ease-sheet);
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
  /* Whatever is inside fills what's left, and starts at the top. */
  .sheet :global(> :not(.grab)) {
    flex: 1;
    min-height: 0;
    width: 100%;
  }
</style>
