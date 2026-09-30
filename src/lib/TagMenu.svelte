<script lang="ts">
  import { IconButton, Popover } from "purr";
  import { Tag } from "purr/icons";
  import { store } from "./store.svelte";
  import TagColorPicker from "./TagColorPicker.svelte";
  import { t } from "./i18n";

  let button = $state<HTMLElement | null>(null);
  let open = $state(false);
  let picking = $state<{ tag: string; anchor: HTMLElement } | null>(null);

  function close() {
    open = false;
    picking = null;
  }
</script>

<span class="tag-menu" bind:this={button}>
  <IconButton
    label={t("tags.filter")}
    size="lg"
    variant={store.tagFilter.length ? "default" : "ghost"}
    class={store.tagFilter.length ? "filtering" : undefined}
    aria-expanded={open}
    onclick={() => (open ? close() : (open = true))}
  >
    <Tag />{#if store.tagFilter.length}<span class="n">{store.tagFilter.length}</span>{/if}
  </IconButton>
</span>

{#if open && button}
  <Popover anchor={button} placement="bottom-end" onclose={close} label={t("tags.filter")} width="220px" padding="var(--sp-2)">
    {#if !store.allTags.length}
      <div class="empty">{t("tags.empty")}</div>
    {:else}
      <ul>
        {#each store.allTags as { tag, count } (tag)}
          {@const on = store.tagFilter.includes(tag)}
          <li class:on>
            <button
              class="swatch"
              style:--c={store.tagColor(tag)}
              title={t("tags.color")}
              aria-label={t("tags.colorOf", { tag })}
              onclick={(e) => (picking = picking?.tag === tag ? null : { tag, anchor: e.currentTarget })}
            ></button>
            <button class="row-item name" aria-pressed={on} onclick={() => store.toggleTagFilter(tag)}>
              <span class="fills truncate">{tag}</span>
              <span class="count">{count}</span>
            </button>
          </li>
        {/each}
      </ul>
      {#if store.tagFilter.length}
        <button class="btn btn--ghost clear" onclick={() => (store.tagFilter = [])}>{t("tags.clear")}</button>
      {/if}
    {/if}
  </Popover>
{/if}

{#if picking}
  <TagColorPicker tag={picking.tag} anchor={picking.anchor} onclose={() => (picking = null)} />
{/if}

<style>
  .tag-menu {
    display: inline-flex;
  }
  .tag-menu :global(.btn) {
    position: relative;
  }
  .tag-menu :global(.filtering) {
    border-color: var(--theme);
    color: var(--color2);
  }
  .n {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 14px;
    height: 14px;
    padding: 0 var(--gap-2);
    border-radius: var(--radius-pill);
    background: var(--theme);
    color: var(--on-accent);
    font-size: var(--fs-nano);
    line-height: 14px;
    text-align: center;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 320px;
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    padding-left: var(--gap-3);
    border-radius: var(--radius);
  }
  li.on {
    background: var(--theme-soft);
  }
  .name {
    flex: 1;
    color: var(--color);
  }
  li.on .name {
    color: var(--color2);
  }
  .count {
    color: var(--muted);
    font-size: var(--fs-micro);
  }
  .empty {
    padding: var(--gap-4);
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .clear {
    width: 100%;
    margin-top: var(--gap-2);
    font-size: var(--fs-xs);
  }
</style>
