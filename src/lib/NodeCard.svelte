<script lang="ts">
  import { store } from "./store.svelte";
  import type { Note } from "./types";
  import { stageColor } from "./workflows";
  import InlineMd from "./InlineMd.svelte";
  import Check from "phosphor-svelte/lib/Check";
  import Warning from "phosphor-svelte/lib/Warning";
  import ProgressRing from "./ProgressRing.svelte";

  let {
    note,
    width,
    selected = false,
    grouped = false,
    dim = false,
    linkTarget = false,
    onresize,
  }: {
    note: Note;
    width: number;
    selected?: boolean;
    grouped?: boolean;
    dim?: boolean;
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
  // First non-empty line of the body, with block-level markers stripped so it
  // renders as inline markdown (bold, code, links…).
  const preview = $derived(
    note.body
      .split("\n")
      .map((l) => l.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s*)?|\d+\.\s+)/, "").trim())
      .find((l) => l.length > 0 && !/^(```|---|\*\*\*|___)/.test(l)) ?? "",
  );

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
  class:link-target={linkTarget}
  data-node={note.id}
  style="left:{note.x}px; top:{note.y}px; width:{width}px"
  bind:clientHeight={height}
>
  <div class="head">
    {#if progress}
      <span class="ring-wrap" title="{progress.done} of {progress.total} dependencies done"
        ><ProgressRing done={progress.done} total={progress.total} /></span
      >
    {:else if !custom}
      <button
        class="check"
        class:on={done}
        onpointerdown={(e) => e.stopPropagation()}
        onclick={advance}
        title={done ? "Mark as not done" : "Mark as done"}
        aria-label="toggle done"
      >
        {#if done}
          <Check size={11} weight="bold" />
        {/if}
      </button>
    {/if}
    <div class="title" class:empty={!note.title}><InlineMd source={note.title} fallback="Untitled" /></div>
    {#if conflict}
      <span class="conflict" title="The body still has merge conflict markers"><Warning size={14} weight="fill" /></span>
    {/if}
  </div>
  {#if custom || progress || note.tags.length}
    <div class="tags">
      {#if progress}
        <span class="progress" class:complete={progress.total > 0 && progress.done === progress.total}
          >{progress.done}/{progress.total}</span
        >
      {/if}
      {#if custom}
        <button
          class="status"
          style="--c:{stageColor(workflow, note.status)}"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={advance}
          title="{workflow.name} — click to advance, shift-click to go back"
        >
          <span class="pip"></span>{note.status}
        </button>
      {/if}
      {#each note.tags as tag (tag)}
        <span class="tag tag-chip" style="--tag:{store.tagColor(tag)}">{tag}</span>
      {/each}
    </div>
  {/if}
  {#if preview}
    <div class="preview"><InlineMd source={preview} /></div>
  {/if}
  <div class="port" data-port title="Drag to another note to make it depend on this one"></div>
  <div class="grip" data-resize title="Drag to resize"></div>
</div>

<style>
  .node {
    position: absolute;
    background: var(--bg2);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 10px 12px;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
    transition:
      box-shadow 0.15s,
      opacity 0.15s;
  }
  .node:hover {
    box-shadow:
      0 0 0 1px #ffffff2a,
      0 0 4px 4px #ffffff05;
  }
  .node.ready {
    box-shadow:
      0 0 0 1px var(--accent-soft),
      0 0 4px 4px #ffffff03;
  }
  .node.grouped {
    box-shadow:
      0 0 0 1.5px var(--accent),
      0 0 8px 1px #8a2aa233;
  }
  .node.selected {
    box-shadow:
      0 0 0 1.5px var(--accent2),
      0 0 12px 2px #8a2aa244;
  }
  .node.link-target {
    box-shadow:
      0 0 0 2px var(--green),
      0 0 12px 2px #98c37944;
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
    flex: none;
    width: 15px;
    height: 15px;
    margin-top: 2px;
    padding: 0;
    border-radius: 4px;
    border: 1px solid #444;
    background: var(--bg);
    color: var(--color2);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .check:hover {
    border-color: var(--accent2);
  }
  .check.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .title {
    color: var(--color2);
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .title.empty {
    color: #555;
    font-weight: 400;
    font-style: italic;
  }
  .done .title {
    text-decoration: line-through;
    color: var(--color-dim);
  }
  .conflict {
    flex: none;
    display: inline-flex;
    margin-left: auto;
    color: var(--yellow);
  }
  .ring-wrap {
    display: inline-flex;
    margin-top: 2px;
  }
  .progress {
    font-size: 11px;
    font-family: var(--mono);
    color: var(--color-dim);
    padding: 0 2px;
  }
  .progress.complete {
    color: var(--green);
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 7px 0 5px;
    font-size: 11px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
    background: color-mix(in srgb, var(--c) 12%, transparent);
    color: var(--c);
  }
  .status:hover {
    background: color-mix(in srgb, var(--c) 22%, transparent);
    border-color: var(--c);
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
  .tag {
    font-size: 11px;
    padding: 1px 6px;
  }
  .preview {
    margin-top: 6px;
    font-size: 12px;
    color: var(--color-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grip {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 12px;
    height: 12px;
    cursor: ew-resize;
    opacity: 0;
    transition: opacity 0.15s;
    background: linear-gradient(
      135deg,
      transparent 50%,
      #555 50%,
      #555 62%,
      transparent 62%,
      transparent 75%,
      #555 75%,
      #555 87%,
      transparent 87%
    );
    border-bottom-right-radius: var(--radius);
  }
  .node:hover .grip,
  .node.selected .grip {
    opacity: 1;
  }
  .grip:hover {
    background: linear-gradient(
      135deg,
      transparent 50%,
      var(--accent2) 50%,
      var(--accent2) 62%,
      transparent 62%,
      transparent 75%,
      var(--accent2) 75%,
      var(--accent2) 87%,
      transparent 87%
    );
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
    border: 1.5px solid #444;
    cursor: crosshair;
    opacity: 0;
    transition:
      opacity 0.15s,
      border-color 0.15s,
      background 0.15s;
  }
  .node:hover .port,
  .node.selected .port {
    opacity: 1;
  }
  .port:hover {
    border-color: var(--accent2);
    background: var(--accent-soft);
  }
</style>
