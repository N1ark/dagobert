<script lang="ts">
  import Markdown from "./Markdown.svelte";
  import { conflictSides } from "./blocks";
  import { t } from "./i18n";

  /** A `<<<<<<<` … `>>>>>>>` region: both sides rendered, with buttons to pick. */
  let {
    block,
    onresolve,
    onedit,
  }: { block: string; onresolve: (keep: "mine" | "theirs" | "both") => void; onedit: (e: MouseEvent) => void } = $props();

  const sides = $derived(conflictSides(block));
  const stop = (e: MouseEvent) => e.stopPropagation();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="conflict" onclick={onedit}>
  <div class="bar">
    <span class="label">{t("conflict.title")}</span>
    <span class="spacer"></span>
    <button class="btn btn--sm" onclick={(e) => (stop(e), onresolve("mine"))}>{t("conflict.keepMine")}</button>
    <button class="btn btn--sm" onclick={(e) => (stop(e), onresolve("theirs"))}>{t("conflict.keepTheirs")}</button>
    <button class="btn btn--ghost btn--sm" onclick={(e) => (stop(e), onresolve("both"))}>{t("conflict.keepBoth")}</button>
  </div>
  <div class="panes">
    <div class="pane mine">
      <div class="side">{t("conflict.mine")}</div>
      <Markdown source={sides.mine} />
    </div>
    <div class="pane theirs">
      <div class="side">{t("conflict.theirs")}</div>
      <Markdown source={sides.theirs} />
    </div>
  </div>
</div>

<style>
  .conflict {
    margin: 0.3em 0;
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .bar {
    -webkit-user-select: none;
    user-select: none;
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    padding: var(--gap-2) var(--gap-4);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    font-size: var(--fs-micro);
  }
  .label {
    color: var(--warn);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .spacer {
    flex: 1;
  }
  .pane {
    min-width: 0;
    padding: var(--gap-2) var(--gap-4);
  }
  .pane.mine {
    border-bottom: 1px solid var(--border);
  }
  .side {
    -webkit-user-select: none;
    user-select: none;
    font-size: var(--fs-nano);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
</style>
