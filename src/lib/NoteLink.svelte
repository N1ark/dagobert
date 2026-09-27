<script lang="ts">
  import { store } from "./store.svelte";
  import InlineMd from "./InlineMd.svelte";
  import { t } from "./i18n";

  /** The one way to link to a note from a list: a pill with its title, the selected one highlighted. */
  let { id, onjump = (id) => store.jump(id) }: { id: string; onjump?: (id: string) => void } = $props();

  const note = $derived(store.byId(id));
</script>

<button class="ghost note-link" class:current={id === store.selectedId} onclick={() => onjump(id)}>
  <InlineMd source={note?.title ?? ""} fallback={t("app.untitled")} />
</button>

<style>
  .note-link {
    padding: 0 6px;
    font-size: 10.5px;
    line-height: 1.5;
    border-radius: 999px;
    background: #ffffff0a;
    color: var(--color);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note-link.current {
    background: var(--accent-soft);
    color: var(--color2);
  }
</style>
