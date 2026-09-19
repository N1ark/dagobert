<script lang="ts">
  /** Small radial progress for tracking issues. */
  let { done, total, size = 15 }: { done: number; total: number; size?: number } = $props();

  const r = $derived(size / 2 - 2);
  const c = $derived(2 * Math.PI * r);
  const frac = $derived(total ? done / total : 0);
  const complete = $derived(total > 0 && done === total);
</script>

<svg
  class="ring"
  class:complete
  class:empty={!total}
  width={size}
  height={size}
  viewBox="0 0 {size} {size}"
  aria-label="{done} of {total} done"
>
  <circle class="track" cx={size / 2} cy={size / 2} {r} />
  <circle
    class="fill"
    cx={size / 2}
    cy={size / 2}
    {r}
    stroke-dasharray={c}
    stroke-dashoffset={c * (1 - frac)}
    transform="rotate(-90 {size / 2} {size / 2})"
  />
</svg>

<style>
  .ring {
    flex: none;
    display: block;
  }
  .track {
    fill: none;
    stroke: #333;
    stroke-width: 2.5;
  }
  .empty .track {
    stroke-dasharray: 2 2;
  }
  .fill {
    fill: none;
    stroke: var(--accent2);
    stroke-width: 2.5;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.3s;
  }
  .complete .fill {
    stroke: var(--green);
  }
</style>
