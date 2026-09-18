<script lang="ts">
  import { store } from "./store.svelte";
  import type { Workflow } from "./types";
  import X from "phosphor-svelte/lib/X";
  import ArrowUp from "phosphor-svelte/lib/ArrowUp";
  import ArrowDown from "phosphor-svelte/lib/ArrowDown";
  import Plus from "phosphor-svelte/lib/Plus";
  import ColorPicker from "./ColorPicker.svelte";
  import { stageColor } from "./workflows";

  let { onclose }: { onclose: () => void } = $props();

  let picking = $state<number | null>(null);
  let selectedId = $state<string | null>(store.workflows[0]?.id ?? null);
  const wf = $derived(store.workflows.find((w) => w.id === selectedId) ?? null);
  const usage = $derived(wf ? store.notes.filter((n) => n.workflow === wf.id).length : 0);
  const TEMPLATE_HINT = "Default body for new notes. Placeholders: {{date}}, {{title}}.";

  function commit(w: Workflow) {
    // Stage names must be unique and non-empty.
    const seen = new Set<string>();
    for (const s of w.stages) {
      let name = s.name.trim() || "stage";
      while (seen.has(name)) name += "'";
      seen.add(name);
      s.name = name;
    }
    if (!w.stages.length) w.stages.push({ name: "todo", done: false });
    store.updateWorkflow(w);
  }

  function addStage(w: Workflow) {
    w.stages.splice(w.stages.length - 1, 0, { name: "stage", done: false });
    commit(w);
  }
  function removeStage(w: Workflow, i: number) {
    w.stages.splice(i, 1);
    commit(w);
  }
  function move(w: Workflow, i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= w.stages.length) return;
    [w.stages[i], w.stages[j]] = [w.stages[j], w.stages[i]];
    commit(w);
  }
  function add() {
    selectedId = store.addWorkflow().id;
  }
  function remove(w: Workflow) {
    store.removeWorkflow(w.id);
    selectedId = store.workflows[0]?.id ?? null;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Workflows" tabindex="-1">
    <header>
      <h3>Workflows</h3>
      <button class="ghost" onclick={onclose} aria-label="close"><X size={16} /></button>
    </header>
    <div class="cols">
      <nav>
        <button class="ghost item" class:active={selectedId === null} onclick={() => (selectedId = null)}>Todo <span class="sub">built-in</span></button>
        {#each store.workflows as w (w.id)}
          <button class="ghost item" class:active={w.id === selectedId} onclick={() => (selectedId = w.id)}>{w.name || "Unnamed"}</button>
        {/each}
        <button class="ghost add" onclick={add}><Plus size={13} /> New workflow</button>
      </nav>
      <section>
        {#if wf}
          <input class="name" bind:value={wf.name} onchange={() => commit(wf)} placeholder="Workflow name" />
          <p class="help">Stages in order. Tick the ones that count as done; click a dot to pick the pill colour.</p>
          <ol>
            {#each wf.stages as stage, i (i)}
              <li>
                <span class="n">{i + 1}</span>
                <span class="dot-wrap">
                  <button class="dot" style="--c:{stageColor(wf, stage.name)}" title="Pill colour" aria-label="colour of {stage.name}" onclick={() => (picking = picking === i ? null : i)}></button>
                  {#if picking === i}
                    <ColorPicker
                      value={stage.color ?? null}
                      allowAuto
                      onpick={(c) => {
                        stage.color = c;
                        commit(wf);
                      }}
                      onclose={() => (picking = null)}
                      label="stage colour"
                    />
                  {/if}
                </span>
                <input class="stage" bind:value={stage.name} onchange={() => commit(wf)} />
                <label class="done" title="Counts as done">
                  <input type="checkbox" bind:checked={stage.done} onchange={() => commit(wf)} />
                  done
                </label>
                <button class="ghost sm" disabled={i === 0} onclick={() => move(wf, i, -1)} aria-label="move up"><ArrowUp size={13} /></button>
                <button class="ghost sm" disabled={i === wf.stages.length - 1} onclick={() => move(wf, i, 1)} aria-label="move down"><ArrowDown size={13} /></button>
                <button class="ghost sm" disabled={wf.stages.length <= 1} onclick={() => removeStage(wf, i)} aria-label="remove stage"><X size={13} /></button>
              </li>
            {/each}
          </ol>
          <div class="actions">
            <button onclick={() => addStage(wf)}><Plus size={13} /> Stage</button>
            <span class="spacer"></span>
            <span class="usage">{usage} note{usage === 1 ? "" : "s"}</span>
            <button class="ghost danger" onclick={() => remove(wf)}>Delete workflow</button>
          </div>
          <h4>Template</h4>
          <p class="help">{TEMPLATE_HINT}</p>
          <textarea class="template" rows="6" bind:value={wf.template} onchange={() => commit(wf)} placeholder="## Checklist&#10;- [ ] …" spellcheck="false"></textarea>
        {:else}
          <p class="help">
            The built-in <b>Todo</b> workflow is just <i>todo → done</i>. Create a workflow to track
            richer progress, e.g. <i>todo → in progress → under review → merged</i>.
          </p>
          <h4>Template</h4>
          <p class="help">{TEMPLATE_HINT}</p>
          <textarea class="template" rows="6" bind:value={store.defaultTemplate} onchange={() => store.saveMeta()} placeholder="- [ ] …" spellcheck="false"></textarea>
        {/if}
      </section>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: #00000088;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dialog {
    width: 600px;
    max-width: calc(100vw - 40px);
    background: var(--bg2);
    border-radius: 10px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  h3 {
    margin: 0;
    font-size: 15px;
    color: var(--color2);
  }
  .cols {
    display: grid;
    grid-template-columns: 170px 1fr;
    min-height: 280px;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px;
    border-right: 1px solid var(--border);
  }
  .item {
    text-align: left;
    color: var(--color);
  }
  .item.active {
    background: #ffffff10;
    color: var(--color2);
  }
  .sub {
    font-size: 10px;
    color: var(--color-dim);
    margin-left: 4px;
  }
  .add {
    margin-top: auto;
    color: var(--accent2);
    text-align: left;
  }
  section {
    padding: 12px 16px;
  }
  .name {
    width: 100%;
    font-size: 15px;
    font-weight: 600;
    color: var(--color2);
  }
  .help {
    margin: 8px 0 12px;
    font-size: 12px;
    color: var(--color-dim);
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .n {
    width: 16px;
    font-size: 11px;
    color: var(--color-dim);
    text-align: right;
  }
  .dot-wrap {
    position: relative;
    display: flex;
  }
  .dot {
    width: 14px;
    height: 14px;
    padding: 0;
    border-radius: 50%;
    border: none;
    background: var(--c);
  }
  .dot:hover {
    background: var(--c);
    box-shadow: 0 0 0 2px var(--color2);
  }
  .stage {
    flex: 1;
    font-size: 13px;
    padding: 4px 8px;
  }
  .done {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--color-dim);
    cursor: pointer;
  }
  .done input {
    accent-color: var(--green);
    margin: 0;
  }
  .sm {
    padding: 2px 6px;
    font-size: 12px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
  .spacer {
    flex: 1;
  }
  .usage {
    font-size: 11px;
    color: var(--color-dim);
  }
  .actions button {
    font-size: 12px;
  }
  h4 {
    margin: 16px 0 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-dim);
  }
  h4 + .help {
    margin-top: 4px;
  }
  .template {
    width: 100%;
    resize: vertical;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.5;
  }
</style>
