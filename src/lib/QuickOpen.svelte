<script lang="ts">
  import { CommandPalette, Highlight, Kbd, rank, Tag, type PaletteItem, type Ranked } from "purr";
  import { ArrowSquareOut, Plus, Terminal } from "purr/icons";
  import { store } from "./store.svelte";
  import type { Note } from "./types";
  import type { Action } from "./menu";
  import InlineMd from "./InlineMd.svelte";
  import { parseQuery } from "./query";
  import { stageColor } from "./workflows";
  import { t } from "./i18n";
  import { keys } from "./keys";

  /** The ⌘K note switcher, or with `mode="commands"` the ⇧⌘K command palette. */
  let {
    actions,
    onjump,
    oncreate,
    onclose,
    mode = "notes",
  }: {
    mode?: "notes" | "commands";
    actions: Action[];
    onjump: (id: string) => void;
    oncreate: (title: string) => void;
    onclose: () => void;
  } = $props();

  type Item = PaletteItem & { note?: Note; create?: string };

  const commands = $derived(
    actions.map((a): Item => ({ id: a.id, label: a.label, icon: a.icon, hint: a.hint, disabled: a.enabled === false, run: a.run })),
  );

  /** A leading `#tag` narrows to notes carrying it; the rest ranks titles, the latest edit first among equals. */
  function search(raw: string): Ranked<Item>[] {
    const { text, tag } = parseQuery(raw);
    const notes = store.notes
      .filter((n) => !tag || n.tags.some((x) => x.toLowerCase().startsWith(tag)))
      .sort((a, b) => b.modified.localeCompare(a.modified))
      .map((note): Item => ({ id: note.id, label: note.title || t("app.untitled"), note }));
    const hits = rank(notes, text, { keys: [(i) => i.label] });
    const exact = hits.some((h) => h.item.note!.title.trim().toLowerCase() === text.toLowerCase());
    if (text && !tag && !exact)
      hits.push({ item: { id: "create", label: t("quick.create", { title: text }), create: text }, score: 0, field: 0, indices: [] });
    return hits;
  }

  function choose(item: Item, e: KeyboardEvent | MouseEvent) {
    if (item.create !== undefined) oncreate(item.create);
    else if (item.note && (e.metaKey || e.ctrlKey)) store.openInWindow(item.note.id);
    else if (item.note) onjump(item.note.id);
    else item.run?.(e);
  }
</script>

{#if mode === "commands"}
  <CommandPalette
    items={commands}
    {onclose}
    label={t("quick.aria")}
    placeholder={t("quick.commands.placeholder")}
    emptyText={() => t("quick.noCommand")}
    navigateLabel={t("quick.foot.navigate")}
    chooseLabel={t("quick.foot.run")}
  >
    {#snippet leading()}<Terminal />{/snippet}
    {#snippet trailing()}<Kbd hint={keys.commands} />{/snippet}
  </CommandPalette>
{:else}
  <CommandPalette
    items={[]}
    {search}
    onchoose={choose}
    {onclose}
    label={t("quick.aria")}
    placeholder={t("quick.notes.placeholder")}
    emptyText={() => t("quick.noNotes")}
  >
    {#snippet trailing()}<Kbd hint={keys["quick-open"]} />{/snippet}
    {#snippet row(item, state)}
      {#if item.create !== undefined}
        <span class="create"><Plus />{item.label}</span>
      {:else if item.note}
        {@const n = item.note}
        <span class="title truncate" class:done={store.isDone(n)}>
          {#if state.indices.length && !/[*_`[\]~]/.test(n.title)}
            <Highlight text={item.label} indices={state.indices} />
          {:else}
            <InlineMd source={n.title} fallback={t("app.untitled")} />
          {/if}
        </span>
        {#each n.tags.slice(0, 3) as tag (tag)}
          <Tag label={tag} color={store.tagColor(tag)} />
        {/each}
        <span class="fills"></span>
        {#if n.workflow !== null && !n.tracking && !n.permanent}
          <span class="status ink" style:--c={stageColor(store.workflowOf(n), n.status)}><span class="pip"></span>{n.status}</span>
        {:else if store.isDone(n)}
          <span class="status ink" style:--c="var(--success)"><span class="pip"></span>{t("quick.done")}</span>
        {/if}
        <span class="slot" class:show={state.active} title={t("quick.newWindow.tip", { key: keys["open-window"] })}><ArrowSquareOut /></span
        >
      {/if}
    {/snippet}
    {#snippet footer()}
      <span><kbd>↑</kbd><kbd>↓</kbd> {t("quick.foot.navigate")}</span>
      <span><Kbd hint="↩" /> {t("quick.foot.open")}</span>
      <span><Kbd hint={keys["open-window"]} /> {t("quick.foot.newWindow")}</span>
      <span><kbd>#</kbd> {t("quick.foot.tag")}</span>
    {/snippet}
  </CommandPalette>
{/if}

<style>
  .title {
    flex: 0 1 auto;
  }
  .title.done {
    text-decoration: line-through;
    color: var(--muted);
  }
  .create {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-4);
    color: var(--theme2);
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-2);
    flex: none;
    font-size: var(--fs-micro);
  }
  .pip {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--c);
  }
  /* Reserve the icon's width so hovering never shifts the row. */
  .slot {
    display: inline-flex;
    flex: none;
    font-size: var(--icon-sm);
    color: var(--muted);
    visibility: hidden;
  }
  .slot.show {
    visibility: visible;
  }
  :global(body.mobile) .slot {
    display: none;
  }
</style>
