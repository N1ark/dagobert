<script lang="ts">
  import { Popover, rank, SearchInput, Spinner, VirtualList } from "purr";
  import { store } from "./store.svelte";
  import { iconLabel, iconNames, iconPicker, noteIcon } from "./noteIcons.svelte";
  import { t } from "./i18n";
  import { untrack } from "svelte";

  /** The note icon picker, opened through `pickIcon`; mounted once in App. */
  const COLS = 8;
  const CELL = 36;

  let query = $state("");
  let active = $state(0);
  let hovered = $state<string | null>(null);
  let list = $state<ReturnType<typeof VirtualList<string[]>> | null>(null);

  const note = $derived(iconPicker.id ? store.byId(iconPicker.id) : null);
  const names = $derived(iconNames());
  const hits = $derived(query.trim() ? rank(names, query, { keys: [(n) => n] }).map((h) => h.item) : names);
  const rows = $derived(Array.from({ length: Math.ceil(hits.length / COLS) }, (_, r) => hits.slice(r * COLS, r * COLS + COLS)));
  const shown = $derived(hovered ?? hits[active] ?? note?.icon ?? null);

  // Start on the note's icon, scrolled into view; a search starts on its best match.
  $effect(() => {
    void hits;
    void iconPicker.id;
    hovered = null;
    active = untrack(() => (!query.trim() && note?.icon ? Math.max(0, hits.indexOf(note.icon)) : 0));
  });
  $effect(() => {
    if (list) untrack(() => list?.scrollToIndex(Math.floor(active / COLS), "center"));
  });

  function close() {
    iconPicker.id = null;
    iconPicker.anchor = null;
    query = "";
    hovered = null;
  }

  function choose(name: string | null) {
    if (note) store.setIcon(note.id, name);
    close();
  }

  function onkeydown(e: KeyboardEvent) {
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS } as Record<string, number>)[e.key];
    if (step !== undefined && hits.length) {
      e.preventDefault();
      hovered = null;
      active = Math.max(0, Math.min(hits.length - 1, active + step));
      list?.scrollToIndex(Math.floor(active / COLS));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      choose(hits[active]);
    }
  }
</script>

{#if note && iconPicker.anchor}
  <Popover anchor={iconPicker.anchor} label={t("icon.pick")} onclose={close} width="{COLS * CELL + 24}px" padding="0" autofocus>
    <SearchInput bind:value={query} label={t("icon.search")} placeholder={t("icon.search")} {onkeydown} data-autofocus />
    <div class="grid" style:height="{CELL * 7 + 8}px">
      {#if names.length}
        <VirtualList bind:this={list} items={rows} rowHeight={CELL} padding="4px 12px">
          {#snippet children(row, r)}
            <div class="row">
              {#each row as name, c (name)}
                {@const Icon = noteIcon(name)}
                <button
                  class="cell"
                  class:active={r * COLS + c === active && !hovered}
                  class:current={name === note.icon}
                  aria-label={iconLabel(name)}
                  onpointerenter={() => (hovered = name)}
                  onpointerleave={() => (hovered = null)}
                  onclick={() => choose(name)}
                  >{#if Icon}<Icon />{/if}</button
                >
              {/each}
            </div>
          {/snippet}
          {#snippet empty()}<p class="empty">{t("icon.none")}</p>{/snippet}
        </VirtualList>
      {:else}
        <p class="empty"><Spinner label={t("icon.loading")} /></p>
      {/if}
    </div>
    <footer>
      <span class="name truncate">{shown ? iconLabel(shown) : ""}</span>
      {#if note.icon}
        <button class="btn btn--ghost btn--sm" onclick={() => choose(null)}>{t("icon.remove")}</button>
      {/if}
    </footer>
  </Popover>
{/if}

<style>
  .grid {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
  }
  .cell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    color: var(--color);
    font-size: var(--fs-xl);
  }
  .cell:hover,
  .cell.active {
    background: var(--chip);
  }
  .cell.current {
    background: var(--theme-soft);
    color: var(--theme2);
  }
  .empty {
    display: flex;
    justify-content: center;
    padding: var(--sp-5);
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  footer {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    min-height: 36px;
    padding: var(--gap-2) var(--sp-4);
    border-top: 1px solid var(--border);
  }
  .name {
    flex: 1;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
