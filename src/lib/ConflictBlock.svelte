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
    <button class="sm" onclick={(e) => (stop(e), onresolve("mine"))}>{t("conflict.keepMine")}</button>
    <button class="sm" onclick={(e) => (stop(e), onresolve("theirs"))}>{t("conflict.keepTheirs")}</button>
    <button class="ghost sm" onclick={(e) => (stop(e), onresolve("both"))}>{t("conflict.keepBoth")}</button>
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
    border: 1px solid var(--yellow);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .bar {
    -webkit-user-select: none;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: #e5c07b18;
    font-size: 11px;
  }
  .label {
    color: var(--yellow);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .spacer {
    flex: 1;
  }
  .sm {
    padding: 2px 8px;
    font-size: 11px;
  }
  .pane {
    min-width: 0;
    padding: 4px 8px;
  }
  .pane.mine {
    border-bottom: 1px solid var(--border);
  }
  .side {
    -webkit-user-select: none;
    user-select: none;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-dim);
  }
</style>
