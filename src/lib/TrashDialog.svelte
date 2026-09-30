<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "./store.svelte";
  import { isMobile } from "./backend";
  import { ConfirmButton, formatAbsolute, PanelHeader } from "purr";
  import { relative } from "./time";
  import InlineMd from "./InlineMd.svelte";
  import DockButton from "./DockButton.svelte";
  import { ArrowCounterClockwise, Trash } from "purr/icons";
  import { t, plural } from "./i18n";

  let { onclose, onrestored }: { onclose: () => void; onrestored: (id: string) => void } = $props();

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
</script>

<div class="pane">
  <PanelHeader title={t("trash.title")} count={store.trash.length} onclose={isMobile ? undefined : onclose} closeLabel={t("pane.close")}>
    {#snippet actions()}<DockButton />{/snippet}
  </PanelHeader>
  <div class="list">
    {#if loading}
      <p class="empty">{t("trash.loading")}</p>
    {:else if !store.trash.length}
      <p class="empty"><InlineMd source={t("trash.empty")} /></p>
    {:else}
      <ul>
        {#each store.trash as n (n.file)}
          <li class="hoverable">
            <div class="info">
              <div class="title" class:untitled={!n.title}><InlineMd source={n.title} fallback={t("app.untitled")} /></div>
              <div class="sub">
                {#if n.tags.length}
                  {#each n.tags as tag (tag)}
                    <span class="tag" style:--tag={store.tagColor(tag)}>{tag}</span>
                  {/each}
                {/if}
                <span title={n.deleted ? formatAbsolute(n.deleted) : ""}
                  >{t("trash.deleted", { when: n.deleted ? relative(n.deleted) : t("app.dash") })}</span
                >
                {#if isMobile}
                  <span class="file">{n.file}</span>
                {:else}
                  <button class="btn btn--link file" title={t("panel.reveal")} onclick={() => store.revealTrashed(n.file)}>{n.file}</button>
                {/if}
              </div>
            </div>
            <button class="btn btn--sm" onclick={() => restore(n.file)}><ArrowCounterClockwise /> {t("trash.restore")}</button>
            <button class="btn btn--ghost btn--danger btn--sm" onclick={() => store.purge(n.file)}><Trash /> {t("trash.purge")}</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  {#if store.trash.length}
    <footer>
      {#if confirmEmpty}
        <span class="warn">{plural("trash.confirm", store.trash.length)}</span>
      {/if}
      <ConfirmButton
        variant="ghost"
        size="sm"
        class="btn--danger"
        bind:armed={confirmEmpty}
        confirmLabel={t("trash.emptyNow")}
        onconfirm={() => store.purge(null)}>{t("trash.emptyAsk")}</ConfirmButton
      >
    </footer>
  {/if}
</div>

<style>
  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--gap-4);
    padding: var(--sp-4) var(--sp-5);
    border-top: 1px solid var(--border);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--gap-3);
  }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .empty :global(code) {
    font-family: var(--mono);
    font-size: var(--fs-xs);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--gap-4);
    padding: var(--gap-4) var(--sp-4);
    border-radius: var(--radius);
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
    color: var(--faint);
    font-style: italic;
    font-weight: 400;
  }
  .sub {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--gap-1) var(--gap-3);
    margin-top: var(--gap-1);
    font-size: var(--fs-micro);
    color: var(--muted);
  }
  .file {
    flex-basis: 100%;
    max-width: 100%;
    justify-content: flex-start;
    font-family: var(--mono);
    font-size: var(--fs-micro);
    color: var(--faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .warn {
    font-size: var(--fs-xs);
    color: var(--muted);
    margin-right: auto;
  }
</style>
