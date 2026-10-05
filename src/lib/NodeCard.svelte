<script lang="ts">
  import { store } from "./store.svelte";
  import type { Note } from "./types";
  import { stageColor } from "./workflows";
  import InlineMd from "./InlineMd.svelte";
  import { ProgressRing } from "purr";
  import { CalendarBlank, Warning, WarningCircle } from "purr/icons";
  import { MARKER_RE } from "./blocks";
  import { firstMedia, stripMedia } from "./media";
  import MediaIcon from "./MediaIcon.svelte";
  import { t } from "./i18n";
  import { dueState } from "./calendar";
  import { clock } from "./clock.svelte";
  import { formatDue } from "./time";

  let {
    note,
    width,
    selected = false,
    grouped = false,
    dim = false,
    lifted = false,
    linkTarget = false,
    onresize,
  }: {
    note: Note;
    width: number;
    selected?: boolean;
    grouped?: boolean;
    dim?: boolean;
    lifted?: boolean;
    linkTarget?: boolean;
    onresize: (h: number) => void;
  } = $props();

  let height = $state(0);
  $effect(() => onresize(height));

  const ready = $derived(store.isReady(note));
  const done = $derived(store.isDone(note));
  const workflow = $derived(store.workflowOf(note));
  const custom = $derived(note.workflow !== null && !note.tracking);
  const progress = $derived(note.tracking ? store.progress(note) : null);
  const conflict = $derived(store.hasConflict(note));
  // First non-empty body line, block markers and embeds stripped so it renders as inline markdown.
  const preview = $derived(
    stripMedia(note.body)
      .split("\n")
      .map((l) => l.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s*)?|\d+\.\s+)/, "").trim())
      .find((l) => l.length > 0 && !/^(```|---|\*\*\*|___)/.test(l) && !MARKER_RE.test(l)) ?? "",
  );

  const media = $derived(firstMedia(note.body));
  const due = $derived(note.due ? { label: formatDue(note.due, clock.today), state: dueState(note.due, done, clock.now) } : null);

  function advance(e: MouseEvent) {
    e.stopPropagation();
    store.advance(note.id, e.shiftKey ? -1 : 1);
  }
</script>

<div
  class="node"
  class:selected
  class:grouped
  class:done
  class:ready
  class:dim
  class:lifted
  class:link-target={linkTarget}
  data-node={note.id}
  style="left:{note.x}px; top:{note.y}px; width:{width}px"
  bind:clientHeight={height}
>
  <div class="head">
    {#if progress}
      <span class="ring-wrap" title={t("node.progress", { done: progress.done, total: progress.total })}
        ><ProgressRing value={progress.done} max={progress.total} label={t("ring.aria", progress)} /></span
      >
    {:else if !custom}
      <button
        class="checkbox check"
        role="checkbox"
        aria-checked={done}
        onpointerdown={(e) => e.stopPropagation()}
        onclick={advance}
        title={t(done ? "node.markNotDone" : "node.markDone")}
        aria-label={t("node.toggleDone")}
      ></button>
    {/if}
    <div class="title" class:empty={!note.title}><InlineMd source={note.title} fallback={t("app.untitled")} /></div>
    {#if conflict}
      <span class="conflict" title={t("node.conflict")}><Warning weight="fill" /></span>
    {/if}
  </div>
  {#if custom || progress || due || note.tags.length}
    <div class="tags">
      {#if progress}
        <span class="progress" class:complete={progress.total > 0 && progress.done === progress.total}
          >{progress.done}/{progress.total}</span
        >
      {/if}
      {#if custom}
        <button
          class="status ink"
          style="--c:{stageColor(workflow, note.status)}"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={advance}
          title={t("node.status.tip", { workflow: workflow.name })}
        >
          <span class="pip"></span>{note.status}
        </button>
      {/if}
      {#if due}
        <span class={["due", due.state]} title={t(due.state === "overdue" ? "due.tip.overdue" : "due.tip", { when: due.label })}
          >{#if due.state === "overdue"}<WarningCircle weight="fill" />{:else}<CalendarBlank />{/if}{due.label}</span
        >
      {/if}
      {#each note.tags as tag (tag)}
        <span class="tag" style:--tag={store.tagColor(tag)}>{tag}</span>
      {/each}
    </div>
  {/if}
  {#if preview || media}
    <div class="preview">
      {#if media}<span class="media"><MediaIcon kind={media} /></span>{/if}
      <InlineMd source={preview} />
    </div>
  {/if}
  <div class="port" data-port title={t("node.port")}></div>
  <div class="grip" data-resize title={t("node.resize")}></div>
</div>

<style>
  .node {
    position: absolute;
    background: var(--bg2);
    border-radius: var(--radius);
    box-shadow: var(--box-shadow);
    padding: 10px 12px;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
    transition:
      box-shadow var(--dur),
      transform var(--dur-slow) var(--ease-sheet),
      opacity var(--dur);
  }
  @media (hover: hover) {
    .node:hover {
      box-shadow: 0 0 0 1px var(--border-strong);
    }
  }
  .node.ready {
    box-shadow: 0 0 0 1px var(--theme-mid);
  }
  .node.grouped {
    box-shadow:
      0 0 0 1.5px var(--theme),
      0 0 8px 1px var(--theme-soft);
  }
  .node.selected {
    box-shadow:
      0 0 0 1.5px var(--theme2),
      0 0 12px 2px var(--theme-mid);
  }
  .node.link-target {
    box-shadow:
      0 0 0 2px var(--success),
      0 0 12px 2px color-mix(in srgb, var(--success) 27%, transparent);
  }
  /* A long press picked it up, so it sits above the canvas until it's let go. */
  .node.lifted {
    z-index: 1;
    transform: scale(1.04);
    box-shadow:
      0 0 0 1.5px var(--theme2),
      0 10px 26px 2px var(--scrim);
  }
  .node.done {
    opacity: 0.55;
  }
  .node.dim {
    opacity: 0.18;
  }
  .head {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .check {
    margin-top: 2px;
  }
  .title {
    color: var(--color2);
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .title.empty {
    color: var(--faint);
    font-weight: 400;
    font-style: italic;
  }
  .done .title {
    text-decoration: line-through;
    color: var(--muted);
  }
  .conflict {
    flex: none;
    display: inline-flex;
    margin-left: auto;
    color: var(--warn);
  }
  .ring-wrap {
    display: inline-flex;
    margin-top: 2px;
  }
  .progress {
    font-size: var(--fs-micro);
    font-family: var(--mono);
    color: var(--muted);
    padding: 0 var(--gap-1);
  }
  .progress.complete {
    color: var(--success);
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-2);
    padding: 0 var(--sp-3) 0 var(--sp-2);
    font-size: var(--fs-micro);
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
    background: color-mix(in srgb, var(--c) 12%, transparent);
  }
  @media (hover: hover) {
    .status:hover {
      background: color-mix(in srgb, var(--c) 22%, transparent);
      border-color: var(--c);
    }
  }
  .due {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-1);
    padding: 0 var(--sp-2);
    font-size: var(--fs-micro);
    color: var(--muted);
    border-radius: var(--radius-pill);
    background: var(--chip);
  }
  .due.today,
  .due.soon {
    color: var(--theme2);
  }
  .due.today {
    background: var(--theme-soft);
  }
  .due.overdue {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
  .pip {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--c);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }
  .preview {
    margin-top: 6px;
    font-size: var(--fs-xs);
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .media {
    display: inline-flex;
    vertical-align: -2px;
    margin-right: 4px;
  }
  .grip {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 12px;
    height: 12px;
    cursor: ew-resize;
    opacity: 0;
    transition: opacity var(--dur);
    --stripe: var(--faint);
    background: linear-gradient(
      135deg,
      transparent 50%,
      var(--stripe) 50%,
      var(--stripe) 62%,
      transparent 62%,
      transparent 75%,
      var(--stripe) 75%,
      var(--stripe) 87%,
      transparent 87%
    );
    border-bottom-right-radius: var(--radius);
  }
  .node:hover .grip,
  .node.selected .grip {
    opacity: 1;
  }
  .grip:hover {
    --stripe: var(--theme2);
  }
  .port {
    position: absolute;
    right: -7px;
    top: 50%;
    width: 14px;
    height: 14px;
    margin-top: -7px;
    border-radius: 50%;
    background: var(--bg3);
    border: 1.5px solid var(--border-strong);
    cursor: crosshair;
    opacity: 0;
    transition:
      opacity var(--dur),
      border-color var(--dur),
      background var(--dur);
  }
  .node:hover .port,
  .node.selected .port {
    opacity: 1;
  }
  .port:hover {
    border-color: var(--theme2);
    background: var(--theme-mid);
  }
</style>
