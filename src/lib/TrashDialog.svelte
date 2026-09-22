<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "./store.svelte";
  import { relative, absolute } from "./time";
  import InlineMd from "./InlineMd.svelte";
  import X from "phosphor-svelte/lib/X";
  import ArrowCounterClockwise from "phosphor-svelte/lib/ArrowCounterClockwise";
  import Trash from "phosphor-svelte/lib/Trash";
  import { t, plural } from "./i18n";

  let { onclose, onrestored, sheet = false }: { onclose: () => void; onrestored: (id: string) => void; sheet?: boolean } = $props();

  let confirmEmpty = $state(false);
  let loading = $state(true);

  onMount(async () => {
    await store.loadTrash();
    loading = false;
  });

  async function restore(file: string) {
    await store.restoreNote(file);
    if (store.selectedId) onrestored(store.selectedId);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#snippet panel()}
  <header>
    <h3>{t("trash.title")} <span class="count">{store.trash.length}</span></h3>
    {#if !sheet}
      <button class="ghost" onclick={onclose} aria-label={t("trash.close")}><X size={16} /></button>
    {/if}
  </header>
  <div class="list">
    {#if loading}
      <p class="empty">{t("trash.loading")}</p>
    {:else if !store.trash.length}
      <p class="empty"><InlineMd source={t("trash.empty")} /></p>
    {:else}
      <ul>
        {#each store.trash as n (n.file)}
          <li>
            <div class="info">
              <div class="title" class:untitled={!n.title}><InlineMd source={n.title} fallback={t("app.untitled")} /></div>
              <div class="sub">
                {#if n.tags.length}
                  {#each n.tags as tag (tag)}
                    <span class="tag-chip tag" style="--tag:{store.tagColor(tag)}">{tag}</span>
                  {/each}
                {/if}
                <span title={n.deleted ? absolute(n.deleted) : ""}
                  >{t("trash.deleted", { when: n.deleted ? relative(n.deleted) : t("app.dash") })}</span
                >
                <span class="file">{n.file}</span>
              </div>
            </div>
            <button class="sm" onclick={() => restore(n.file)}><ArrowCounterClockwise size={13} /> {t("trash.restore")}</button>
            <button class="ghost sm danger" onclick={() => store.purge(n.file)}><Trash size={13} /> {t("trash.purge")}</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  {#if store.trash.length}
    <footer>
      {#if confirmEmpty}
        <span class="warn">{plural("trash.confirm", store.trash.length)}</span>
        <button class="danger sm" onclick={() => store.purge(null).then(() => (confirmEmpty = false))}>{t("trash.emptyNow")}</button>
        <button class="ghost sm" onclick={() => (confirmEmpty = false)}>{t("trash.cancel")}</button>
      {:else}
        <button class="ghost sm danger" onclick={() => (confirmEmpty = true)}>{t("trash.emptyAsk")}</button>
      {/if}
    </footer>
  {/if}
{/snippet}

{#if sheet}
  <div class="dialog bare">{@render panel()}</div>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={onclose}>
    <div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-label={t("trash.title")} tabindex="-1">
      {@render panel()}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: #00000088;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dialog.bare {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    border-radius: 0;
    box-shadow: none;
  }
  .dialog {
    width: 560px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 80px);
    display: flex;
    flex-direction: column;
    background: var(--bg2);
    border-radius: 10px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  header,
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
  }
  header {
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
  }
  footer {
    justify-content: flex-end;
    border-top: 1px solid var(--border);
  }
  h3 {
    margin: 0;
    font-size: 15px;
    color: var(--color2);
  }
  .count {
    font-weight: 400;
    color: var(--color-dim);
    margin-left: 4px;
  }
  .list {
    overflow-y: auto;
    padding: 6px;
  }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--color-dim);
    font-size: 13px;
  }
  .empty :global(code) {
    font-family: var(--mono);
    font-size: 12px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--radius);
  }
  li:hover {
    background: #ffffff06;
  }
  .info {
    flex: 1;
    min-width: 0;
  }
  .title {
    color: var(--color2);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title.untitled {
    color: #666;
    font-style: italic;
    font-weight: 400;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    font-size: 11px;
    color: var(--color-dim);
  }
  .tag {
    padding: 0 6px;
    font-size: 10px;
  }
  .file {
    font-family: var(--mono);
    color: #555;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sm {
    font-size: 12px;
    padding: 3px 8px;
    flex: none;
  }
  .warn {
    font-size: 12px;
    color: var(--color-dim);
    margin-right: auto;
  }
</style>
