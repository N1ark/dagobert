<script lang="ts">
  import { store } from "./store.svelte";
  import { isMobile } from "./backend";
  import { stageColor } from "./workflows";
  import Check from "phosphor-svelte/lib/Check";
  import Minus from "phosphor-svelte/lib/Minus";
  import Copy from "phosphor-svelte/lib/Copy";
  import ArrowSquareOut from "phosphor-svelte/lib/ArrowSquareOut";
  import Trash from "phosphor-svelte/lib/Trash";
  import FolderOpen from "phosphor-svelte/lib/FolderOpen";
  import { t } from "./i18n";
  import { keys } from "./keys";

  export type MenuTarget =
    | { kind: "node"; id: string }
    | { kind: "group"; ids: string[] }
    | { kind: "edge"; from: string; to: string }
    | { kind: "background"; wx: number; wy: number };

  let {
    x,
    y,
    target,
    onclose,
    oncreate,
    onpaste,
  }: {
    x: number;
    y: number;
    target: MenuTarget;
    onclose: () => void;
    oncreate: (wx: number, wy: number) => void;
    onpaste: (wx: number, wy: number) => void;
  } = $props();

  let el = $state<HTMLDivElement | null>(null);
  let newTag = $state("");
  let confirmDelete = $state(false);

  const note = $derived(target.kind === "node" ? store.byId(target.id) : null);
  const group = $derived(
    target.kind === "group" ? target.ids.map((id) => store.byId(id)).filter((n): n is NonNullable<typeof n> => !!n) : [],
  );

  type Tagged = "all" | "some" | "none";

  /** How much of the group carries the tag. */
  function groupHas(tag: string): Tagged {
    const c = group.filter((n) => n.tags.includes(tag)).length;
    return c === group.length ? "all" : c ? "some" : "none";
  }
  function groupToggleTag(tag: string) {
    const all = groupHas(tag) === "all";
    for (const n of group) (all ? store.removeTag : store.addTag).call(store, n.id, tag);
  }
  function groupAddTag() {
    const t = newTag.trim();
    if (!t) return;
    for (const n of group) store.addTag(n.id, t);
    newTag = "";
  }
  const workflow = $derived(note ? store.workflowOf(note) : null);

  // Keep the menu on screen.
  const pos = $derived.by(() => {
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 300;
    return {
      left: Math.min(x, window.innerWidth - w - 8),
      top: Math.min(y, window.innerHeight - h - 8),
    };
  });

  function onWindowPointerDown(e: PointerEvent) {
    if (!(e.target as HTMLElement).closest(".ctx")) close();
  }

  // On a phone this is an action sheet: it slides up on arrival, and leaves the
  // same way whether it was dismissed, pushed down or acted on.
  let shown = $state(!isMobile);
  $effect(() => {
    const frame = requestAnimationFrame(() => (shown = true));
    return () => cancelAnimationFrame(frame);
  });

  let closing = false;
  function close() {
    if (!isMobile) return onclose();
    if (closing) return;
    closing = true;
    shown = false;
    dragY = null;
    setTimeout(onclose, 340);
  }

  let dragY = $state<number | null>(null);
  let grab: { y: number; last: number; at: number; v: number } | null = null;

  function onGrabDown(e: PointerEvent) {
    grab = { y: e.clientY, last: e.clientY, at: e.timeStamp, v: 0 };
    dragY = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onGrabMove(e: PointerEvent) {
    if (!grab) return;
    const dt = e.timeStamp - grab.at;
    if (dt > 0) {
      grab.v = 0.7 * ((e.clientY - grab.last) / dt) + 0.3 * grab.v;
      grab.at = e.timeStamp;
      grab.last = e.clientY;
    }
    dragY = Math.max(0, e.clientY - grab.y);
  }
  function onGrabUp() {
    if (!grab) return;
    const flicked = grab.v > 0.45 && performance.now() - grab.at < 80;
    const far = (dragY ?? 0) > (el?.getBoundingClientRect().height ?? 200) * 0.3;
    grab = null;
    dragY = null;
    if (flicked || far) close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }
  function run(fn: () => void) {
    fn();
    close();
  }
  function addNewTag() {
    if (!note) return;
    store.addTag(note.id, newTag);
    newTag = "";
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onKey} onblur={close} />

{#snippet tags(has: (tag: string) => Tagged, toggle: (tag: string) => void, placeholder: string, add: () => void)}
  <div class="section">{t("ctx.tags")}</div>
  <div class="tags">
    {#each store.allTags as { tag } (tag)}
      {@const state = has(tag)}
      <button class="item check" class:on={state === "all"} class:some={state === "some"} onclick={() => toggle(tag)}>
        <span class="mark"
          >{#if state === "all"}<Check size={11} weight="bold" />{:else if state === "some"}<Minus size={11} weight="bold" />{/if}</span
        >
        <span class="dot" style="--c:{store.tagColor(tag)}"></span>{tag}
      </button>
    {/each}
  </div>
  <form
    class="new-tag"
    onsubmit={(e) => {
      e.preventDefault();
      add();
    }}
  >
    <input {placeholder} bind:value={newTag} onblur={add} />
  </form>
{/snippet}

{#if isMobile}
  <div class="scrim" class:hit={shown} style="opacity:{shown ? 0.4 : 0}"></div>
{/if}

<div
  class="ctx"
  class:shown
  class:dragging={dragY !== null}
  bind:this={el}
  style={isMobile && dragY !== null ? `transform: translateY(${dragY}px)` : `left:${pos.left}px; top:${pos.top}px`}
  role="menu"
  tabindex="-1"
  oncontextmenu={(e) => e.preventDefault()}
>
  {#if isMobile}
    <button
      class="grab"
      aria-label={t("ctx.dismiss")}
      onpointerdown={onGrabDown}
      onpointermove={onGrabMove}
      onpointerup={onGrabUp}
      onpointercancel={onGrabUp}
    ></button>
  {/if}
  {#if note && workflow}
    <button class="item" onclick={() => run(() => store.select(note.id))}>{t("ctx.open")}</button>
    <button class="item" onclick={() => run(() => store.openInWindow(note.id))}><ArrowSquareOut size={14} /> {t("ctx.openWindow")}</button>
    {#if !isMobile}
      <button class="item" onclick={() => run(() => store.revealInFinder(note.id))}><FolderOpen size={14} /> {t("ctx.reveal")}</button>
    {/if}
    <button class="item" onclick={() => run(() => store.copy(note.id))}><Copy size={14} /> {t("ctx.copy")} <kbd>{keys.copy}</kbd></button>
    <button
      class="item"
      onclick={() =>
        run(() => {
          const d = store.duplicate(note.id);
          if (d) store.select(d.id);
        })}>{t("ctx.duplicate")} <kbd>{keys.duplicate}</kbd></button
    >
    {#if note.tracking}
      <div class="section">{t("ctx.tracking", { done: store.progress(note).done, total: store.progress(note).total })}</div>
    {:else if note.workflow === null}
      <button class="item" onclick={() => run(() => store.advance(note.id))}
        >{t(store.isDone(note) ? "node.markNotDone" : "node.markDone")}</button
      >
    {:else}
      <div class="section">{t("ctx.status")}</div>
      {#each workflow.stages as stage (stage.name)}
        <button class="item check" class:on={note.status === stage.name} onclick={() => run(() => store.setStatus(note.id, stage.name))}>
          <span class="mark"
            >{#if note.status === stage.name}<Check size={11} weight="bold" />{/if}</span
          >
          <span class="pip" style="--c:{stageColor(workflow, stage.name)}"></span>{stage.name}
        </button>
      {/each}
    {/if}

    {@render tags(
      (tag) => (note.tags.includes(tag) ? "all" : "none"),
      (tag) => store.toggleTag(note.id, tag),
      t("ctx.newTag"),
      addNewTag,
    )}

    {#if note.width != null}
      <button class="item" onclick={() => run(() => store.setWidth(note.id, null))}>{t("ctx.resetWidth")}</button>
    {/if}
    <div class="sep"></div>
    {#if confirmDelete}
      <button class="item danger" onclick={() => run(() => store.remove(note.id))}>{t("ctx.reallyDelete")}</button>
    {:else}
      <button class="item danger" onclick={() => (confirmDelete = true)}><Trash size={14} /> {t("ctx.delete")}</button>
    {/if}
  {:else if target.kind === "group"}
    <div class="section">{t("ctx.group.selected", { n: group.length })}</div>
    <button class="item" onclick={() => run(() => group.forEach((n) => store.setDone(n.id, true)))}>{t("ctx.group.allDone")}</button>
    <button class="item" onclick={() => run(() => group.forEach((n) => store.setDone(n.id, false)))}>{t("ctx.group.allNotDone")}</button>
    {@render tags(groupHas, groupToggleTag, t("ctx.group.addTag"), groupAddTag)}
    <div class="sep"></div>
    {#if confirmDelete}
      <button class="item danger" onclick={() => run(() => group.forEach((n) => store.remove(n.id)))}
        >{t("ctx.group.reallyDelete", { n: group.length })}</button
      >
    {:else}
      <button class="item danger" onclick={() => (confirmDelete = true)}
        ><Trash size={14} /> {t("ctx.group.delete", { n: group.length })}</button
      >
    {/if}
  {:else if target.kind === "edge"}
    {@const edge = target}
    <div class="section">
      {t("ctx.edge", { from: store.byId(edge.from)?.title || t("app.untitled"), to: store.byId(edge.to)?.title || t("app.untitled") })}
    </div>
    <button class="item danger" onclick={() => run(() => store.removeDependency(edge.to, edge.from))}>{t("ctx.removeLink")}</button>
  {:else if target.kind === "background"}
    {@const bg = target}
    <button class="item" onclick={() => run(() => oncreate(bg.wx, bg.wy))}>{t("ctx.newHere")}</button>
    <button class="item" disabled={!store.clipboard} onclick={() => run(() => onpaste(bg.wx, bg.wy))}
      >{t("ctx.paste")} <kbd>{keys.paste}</kbd></button
    >
  {/if}
</div>

<style>
  .scrim {
    z-index: 59;
  }
  .ctx.dragging {
    transition: none;
  }
  .ctx {
    position: fixed;
    z-index: 60;
    min-width: 200px;
    max-width: 280px;
    padding: 4px;
    background: var(--bg3);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    font-size: 13px;
    outline: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 5px 10px;
    border: none;
    background: transparent;
    color: var(--color);
    border-radius: 4px;
  }
  @media (hover: hover) {
    .item:hover {
      background: #ffffff10;
      color: var(--color2);
    }
    .item.danger:hover {
      color: var(--red);
    }
  }
  .item:disabled {
    opacity: 0.4;
  }
  kbd {
    margin-left: auto;
    font-family: inherit;
    font-size: 11px;
    color: var(--color-dim);
  }
  .check {
    padding-left: 6px;
  }
  .mark {
    width: 12px;
    display: inline-flex;
    justify-content: center;
    color: var(--accent2);
  }
  .check.some .mark {
    color: var(--color-dim);
  }
  .pip,
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
    flex: none;
  }
  .section {
    padding: 6px 10px 2px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tags {
    max-height: 180px;
    overflow-y: auto;
  }
  .new-tag {
    padding: 2px 6px 4px;
  }
  .new-tag input {
    width: 100%;
    font-size: 12px;
    padding: 3px 8px;
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border2);
  }
</style>
