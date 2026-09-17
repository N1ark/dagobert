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
  import { mentions, renameLinks } from "./wikilinks";
  import X from "phosphor-svelte/lib/X";
  import ArrowSquareOut from "phosphor-svelte/lib/ArrowSquareOut";
  import GearSix from "phosphor-svelte/lib/GearSix";

  let { note, onjump, standalone = false }: { note: Note; onjump: (id: string) => void; standalone?: boolean } = $props();

  let tagInput = $state("");
  let confirmDelete = $state(false);
  let picking = $state<string | null>(null);
  let editingWorkflows = $state(false);
  // Panel is re-keyed per note, so the initial value is exactly what we want.
  // svelte-ignore state_referenced_locally
  let titleBefore = note.title;

  const mentionedIn = $derived(mentions(note));

  const done = $derived(store.isDone(note));
  const workflow = $derived(store.workflowOf(note));
  const custom = $derived(note.workflow !== null);
  let titleEl = $state<HTMLInputElement | null>(null);

  const deps = $derived(store.dependencies(note.id));
  const dependents = $derived(store.dependents(note.id));
  const depIds = $derived(new Set(note.deps));
  const dependentIds = $derived(new Set(dependents.map((d) => d.id)));

  // Fresh, untitled notes: jump straight to the title field.
  $effect(() => {
    if (!note.title && titleEl) titleEl.focus();
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
    {#if !custom}
      <label class="done" title={done ? "Mark as not done" : "Mark as done"}>
        <input type="checkbox" checked={done} onchange={() => store.advance(note.id)} />
      </label>
    {/if}
    <input class="title" placeholder="Untitled" bind:value={note.title} bind:this={titleEl} oninput={edited} onchange={titleCommitted} onblur={titleCommitted} onkeydown={(e) => { if (e.key === "Escape" && !standalone) { e.preventDefault(); store.select(null); } }} title="Inline markdown works here (**bold**, `code`, [links](…))" />
    {#if !standalone}
      <button class="ghost close" onclick={() => store.openInWindow(note.id)} title="Open in a new window" aria-label="open in new window"><ArrowSquareOut size={16} /></button>
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
    <select class="wf" value={note.workflow ?? ""} onchange={(e) => store.setWorkflow(note.id, e.currentTarget.value || null)} title="Workflow">
      <option value="">Todo</option>
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
    <input class="tag-input" placeholder={note.tags.length ? "add tag" : "add tags…"} bind:value={tagInput} onkeydown={onTagKey} onblur={addTag} />
  </div>

  <section class="links">
    <div class="group">
      <h4>Depends on <span class="count">{deps.length}</span></h4>
      <ul>
        {#each deps as d (d.id)}
          <li>
            <button class="ghost jump" class:done={store.isDone(d)} onclick={() => onjump(d.id)}><InlineMd source={d.title} fallback="Untitled" /></button>
            <button class="ghost x" onclick={() => store.removeDependency(note.id, d.id)} aria-label="remove"><X size={12} /></button>
          </li>
        {/each}
      </ul>
      <LinkPicker
        exclude={new Set([note.id, ...depIds])}
        filter={(n) => !store.wouldCycle(note.id, n.id)}
        placeholder="add a dependency…"
        onpick={(id) => store.addDependency(note.id, id)}
      />
    </div>
    <div class="group">
      <h4>Blocks <span class="count">{dependents.length}</span></h4>
      <ul>
        {#each dependents as d (d.id)}
          <li>
            <button class="ghost jump" class:done={store.isDone(d)} onclick={() => onjump(d.id)}><InlineMd source={d.title} fallback="Untitled" /></button>
            <button class="ghost x" onclick={() => store.removeDependency(d.id, note.id)} aria-label="remove"><X size={12} /></button>
          </li>
        {/each}
      </ul>
      <LinkPicker
        exclude={new Set([note.id, ...dependentIds])}
        filter={(n) => !store.wouldCycle(n.id, note.id)}
        placeholder="add a dependent…"
        onpick={(id) => store.addDependency(id, note.id)}
      />
    </div>
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
    <span class="file" title={note.file}>{note.file}</span>
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
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
    padding: 0 16px 12px;
    border-bottom: 1px solid var(--border);
  }
  .group h4 {
    margin: 0 0 6px;
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
  .group ul {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    max-height: 140px;
    overflow-y: auto;
  }
  .group li {
    display: flex;
    align-items: center;
  }
  .jump {
    flex: 1;
    text-align: left;
    padding: 3px 6px;
    color: var(--color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .jump.done {
    text-decoration: line-through;
    color: var(--color-dim);
  }
  .group .x {
    padding: 2px 6px;
    font-size: 13px;
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
    font-family: var(--mono);
    font-size: 11px;
    color: #555;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  footer button {
    font-size: 12px;
  }
</style>
