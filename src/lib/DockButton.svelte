<script lang="ts">
  import { getContext } from "svelte";
  import { DOCK, type DockHandle } from "./panes.svelte";
  import { t } from "./i18n";
  import { tooltip } from "./tooltip";
  import Layout from "phosphor-svelte/lib/Layout";

  /** A panel header's handle on its dock: drag it to move the panel, click it to pick a place. */
  const dock = getContext<DockHandle | undefined>(DOCK);
</script>

{#if dock}
  <button
    class="ghost icon dock-button"
    class:on={dock.open}
    aria-label={t("dock.move")}
    use:tooltip={t("dock.move.tip")}
    onpointerdown={dock.grab}
    onclick={(e) => dock.toggle(e.currentTarget)}><Layout size={15} /></button
  >
{/if}

<style>
  .on {
    color: var(--accent2);
  }
</style>
