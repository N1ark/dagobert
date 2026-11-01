<script lang="ts">
  import { store } from "./store.svelte";
  import InlineMd from "./InlineMd.svelte";
  import { t } from "./i18n";

  /** The one way to link to a note from a list: a pill with its title, the selected one highlighted. */
  let { id, onjump = (id) => store.jump(id) }: { id: string; onjump?: (id: string) => void } = $props();

  const note = $derived(store.byId(id));
</script>

<button
  class="note-link"
  class:current={id === store.selectedId}
  aria-current={id === store.selectedId || undefined}
  onclick={() => onjump(id)}
>
  <InlineMd source={note?.title ?? ""} fallback={t("app.untitled")} />
</button>

<style>
  .note-link {
    display: inline-flex;
    padding: 0 var(--gap-3);
    font-size: var(--fs-micro);
    line-height: 1.5;
    border-radius: var(--radius-pill);
    background: var(--chip);
    color: var(--color);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note-link.current {
    background: var(--theme-mid);
    color: var(--color2);
  }
</style>
