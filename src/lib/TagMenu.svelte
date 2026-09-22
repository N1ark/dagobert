<script lang="ts">
  import { store } from "./store.svelte";
  import TagColorPicker from "./TagColorPicker.svelte";
  import Tag from "phosphor-svelte/lib/Tag";
  import { tooltip } from "./tooltip";
  import { t } from "./i18n";
  import { ICON } from "./icons";

  let open = $state(false);
  let picking = $state<string | null>(null);

  function onWindowPointerDown(e: PointerEvent) {
    if (!(e.target as HTMLElement).closest(".tag-menu")) {
      open = false;
      picking = null;
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="tag-menu">
  <button
    class="icon"
    class:ghost={!store.tagFilter.length}
    class:filtering={store.tagFilter.length > 0}
    onclick={() => (open = !open)}
    use:tooltip={t("tags.filter")}
    aria-label={t("tags.filter")}
  >
    <Tag size={ICON} />{#if store.tagFilter.length}<span class="n">{store.tagFilter.length}</span>{/if}
  </button>

  {#if open}
    <div class="popover">
      {#if !store.allTags.length}
        <div class="empty">{t("tags.empty")}</div>
      {:else}
        <ul>
          {#each store.allTags as { tag, count } (tag)}
            {@const on = store.tagFilter.includes(tag)}
            <li class:on>
              <div class="dot-wrap">
                <button
                  class="dot"
                  style="--c:{store.tagColor(tag)}"
                  title={t("tags.color")}
                  aria-label={t("tags.colorOf", { tag })}
                  onclick={() => (picking = picking === tag ? null : tag)}
                ></button>
                {#if picking === tag}
                  <TagColorPicker {tag} onclose={() => (picking = null)} />
                {/if}
              </div>
              <button class="ghost name" onclick={() => store.toggleTagFilter(tag)}>
                <span>{tag}</span>
                <span class="count">{count}</span>
              </button>
            </li>
          {/each}
        </ul>
        {#if store.tagFilter.length}
          <button class="ghost clear" onclick={() => (store.tagFilter = [])}>{t("tags.clear")}</button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .tag-menu {
    position: relative;
  }
  .filtering {
    border-color: var(--accent);
    color: var(--color2);
  }
  .icon {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--btn);
    height: var(--btn);
    padding: 0;
  }
  .n {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 14px;
    height: 14px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--color2);
    font-size: 10px;
    line-height: 14px;
    text-align: center;
  }
  .popover {
    position: absolute;
    z-index: 20;
    top: calc(100% + 6px);
    right: 0;
    width: 220px;
    padding: 6px;
    background: var(--bg3);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
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
    gap: 6px;
    padding-left: 6px;
    border-radius: var(--radius);
  }
  li.on {
    background: #ffffff0c;
  }
  .dot-wrap {
    position: relative;
    display: flex;
  }
  .dot {
    width: 14px;
    height: 14px;
    padding: 0;
    border-radius: 50%;
    border: none;
    background: var(--c);
  }
  .dot:hover {
    background: var(--c);
    box-shadow: 0 0 0 2px var(--color2);
  }
  .name {
    flex: 1;
    display: flex;
    justify-content: space-between;
    color: var(--color);
    text-align: left;
  }
  li.on .name {
    color: var(--color2);
  }
  .count {
    color: var(--color-dim);
    font-size: 11px;
  }
  .empty {
    padding: 8px;
    color: var(--color-dim);
    font-size: 12px;
  }
  .clear {
    width: 100%;
    justify-content: center;
    margin-top: 4px;
    font-size: 12px;
  }
</style>
