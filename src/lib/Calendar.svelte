<script lang="ts">
  import { tick } from "svelte";
  import { store } from "./store.svelte";
  import { isMobile } from "./backend";
  import type { Note } from "./types";
  import { dueState, fromKey, groupByDay, moveDue, parseDue } from "./calendar";
  import { clock } from "./clock.svelte";
  import { formatDay, formatTime } from "./time";
  import InlineMd from "./InlineMd.svelte";
  import DockButton from "./DockButton.svelte";
  import {
    daysBetween,
    formatMonth,
    IconButton,
    MonthGrid,
    PanelHeader,
    persisted,
    persistedFlag,
    Segmented,
    type CalendarDay,
  } from "purr";
  import { CaretLeft, CaretRight, CheckSquare, Plus } from "purr/icons";
  import { t, plural } from "./i18n";

  let { onclose, onjump, oncreate }: { onclose: () => void; onjump: (id: string) => void; oncreate: (due: string) => void } = $props();

  type View = "month" | "agenda";
  const view = persisted<View>("dagobert.calendar.view", isMobile ? "agenda" : "month", (v): v is View => v === "month" || v === "agenda");
  const showDone = persistedFlag("dagobert.calendar.done", true);
  let month = $state({ y: fromKey(clock.today).getFullYear(), m: fromKey(clock.today).getMonth() });

  const longDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" });

  const dated = $derived(store.notes.filter((n) => parseDue(n.due) && (showDone.value || !store.isDone(n))));
  const byDay = $derived(groupByDay(dated, (n) => n.due));
  const open = $derived(dated.filter((n) => !store.isDone(n)));
  const overdue = $derived(open.filter((n) => dueState(n.due, false, clock.now) === "overdue"));
  const upcoming = $derived([...byDay.keys()].filter((k) => k >= clock.today));

  const stateOf = (n: Note) => dueState(n.due, store.isDone(n), clock.now);
  const timeOf = (n: Note) => parseDue(n.due)?.time ?? null;

  /** How many chips a month cell shows before "n more". */
  const PER_DAY = 3;

  function shiftMonth(step: number) {
    const d = new Date(month.y, month.m + step, 1);
    month = { y: d.getFullYear(), m: d.getMonth() };
  }

  function goToday() {
    const d = fromKey(clock.today);
    month = { y: d.getFullYear(), m: d.getMonth() };
    if (view.value === "agenda") void reveal(clock.today);
  }

  /** Switches to the agenda, scrolled to a day. */
  async function reveal(key: string) {
    view.value = "agenda";
    await tick();
    const el = listEl?.querySelector(`[data-agenda="${key}"]`) ?? listEl?.querySelector("[data-agenda]");
    el?.scrollIntoView({ block: "start" });
  }
  let listEl = $state<HTMLElement | null>(null);

  // ---- dragging a note to another day ----

  let drag = $state<{ id: string; x: number; y: number; sx: number; sy: number; moved: boolean; over: string | null } | null>(null);
  let dragged = false;

  function onDown(e: PointerEvent, n: Note) {
    if (e.button !== 0) return;
    drag = { id: n.id, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, over: null };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function dayAt(x: number, y: number): string | null {
    return (document.elementFromPoint(x, y)?.closest("[data-day]") as HTMLElement | null)?.dataset.day ?? null;
  }

  function onMove(e: PointerEvent) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
    drag = { ...drag, x: e.clientX, y: e.clientY, moved: true, over: dayAt(e.clientX, e.clientY) };
  }

  function onUp() {
    const d = drag;
    drag = null;
    if (!d?.moved) return;
    dragged = true;
    setTimeout(() => (dragged = false));
    const n = store.byId(d.id);
    if (n?.due && d.over) store.setDue(n.id, moveDue(n.due, d.over));
  }

  function pick(id: string) {
    if (!dragged) onjump(id);
  }

  const dragNote = $derived(drag?.moved ? store.byId(drag.id) : null);
</script>

{#snippet chip(n: Note, withTime: boolean)}
  {@const st = stateOf(n)}
  {@const time = timeOf(n)}
  <button
    class={["chip", st, store.isDone(n) && "done"]}
    class:lifted={drag?.moved && drag.id === n.id}
    aria-current={n.id === store.selectedId || undefined}
    title={st === "overdue" ? t("calendar.overdue") : undefined}
    onclick={() => pick(n.id)}
    onpointerdown={(e) => onDown(e, n)}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={() => (drag = null)}
  >
    {#if withTime && time}<span class="time">{formatTime(time)}</span>{/if}
    <span class="name"><InlineMd source={n.title} fallback={t("app.untitled")} /></span>
  </button>
{/snippet}

{#snippet addDay(d: CalendarDay)}
  <IconButton label={t("calendar.new", { day: formatDay(d.key, clock.today) })} size="sm" onclick={() => oncreate(d.key)}
    ><Plus /></IconButton
  >
{/snippet}

{#snippet row(n: Note, day: boolean)}
  {@const st = stateOf(n)}
  {@const time = timeOf(n)}
  <li class={["row", st, store.isDone(n) && "done"]}>
    {#if !n.tracking}
      <button
        class="checkbox check"
        role="checkbox"
        aria-checked={store.isDone(n)}
        aria-label={t("node.toggleDone")}
        title={t(store.isDone(n) ? "node.markNotDone" : "node.markDone")}
        onclick={() => store.setDone(n.id, !store.isDone(n))}
      ></button>
    {:else}
      <span class="check"></span>
    {/if}
    <button class="open" aria-current={n.id === store.selectedId || undefined} onclick={() => onjump(n.id)}>
      <span class="name"><InlineMd source={n.title} fallback={t("app.untitled")} /></span>
      <span class="when">
        {#if day}{formatDay(parseDue(n.due)!.date, clock.today)}{/if}{#if day && time},
        {/if}{#if time}{formatTime(time)}{/if}
      </span>
    </button>
  </li>
{/snippet}

<div class="pane calendar">
  <PanelHeader
    title={t("calendar.title")}
    count={open.length || undefined}
    onclose={isMobile ? undefined : onclose}
    closeLabel={t("pane.close")}
  >
    {#snippet actions()}
      <IconButton label={t("calendar.showDone")} pressed={showDone.value} onclick={() => (showDone.value = !showDone.value)}
        ><CheckSquare /></IconButton
      >
      <DockButton />
    {/snippet}
  </PanelHeader>
  <div class="bar">
    <Segmented
      size="sm"
      label={t("calendar.view")}
      options={[
        { id: "month", label: t("calendar.month") },
        { id: "agenda", label: t("calendar.agenda") },
      ]}
      bind:value={view.value}
    />
    <button class="btn btn--ghost btn--sm" onclick={goToday}>{t("calendar.today")}</button>
    {#if view.value === "month"}
      <span class="nav">
        <IconButton label={t("calendar.prev")} onclick={() => shiftMonth(-1)}><CaretLeft /></IconButton>
        <IconButton label={t("calendar.next")} onclick={() => shiftMonth(1)}><CaretRight /></IconButton>
      </span>
      <h3 class="month">{formatMonth(new Date(month.y, month.m, 1))}</h3>
    {/if}
  </div>

  {#if view.value === "month"}
    <div class="grid">
      <MonthGrid
        year={month.y}
        month={month.m}
        today={clock.today}
        target={drag?.moved ? drag.over : null}
        actions={isMobile ? undefined : addDay}
      >
        {#snippet day(d)}
          {@const items = byDay.get(d.key) ?? []}
          {#each items.slice(0, items.length > PER_DAY ? PER_DAY - 1 : PER_DAY) as n (n.id)}
            {@render chip(n, true)}
          {/each}
          {#if items.length > PER_DAY}
            <button class="more" onclick={() => reveal(d.key)}>{plural("calendar.more", items.length - PER_DAY + 1)}</button>
          {/if}
        {/snippet}
      </MonthGrid>
    </div>
  {:else}
    <div class="agenda" bind:this={listEl}>
      {#if !dated.length}
        <p class="empty"><InlineMd source={t("calendar.empty")} /></p>
      {/if}
      {#if overdue.length}
        <section data-agenda="overdue">
          <h4 class="late">{t("calendar.overdue")} <span class="count">{overdue.length}</span></h4>
          <ul>
            {#each overdue as n (n.id)}{@render row(n, true)}{/each}
          </ul>
        </section>
      {/if}
      {#each upcoming as key (key)}
        {@const items = (byDay.get(key) ?? []).filter((n) => stateOf(n) !== "overdue")}
        {#if items.length}
          <section data-agenda={key}>
            <h4 class:today={key === clock.today}>
              {formatDay(key, clock.today)}
              {#if daysBetween(clock.today, key) < 7}
                <span class="date">{longDate.format(fromKey(key))}</span>
              {/if}
            </h4>
            <ul>
              {#each items as n (n.id)}{@render row(n, false)}{/each}
            </ul>
          </section>
        {/if}
      {/each}
    </div>
  {/if}
</div>

{#if dragNote && drag}
  <div class="ghost" style="left:{drag.x}px;top:{drag.y}px">
    <InlineMd source={dragNote.title} fallback={t("app.untitled")} />
    {#if drag.over}<span class="to">→ {formatDay(drag.over, clock.today)}</span>{/if}
  </div>
{/if}

<style>
  .calendar {
    position: relative;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    padding: var(--sp-3) var(--sp-4);
  }
  .nav {
    display: inline-flex;
  }
  .month {
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--color2);
  }
  .month::first-letter {
    text-transform: uppercase;
  }

  .grid {
    flex: 1;
    min-height: 0;
    margin: 0 var(--sp-4) var(--sp-4);
  }
  :global(body.mobile) .grid {
    margin: 0 var(--gap-2) var(--gap-2);
  }

  .chip {
    display: flex;
    align-items: baseline;
    gap: var(--gap-2);
    min-width: 0;
    padding: 1px var(--gap-3);
    font-size: var(--fs-micro);
    line-height: 1.5;
    text-align: left;
    --c: var(--theme2);
    color: var(--color2);
    background: color-mix(in oklab, var(--c) 16%, transparent);
    border-radius: var(--radius-sm);
    cursor: grab;
    touch-action: none;
    container-type: inline-size;
  }
  @media (hover: hover) {
    .chip:hover {
      background: color-mix(in oklab, var(--c) 26%, transparent);
    }
  }
  .chip[aria-current] {
    background: color-mix(in oklab, var(--c) 34%, transparent);
  }
  .chip.overdue {
    --c: var(--danger);
    color: var(--danger);
  }
  .chip.done {
    --c: var(--faint);
    color: var(--muted);
    text-decoration: line-through;
  }
  .chip.lifted {
    opacity: 0.4;
  }
  .chip .time {
    flex: none;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  /* A phone's day is too narrow for both; the title wins, the agenda has the time. */
  @container (max-width: 80px) {
    .chip .time {
      display: none;
    }
  }
  /* A phone's seven columns leave little room: a smaller, tighter chip shows a few more letters. */
  :global(body.mobile) .chip {
    padding: 1px var(--gap-1);
    font-size: calc(var(--fs-micro) - 1px);
  }
  /* A long title fades into the background rather than ending in an ellipsis, as on iOS. */
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 1.2em), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 1.2em), transparent);
  }
  .more {
    align-self: flex-start;
    padding: 0 var(--gap-3);
    font-size: var(--fs-micro);
    color: var(--muted);
    border-radius: var(--radius-sm);
  }
  @media (hover: hover) {
    .more:hover {
      color: var(--theme2);
    }
  }

  .agenda {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 var(--sp-4) var(--sp-4);
  }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  section + section {
    margin-top: var(--sp-4);
  }
  h4 {
    display: flex;
    align-items: baseline;
    gap: var(--gap-3);
    margin: 0 0 var(--gap-2);
    padding-bottom: var(--gap-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--color2);
    border-bottom: 1px solid var(--border);
  }
  h4.today {
    color: var(--theme2);
  }
  h4.late {
    color: var(--danger);
  }
  h4 .date,
  h4 .count {
    font-weight: 400;
    color: var(--muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    min-height: var(--row-h);
  }
  .row .check {
    flex: none;
    width: 14px;
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: var(--gap-3);
    padding: var(--gap-1) var(--gap-3);
    border-radius: var(--radius);
    text-align: left;
    color: var(--color);
    font-size: var(--fs-sm);
  }
  @media (hover: hover) {
    .open:hover {
      background: var(--chip);
    }
  }
  .open[aria-current] {
    background: var(--theme-soft);
  }
  .open .when {
    margin-left: auto;
    flex: none;
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .row.overdue .when {
    color: var(--danger);
  }
  .row.done .name {
    color: var(--muted);
    text-decoration: line-through;
  }

  .ghost {
    position: fixed;
    z-index: var(--z-tooltip);
    display: flex;
    flex-direction: column;
    max-width: 220px;
    padding: var(--gap-2) var(--gap-4);
    transform: translate(8px, 8px);
    font-size: var(--fs-xs);
    color: var(--color2);
    background: var(--bg3);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    pointer-events: none;
  }
  .ghost .to {
    color: var(--theme2);
  }
</style>
