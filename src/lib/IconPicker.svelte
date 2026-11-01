<script lang="ts">
  import { Popover, rank, SearchInput, Spinner, VirtualList } from "purr";
  import { iconGlyph, iconNames, iconPicker, loadIcons } from "./icons.svelte";
  import { t } from "./i18n";
  import { untrack } from "svelte";

  /** The icon grid, opened through `pickIcon`; mounted once in App. */
  const COLS = 8;
  const CELL = 36;

  let query = $state("");
  let active = $state(0);
  let hovered = $state<string | null>(null);
  let ready = $state(false);
  let list = $state<ReturnType<typeof VirtualList<string[]>> | null>(null);

  const hits = $derived(query.trim() ? rank(iconNames, query, { keys: [(n) => n] }).map((h) => h.item) : iconNames);
  const rows = $derived(Array.from({ length: Math.ceil(hits.length / COLS) }, (_, r) => hits.slice(r * COLS, r * COLS + COLS)));
  const shown = $derived(hovered ?? hits[active] ?? null);

  $effect(() => {
    if (iconPicker.anchor) void loadIcons().then(() => (ready = true));
  });
  // A search starts on its best match.
  $effect(() => {
    void hits;
    hovered = null;
    active = 0;
  });
  $effect(() => {
    if (list) untrack(() => list?.scrollToIndex(Math.floor(active / COLS)));
  });

  function close() {
    iconPicker.anchor = null;
    iconPicker.onpick = null;
    query = "";
    hovered = null;
  }

  function choose(name: string) {
    const pick = iconPicker.onpick;
    close();
    pick?.(name);
  }

  function onkeydown(e: KeyboardEvent) {
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS } as Record<string, number>)[e.key];
    if (step !== undefined && hits.length) {
      e.preventDefault();
      hovered = null;
      active = Math.max(0, Math.min(hits.length - 1, active + step));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      choose(hits[active]);
    }
  }
</script>

{#if iconPicker.anchor}
  <Popover anchor={iconPicker.anchor} label={t("icon.pick")} onclose={close} width="{COLS * CELL + 24}px" padding="0" autofocus>
    <SearchInput bind:value={query} label={t("icon.search")} placeholder={t("icon.search")} {onkeydown} data-autofocus />
    <div class="grid" style:height="{CELL * 7 + 8}px">
      {#if ready}
        <VirtualList bind:this={list} items={rows} rowHeight={CELL} padding="4px 12px">
          {#snippet children(row, r)}
            <div class="row">
              {#each row as name, c (name)}
                {@const Icon = iconGlyph(name)}
                <button
                  class="cell"
                  class:active={r * COLS + c === active && !hovered}
                  aria-label={name}
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
    <footer class="truncate">{shown ? `:${shown}:` : ""}</footer>
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
  .empty {
    display: flex;
    justify-content: center;
    padding: var(--sp-5);
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  footer {
    min-height: 36px;
    padding: var(--gap-3) var(--sp-4);
    border-top: 1px solid var(--border);
    font-family: var(--mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
