<script lang="ts">
  import { store } from "./store.svelte";
  import type { Note } from "./types";
  import { relative, absolute } from "./time";
  import LiveEditor from "./LiveEditor.svelte";
  import LinkPicker from "./LinkPicker.svelte";
  import TagColorPicker from "./TagColorPicker.svelte";
  import WorkflowEditor from "./WorkflowEditor.svelte";
  import { stageColor } from "./workflows";
  import InlineMd from "./InlineMd.svelte";
  import ProgressRing from "./ProgressRing.svelte";
  import { mentions, renameLinks } from "./wikilinks";
  import X from "phosphor-svelte/lib/X";
  import Plus from "phosphor-svelte/lib/Plus";
  import ArrowSquareOut from "phosphor-svelte/lib/ArrowSquareOut";
  import GearSix from "phosphor-svelte/lib/GearSix";

  let { note, onjump, standalone = false }: { note: Note; onjump: (id: string) => void; standalone?: boolean } = $props();

  let tagInput = $state("");
  let confirmDelete = $state(false);
  let picking = $state<string | null>(null);
  let editingWorkflows = $state(false);
  let adding = $state<string | null>(null);
  // Panel is re-keyed per note, so the initial value is exactly what we want.
  // svelte-ignore state_referenced_locally
  let titleBefore = note.title;

  const mentionedIn = $derived(mentions(note));

  const done = $derived(store.isDone(note));
  const workflow = $derived(store.workflowOf(note));
  const custom = $derived(note.workflow !== null && !note.tracking);
  const progress = $derived(note.tracking ? store.progress(note) : null);
  let titleEl = $state<HTMLInputElement | null>(null);

  // Longest titles first: flex-wrap packs greedily, so first-fit-decreasing
  // ends up with the fewest rows.
  const packed = (notes: Note[]) => [...notes].sort((a, b) => b.title.length - a.title.length || a.title.localeCompare(b.title));
  const deps = $derived(packed(store.dependencies(note.id)));
  const dependents = $derived(packed(store.dependents(note.id)));
  const depIds = $derived(new Set(note.deps));
  const dependentIds = $derived(new Set(dependents.map((d) => d.id)));

  // Fresh, untitled notes: jump straight to the title field.
  $effect(() => {
    if (!note.title && titleEl) titleEl.focus();
  });
  // Enter on the canvas asks for the title field.
  $effect(() => {
    if (store.focusTitle && titleEl) {
      titleEl.focus();
      titleEl.select();
    }
  });

  /** ⌫/⌦ outside a text field acts like the Delete button: first press arms it, second deletes. */
  function onDeleteKey(e: KeyboardEvent) {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
    e.preventDefault();
    if (confirmDelete) store.remove(note.id);
    else confirmDelete = true;
  }
  $effect(() => {
    window.addEventListener("keydown", onDeleteKey);
    return () => window.removeEventListener("keydown", onDeleteKey);
  });

  function edited() {
    store.touch(note.id);
  }

  /** Committing a title change rewrites [[links]] in other notes. */
  function titleCommitted() {
    if (note.title !== titleBefore) renameLinks(titleBefore, note.title);
    titleBefore = note.title;
  }

  function addTag() {
    store.addTag(note.id, tagInput);
    tagInput = "";
  }

  function removeTag(t: string) {
    store.removeTag(note.id, t);
  }

  function onTagKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !tagInput && note.tags.length) {
      removeTag(note.tags[note.tags.length - 1]);
    }
  }

  function createLinkedNote(title: string) {
    store.create(note.x + (note.width ?? 220) + 60, note.y, { title });
  }
</script>

{#if editingWorkflows}
  <WorkflowEditor onclose={() => (editingWorkflows = false)} />
{/if}

<aside class="panel">
  <header>
    {#if progress}
      <span class="ring" title="{progress.done} of {progress.total} dependencies done"
        ><ProgressRing done={progress.done} total={progress.total} size={16} /></span
      >
    {:else if !custom}
      <label class="done" title={done ? "Mark as not done" : "Mark as done"}>
        <input type="checkbox" checked={done} onchange={() => store.advance(note.id)} />
      </label>
    {/if}
    <input
      class="title"
      placeholder="Untitled"
      bind:value={note.title}
      bind:this={titleEl}
      oninput={edited}
      onchange={titleCommitted}
      onblur={titleCommitted}
      onkeydown={(e) => {
        if (e.key === "Escape" && !standalone) {
          e.preventDefault();
          store.select(null);
        }
      }}
      title="Inline markdown works here (**bold**, `code`, [links](…))"
    />
    {#if !standalone}
      <button class="ghost close" onclick={() => store.openInWindow(note.id)} title="Open in a new window" aria-label="open in new window"
        ><ArrowSquareOut size={16} /></button
      >
      <button class="ghost close" onclick={() => store.select(null)} title="Close (Esc)" aria-label="close"><X size={16} /></button>
    {/if}
  </header>

  <div class="workflow-row">
    {#if custom}
      <span class="status-wrap" style="--c:{stageColor(workflow, note.status)}">
        <span class="pip"></span>
        <select class="status" value={note.status} onchange={(e) => store.setStatus(note.id, e.currentTarget.value)}>
          {#each workflow.stages as stage (stage.name)}
            <option value={stage.name}>{stage.name}</option>
          {/each}
        </select>
      </span>
    {/if}
    {#if progress}
      <span class="track-info" title="dependencies done">{progress.done}/{progress.total}</span>
    {/if}
    <select
      class="wf"
      value={note.tracking ? "tracking" : (note.workflow ?? "")}
      onchange={(e) => {
        const v = e.currentTarget.value;
        if (v === "tracking") store.setTracking(note.id, true);
        else {
          store.setTracking(note.id, false);
          store.setWorkflow(note.id, v || null);
        }
      }}
      title="Kind"
    >
      <option value="">Todo</option>
      <option value="tracking">Tracking issue</option>
      {#each store.workflows as wf (wf.id)}
        <option value={wf.id}>{wf.name}</option>
      {/each}
    </select>
    <button class="ghost edit-wf" onclick={() => (editingWorkflows = true)} title="Manage workflows"><GearSix size={15} /></button>
  </div>

  <div class="meta">
    <span title={absolute(note.created)}>created {relative(note.created)}</span>
    <span title={absolute(note.modified)}>edited {relative(note.modified)}</span>
    <span title={absolute(note.opened)}>opened {relative(note.opened)}</span>
  </div>

  <div class="tags">
    {#each note.tags as tag (tag)}
      <span class="tag-wrap">
        <span class="tag tag-chip" style="--tag:{store.tagColor(tag)}">
          <button class="name" onclick={() => (picking = picking === tag ? null : tag)} title="Change colour">{tag}</button>
          <button class="x" onclick={() => removeTag(tag)} aria-label="remove tag"><X size={11} weight="bold" /></button>
        </span>
        {#if picking === tag}
          <TagColorPicker {tag} onclose={() => (picking = null)} />
        {/if}
      </span>
    {/each}
    <input
      class="tag-input"
      placeholder={note.tags.length ? "add tag" : "add tags…"}
      bind:value={tagInput}
      onkeydown={onTagKey}
      onblur={addTag}
    />
  </div>

  <section class="links">
    {#each [{ label: note.tracking ? "Tracks" : "Depends on", items: deps, exclude: new Set( [note.id, ...depIds] ), filter: (n: Note) => !store.wouldCycle(note.id, n.id), placeholder: note.tracking ? "track a note…" : "add a dependency…", add: (id: string) => store.addDependency(note.id, id), remove: (id: string) => store.removeDependency(note.id, id), key: "deps" }, { label: "Blocks", items: dependents, exclude: new Set( [note.id, ...dependentIds] ), filter: (n: Note) => !store.wouldCycle(n.id, note.id), placeholder: "add a dependent…", add: (id: string) => store.addDependency(id, note.id), remove: (id: string) => store.removeDependency(id, note.id), key: "dependents" }] as g (g.key)}
      <div class="group">
        <span class="label">{g.label} <span class="count">{g.items.length}</span></span>
        <div class="chips">
          {#each g.items as d (d.id)}
            <span class="chip" class:done={store.isDone(d)}>
              <button class="ghost jump" onclick={() => onjump(d.id)}><InlineMd source={d.title} fallback="Untitled" /></button>
              <button class="ghost x" onclick={() => g.remove(d.id)} aria-label="remove"><X size={11} /></button>
            </span>
          {/each}
          <button
            class="ghost add"
            class:open={adding === g.key}
            onclick={() => (adding = adding === g.key ? null : g.key)}
            title={g.placeholder}><Plus size={11} /></button
          >
        </div>
        {#if adding === g.key}
          <div class="picker">
            <LinkPicker
              exclude={g.exclude}
              filter={g.filter}
              placeholder={g.placeholder}
              autofocus
              onpick={(id) => {
                g.add(id);
                adding = null;
              }}
            />
          </div>
        {/if}
      </div>
    {/each}
  </section>

  {#if mentionedIn.length}
    <div class="mentioned">
      <span class="label">Mentioned in</span>
      {#each mentionedIn as m (m.id)}
        <button class="ghost ref" onclick={() => onjump(m.id)}><InlineMd source={m.title} fallback="Untitled" /></button>
      {/each}
    </div>
  {/if}

  <div class="body">
    <LiveEditor {note} oncreatelink={createLinkedNote} />
  </div>

  <footer>
    <button class="ghost file" title="Reveal in Finder" onclick={() => store.revealInFinder(note.id)}>{note.file}</button>
    {#if confirmDelete}
      <button class="danger" onclick={() => store.remove(note.id)}>Really delete</button>
      <button class="ghost" onclick={() => (confirmDelete = false)}>Cancel</button>
    {:else}
      <button class="ghost danger" onclick={() => (confirmDelete = true)}>Delete</button>
    {/if}
  </footer>
</aside>

<style>
  .panel {
    width: var(--panel-w);
    height: 100%;
    background: var(--bg2);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 12px 4px 16px;
  }
  .done input {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    margin: 0;
    cursor: pointer;
  }
  .title {
    flex: 1;
    font-size: 18px;
    font-weight: 600;
    color: var(--color2);
    background: transparent;
    border-color: transparent;
    padding: 4px 6px;
    min-width: 0;
  }
  .title:hover,
  .title:focus {
    border-color: var(--border2);
  }
  .title:focus {
    border-color: var(--accent);
  }
  .close {
    font-size: 12px;
    padding: 4px 8px;
  }
  .workflow-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 16px 6px 22px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 16px 12px 22px;
    align-items: center;
  }
  select {
    font: inherit;
    font-size: 12px;
    color: var(--color);
    background: var(--bg);
    border: 1px solid var(--border2);
    border-radius: var(--radius);
    padding: 2px 6px;
    outline: none;
  }
  select:focus {
    border-color: var(--accent);
  }
  .ring {
    display: inline-flex;
  }
  .track-info {
    font-size: 12px;
    color: var(--color-dim);
  }
  .status-wrap {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding-left: 8px;
    border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
    background: color-mix(in srgb, var(--c) 12%, transparent);
  }
  .status-wrap .pip {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--c);
  }
  .status-wrap .status {
    border: none;
    background: transparent;
    color: var(--c);
    font-weight: 500;
  }
  .wf {
    color: var(--color-dim);
  }
  .edit-wf {
    padding: 2px 6px;
    font-size: 13px;
  }
  .meta {
    display: flex;
    gap: 12px;
    padding: 0 16px 8px 22px;
    font-size: 11px;
    color: var(--color-dim);
  }
  .tag-wrap {
    position: relative;
  }
  .tag {
    gap: 2px;
    font-size: 12px;
    padding: 1px 4px 1px 2px;
  }
  .tag .name {
    padding: 0 2px 0 6px;
    border: none;
    background: none;
    color: inherit;
    line-height: inherit;
  }
  .tag .name:hover {
    text-decoration: underline;
  }
  .tag .x {
    padding: 0 4px;
    border: none;
    background: none;
    color: inherit;
    opacity: 0.6;
    font-size: 13px;
    line-height: 1;
  }
  .tag .x:hover {
    opacity: 1;
  }
  .tag-input {
    border: none;
    background: transparent;
    font-size: 12px;
    padding: 2px 4px;
    width: 90px;
  }
  .links {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 16px 8px 22px;
    border-bottom: 1px solid var(--border);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .label {
    white-space: nowrap;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-dim);
  }
  .count {
    font-weight: 400;
    opacity: 0.7;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    align-items: center;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    border-radius: 999px;
    background: #ffffff0a;
    font-size: 12px;
  }
  .chip.done {
    opacity: 0.55;
  }
  .chip.done .jump {
    text-decoration: line-through;
  }
  .jump {
    padding: 1px 4px 1px 8px;
    color: var(--color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    border: none;
  }
  .chip .x {
    padding: 1px 5px 1px 1px;
    border: none;
    opacity: 0.5;
  }
  .chip .x:hover {
    opacity: 1;
  }
  .add {
    padding: 2px 5px;
    border: 1px dashed var(--border2);
    border-radius: 999px;
    color: var(--color-dim);
  }
  .add:hover,
  .add.open {
    border-color: var(--accent2);
    color: var(--accent2);
  }
  .picker {
    width: 100%;
    margin-top: 2px;
  }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .mentioned {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 6px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .mentioned .label {
    color: var(--color-dim);
    margin-right: 4px;
  }
  .ref {
    padding: 1px 6px;
    font-size: 12px;
    color: var(--accent2);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
  }
  .file {
    flex: 1;
    min-width: 0;
    justify-content: flex-start;
    padding: 2px 4px;
    font-family: var(--mono);
    font-size: 11px;
    color: #555;
  }
  .file:hover {
    color: var(--accent2);
  }
  footer button {
    font-size: 12px;
  }
</style>
