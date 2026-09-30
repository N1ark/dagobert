<script lang="ts">
  import { getContext } from "svelte";
  import { IconButton, menu } from "purr";
  import { Layout } from "purr/icons";
  import { DOCK, type DockHandle } from "./panes.svelte";
  import { t } from "./i18n";

  /** A panel header's handle on its dock: drag it to move the panel, click it to pick a place. */
  const dock = getContext<DockHandle | undefined>(DOCK);
  let el = $state<HTMLButtonElement | null>(null);
</script>

{#if dock}
  <IconButton
    label={t("dock.move")}
    tip={t("dock.move.tip")}
    class="dock-button"
    aria-expanded={menu.open && !!el && menu.anchor === el}
    onpointerdown={dock.grab}
    onclick={(e) => {
      el = e.currentTarget;
      dock.toggle(e.currentTarget);
    }}><Layout /></IconButton
  >
{/if}
