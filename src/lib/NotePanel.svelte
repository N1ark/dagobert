<script lang="ts">
  import { store } from "./store.svelte";
  import { isMobile } from "./backend";
  import type { Note } from "./types";
  import { ConfirmButton, formatAbsolute, IconButton, ProgressRing, Tag } from "purr";
  import { relative } from "./time";
  import LiveEditor from "./LiveEditor.svelte";
  import LinkPicker from "./LinkPicker.svelte";
  import DockButton from "./DockButton.svelte";
  import TagColorPicker from "./TagColorPicker.svelte";
  import { stageColor } from "./workflows";
  import InlineMd from "./InlineMd.svelte";
  import NoteLink from "./NoteLink.svelte";
  import { mentions, renameLinks } from "./wikilinks";
  import { headings } from "./toc";
  import { t } from "./i18n";
  import { keys } from "./keys";
  import { X, Plus, ArrowSquareOut, GearSix } from "purr/icons";

  let { note, onjump, standalone = false }: { note: Note; onjump: (id: string) => void; standalone?: boolean } = $props();

  let tagInput = $state("");
  let confirmDelete = $state(false);
  let picking = $state<{ tag: string; anchor: HTMLElement } | null>(null);
  let adding = $state<string | null>(null);
  // The panel is re-keyed per note, so the initial value is the right one.
  // svelte-ignore state_referenced_locally
  let titleBefore = note.title;

  const mentionedIn = $derived(mentions(note));
  const toc = $derived(standalone ? headings(note.body) : []);
  let panelEl = $state<HTMLElement | null>(null);

  const done = $derived(store.isDone(note));
  const workflow = $derived(store.workflowOf(note));
  const custom = $derived(note.workflow !== null && !note.tracking);
  const progress = $derived(note.tracking ? store.progress(note) : null);
  let titleEl = $state<HTMLInputElement | null>(null);
  let titleFocused = $state(false);

  // Longest first: flex-wrap packs greedily, so first-fit-decreasing needs the fewest rows.
  const packed = (notes: Note[]) => [...notes].sort((a, b) => b.title.length - a.title.length || a.title.localeCompare(b.title));
  const deps = $derived(packed(store.dependencies(note.id)));
  const dependents = $derived(packed(store.dependents(note.id)));

  /** The two chip lists, what this note depends on and what depends on it. */
  const linkGroups = $derived([
    {
      key: "deps",
      label: t(note.tracking ? "panel.deps.tracks" : "panel.deps"),
      items: deps,
      exclude: new Set([note.id, ...note.deps]),
      filter: (n: Note) => !store.wouldCycle(note.id, n.id),
      placeholder: t(note.tracking ? "panel.deps.track" : "panel.deps.add"),
      add: (id: string) => store.addDependency(note.id, id),
      remove: (id: string) => store.removeDependency(note.id, id),
    },
    {
      key: "dependents",
      label: t("panel.dependents"),
      items: dependents,
      exclude: new Set([note.id, ...dependents.map((d) => d.id)]),
      filter: (n: Note) => !store.wouldCycle(n.id, note.id),
      placeholder: t("panel.dependents.add"),
      add: (id: string) => store.addDependency(id, note.id),
      remove: (id: string) => store.removeDependency(id, note.id),
    },
  ]);

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

  function jumpTo(block: number) {
    panelEl?.querySelector(`.live [data-block="${block}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function createLinkedNote(title: string) {
    store.create(note.x + (note.width ?? 220) + 60, note.y, { title });
  }
</script>

<aside class="panel" class:standalone bind:this={panelEl}>
  <header>
    {#if progress}
      <span class="ring" title={t("node.progress", { done: progress.done, total: progress.total })}
        ><ProgressRing value={progress.done} max={progress.total} size={16} label={t("ring.aria", progress)} /></span
      >
    {:else if !custom}
      <label class="done" title={t(done ? "node.markNotDone" : "node.markDone")}>
        <input type="checkbox" class="checkbox" checked={done} onchange={() => store.advance(note.id)} />
      </label>
    {/if}
    <!-- Rendered until it's edited, like the body's blocks. -->
    <span class="title-wrap">
      <input
        class="title"
        class:rendered={!titleFocused && !!note.title}
        placeholder={t("panel.title.placeholder")}
        bind:value={note.title}
        bind:this={titleEl}
        oninput={edited}
        onchange={titleCommitted}
        onfocus={() => (titleFocused = true)}
        onblur={() => {
          titleFocused = false;
          titleCommitted();
        }}
        onkeydown={(e) => {
          if (e.key === "Escape" && !standalone) {
            e.preventDefault();
            store.select(null);
          }
        }}
      />
      {#if !titleFocused && note.title}
        <span class="title-md" aria-hidden="true"><InlineMd source={note.title} /></span>
      {/if}
    </span>
    {#if !standalone && !isMobile}
      <span class="pane-tools">
        <DockButton />
        <IconButton label={t("panel.openWindow.aria")} tip={t("panel.openWindow")} onclick={() => store.openInWindow(note.id)}
          ><ArrowSquareOut /></IconButton
        >
        <IconButton label={t("panel.close.aria")} tip={{ text: t("pane.close"), hint: keys.escape }} onclick={() => store.select(null)}
          ><X /></IconButton
        >
      </span>
    {/if}
  </header>

  <div class="top">
    <div class="info">
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
          <span class="track-info" title={t("panel.depsDone")}>{progress.done}/{progress.total}</span>
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
          title={t("panel.kind")}
        >
          <option value="">{t("panel.kind.todo")}</option>
          <option value="tracking">{t("panel.kind.tracking")}</option>
          {#each store.workflows as wf (wf.id)}
            <option value={wf.id}>{wf.name}</option>
          {/each}
        </select>
        <IconButton
          label={t("panel.manageWorkflows")}
          onclick={() => store.openSettings(note.tracking ? "tracking" : "workflows", note.tracking ? null : note.workflow)}
          ><GearSix /></IconButton
        >
      </div>

      <div class="meta">
        <span title={formatAbsolute(note.created)}>{t("panel.created", { when: relative(note.created) })}</span>
        <span title={formatAbsolute(note.modified)}>{t("panel.edited", { when: relative(note.modified) })}</span>
      </div>

      <div class="tags">
        {#each note.tags as tag (tag)}
          <Tag
            label={tag}
            color={store.tagColor(tag)}
            title={t("panel.tag.color")}
            onclick={(e) => (picking = picking?.tag === tag ? null : { tag, anchor: e.currentTarget as HTMLElement })}
            onremove={() => removeTag(tag)}
            removeLabel={t("panel.tag.remove")}
          />
        {/each}
        <input
          class="tag-input"
          placeholder={t(note.tags.length ? "panel.tag.add" : "panel.tag.addFirst")}
          bind:value={tagInput}
          onkeydown={onTagKey}
          onblur={addTag}
        />
      </div>

      {#if picking}
        <TagColorPicker tag={picking.tag} anchor={picking.anchor} onclose={() => (picking = null)} />
      {/if}

      <section class="links">
        {#each linkGroups as g (g.key)}
          <div class="group">
            <span class="label">{g.label} <span class="count">{g.items.length}</span></span>
            <div class="chips">
              {#each g.items as d (d.id)}
                <span class="chip" class:done={store.isDone(d)}>
                  <button class="jump" onclick={() => onjump(d.id)}><InlineMd source={d.title} fallback={t("app.untitled")} /></button>
                  <button class="x" onclick={() => g.remove(d.id)} aria-label={t("panel.link.remove")}><X /></button>
                </span>
              {/each}
              <button
                class="add"
                aria-expanded={adding === g.key}
                aria-label={g.placeholder}
                onclick={() => (adding = adding === g.key ? null : g.key)}
                title={g.placeholder}><Plus /></button
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
          <span class="label">{t("panel.mentionedIn")}</span>
          {#each mentionedIn as m (m.id)}
            <NoteLink id={m.id} {onjump} />
          {/each}
        </div>
      {/if}
    </div>
    {#if standalone}
      <nav class="toc" aria-label={t("panel.toc")}>
        {#each toc as h, i (i)}
          <button class="entry" class:h1={h.level === 1} style="--lvl:{h.level}" onclick={() => jumpTo(h.block)}
            ><InlineMd source={h.text} /></button
          >
        {:else}
          <span class="empty">{t("panel.toc.empty")}</span>
        {/each}
      </nav>
    {/if}
  </div>

  <div class="body">
    <LiveEditor {note} oncreatelink={createLinkedNote} />
  </div>

  <footer>
    {#if isMobile}
      <span class="file plain">{note.file}</span>
    {:else}
      <button class="btn btn--link file" title={t("panel.reveal")} onclick={() => store.revealInFinder(note.id)}>{note.file}</button>
    {/if}
    <ConfirmButton
      variant="ghost"
      size="sm"
      class="btn--danger"
      bind:armed={confirmDelete}
      confirmLabel={t("panel.reallyDelete")}
      onconfirm={() => store.remove(note.id)}>{t("panel.delete")}</ConfirmButton
    >
  </footer>
</aside>

<style>
  .panel {
    height: 100%;
    background: var(--bg2);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--gap-4);
    padding: var(--sp-4) var(--sp-4) var(--gap-2) var(--sp-5);
  }
  .done {
    display: flex;
  }
  .done input {
    --check: 16px;
  }
  .title-wrap {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
  }
  .title {
    flex: 1;
    font-size: var(--fs-xl);
    font-weight: 600;
    color: var(--color2);
    border: 1px solid transparent;
    border-radius: var(--radius);
    padding: var(--gap-2) var(--gap-3);
    min-width: 0;
    transition: border-color var(--dur);
  }
  .title:hover {
    border-color: var(--border-strong);
  }
  .title:focus {
    border-color: var(--theme2);
  }
  .title.rendered {
    color: transparent;
  }
  .title-md {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding: var(--gap-2) var(--gap-3);
    border: 1px solid transparent;
    font-size: var(--fs-xl);
    font-weight: 600;
    color: var(--color2);
    white-space: nowrap;
    overflow: hidden;
    pointer-events: none;
  }
  :global(body.mobile) .title-md {
    font-size: 16px;
  }
  .title-md :global(.inline-md) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .workflow-row {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    padding: var(--gap-1) var(--sp-5) var(--gap-3) 22px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-2);
    padding: 0 var(--sp-5) var(--sp-4) 22px;
    align-items: center;
  }
  .tags :global(.tag) {
    font-size: var(--fs-xs);
    padding-top: 1px;
    padding-bottom: 1px;
  }
  select {
    font-size: var(--fs-xs);
    color: var(--color);
    background: var(--field-bg);
    border: 1px solid var(--field-border);
    border-radius: var(--radius);
    padding: var(--gap-1) var(--gap-3);
  }
  select:focus {
    border-color: var(--theme2);
  }
  .ring {
    display: inline-flex;
  }
  .track-info {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .status-wrap {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-2);
    padding-left: var(--gap-4);
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
    color: var(--muted);
  }
  .meta {
    display: flex;
    gap: var(--sp-4);
    padding: 0 var(--sp-5) var(--gap-4) 22px;
    font-size: var(--fs-micro);
    color: var(--muted);
  }
  .tag-input {
    font-size: var(--fs-xs);
    padding: var(--gap-1) var(--gap-2);
    width: 90px;
  }
  .links {
    display: flex;
    flex-direction: column;
    gap: var(--gap-4);
    padding: 0 var(--sp-5) var(--gap-4) 22px;
    border-bottom: 1px solid var(--border);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--gap-1);
  }
  .label {
    white-space: nowrap;
    font-size: var(--fs-micro);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .count {
    font-weight: 400;
    opacity: 0.7;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-1);
    align-items: center;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    border-radius: var(--radius-pill);
    background: var(--chip);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }
  .chip.done {
    opacity: 0.55;
  }
  .chip.done .jump {
    text-decoration: line-through;
  }
  .jump {
    padding: 1px var(--gap-2) 1px var(--gap-4);
    color: var(--color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .chip .x {
    display: inline-flex;
    padding: 1px var(--sp-2) 1px 1px;
    font-size: var(--fs-micro);
    color: var(--muted);
    opacity: 0.7;
  }
  .add {
    display: inline-flex;
    padding: var(--gap-1) var(--sp-2);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-pill);
    font-size: var(--fs-micro);
    color: var(--muted);
  }
  .add[aria-expanded="true"] {
    border-color: var(--theme2);
    color: var(--theme2);
  }
  @media (hover: hover) {
    .chip .x:hover {
      opacity: 1;
      color: var(--color2);
    }
    .add:hover {
      border-color: var(--theme2);
      color: var(--theme2);
    }
    .entry:hover {
      color: var(--theme2);
    }
    .file:hover {
      color: var(--theme2);
    }
  }
  .picker {
    width: 100%;
    margin-top: var(--gap-1);
  }
  .top {
    -webkit-user-select: none;
    user-select: none;
    display: flex;
    flex-direction: column;
  }
  .standalone .top {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-bottom: 1px solid var(--border);
  }
  .standalone .info {
    min-width: 0;
    border-right: 1px solid var(--border);
  }
  .standalone .links:last-child,
  .standalone .mentioned:last-child {
    border-bottom: none;
  }
  .toc {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: var(--gap-2) var(--sp-5) var(--gap-4);
    max-height: 40vh;
    overflow-y: auto;
    min-width: 0;
  }
  .entry {
    max-width: 100%;
    padding: 1px var(--gap-3);
    margin-left: calc((var(--lvl) - 1) * 12px);
    font-size: var(--fs-xs);
    color: var(--color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entry.h1 {
    font-weight: 600;
  }
  .toc .empty {
    font-size: var(--fs-xs);
    font-style: italic;
    color: var(--faint);
    padding: var(--gap-1) var(--gap-3);
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
    gap: var(--gap-2);
    padding: var(--gap-3) var(--sp-5);
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-xs);
  }
  .mentioned .label {
    color: var(--muted);
    margin-right: var(--gap-2);
  }
  footer {
    -webkit-user-select: none;
    user-select: none;
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    padding: var(--gap-4) var(--sp-4);
    border-top: 1px solid var(--border);
  }
  .file {
    min-width: 0;
    margin-right: auto;
    font-family: var(--mono);
    font-size: var(--fs-micro);
    color: var(--faint);
  }
  .file.plain {
    cursor: default;
  }
</style>
