<script lang="ts">
  import { store } from "./store.svelte";
  import type { Workflow } from "./types";
  import { X, ArrowUp, ArrowDown, Plus, GithubLogo, GitBranch, Circuitry } from "purr/icons";
  import ColorPicker from "./ColorPicker.svelte";
  import DockButton from "./DockButton.svelte";
  import { stageColor } from "./workflows";
  import GitHubSignIn from "./GitHubSignIn.svelte";
  import { isMobile } from "./backend";
  import { IconButton, PanelHeader, SettingsLayout, tooltip, type SettingsGroup } from "purr";
  import { relative } from "./time";
  import InlineMd from "./InlineMd.svelte";
  import { t, plural } from "./i18n";

  type Section = "workflows" | "tracking" | "note" | "github" | "git";
  let { onclose, section = "workflows", workflow }: { onclose: () => void; section?: Section; workflow?: string | null } = $props();

  // svelte-ignore state_referenced_locally
  let page = $state<Section>(section);
  // svelte-ignore state_referenced_locally
  let selectedId = $state<string | null>(workflow === undefined ? (store.workflows[0]?.id ?? null) : workflow);
  let interval = $state(store.gitInterval);
  $effect(() => {
    if (page === "git") store.refreshGitStatus();
  });
  let newAlias = $state("");
  let newRepo = $state("");

  function addRepo() {
    const a = newAlias.trim();
    const r = newRepo
      .trim()
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\/+$/, "");
    if (!a || !/^[\w.-]+\/[\w.-]+$/.test(r)) return;
    store.setRepo(a, r);
    newAlias = "";
    newRepo = "";
  }

  const groups = $derived<SettingsGroup[]>([
    {
      label: t("settings.group.general"),
      sections: [
        { id: "github", label: t("settings.github"), icon: GithubLogo },
        { id: "git", label: t("settings.git"), icon: GitBranch },
      ],
    },
    {
      label: t("settings.group.workflows"),
      footer: newWorkflow,
      sections: [
        { id: "todo", label: t("settings.nav.todo"), trailing: builtin },
        { id: "tracking", label: t("settings.nav.tracking"), trailing: builtin },
        { id: "note", label: t("settings.nav.note"), trailing: builtin },
        ...store.workflows.map((w) => ({ id: `wf:${w.id}`, label: w.name || t("settings.nav.unnamed") })),
      ],
    },
  ]);
  const current = $derived(page === "workflows" ? (selectedId === null ? "todo" : `wf:${selectedId}`) : page);

  function select(id: string) {
    if (id === "github" || id === "git" || id === "tracking" || id === "note") {
      page = id;
      return;
    }
    page = "workflows";
    selectedId = id.startsWith("wf:") ? id.slice(3) : null;
  }

  let picking = $state<{ index: number; anchor: HTMLElement } | null>(null);
  const wf = $derived(store.workflows.find((w) => w.id === selectedId) ?? null);
  const usage = $derived(wf ? store.notes.filter((n) => n.workflow === wf.id).length : 0);

  function commit(w: Workflow) {
    // Stage names must be unique and non-empty.
    const seen = new Set<string>();
    for (const s of w.stages) {
      let name = s.name.trim() || t("workflow.stage");
      while (seen.has(name)) name += "'";
      seen.add(name);
      s.name = name;
    }
    if (!w.stages.length) w.stages.push({ name: t("workflow.stage.todo"), done: false });
    store.updateWorkflow(w);
  }

  function addStage(w: Workflow) {
    w.stages.splice(w.stages.length - 1, 0, { name: t("workflow.stage"), done: false });
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
</script>

{#snippet builtin()}
  <span class="builtin" use:tooltip={t("settings.nav.builtin")}><Circuitry /></span>
{/snippet}

{#snippet newWorkflow()}
  <button class="row-item add" onclick={() => ((page = "workflows"), add())}><Plus /> {t("settings.nav.new")}</button>
{/snippet}

{#snippet template(get: () => string, set: (v: string) => void, save: () => void, placeholder: string)}
  <h4>{t("settings.template")}</h4>
  <p class="help">{t("settings.template.hint")}</p>
  <textarea class="field-input template" rows="6" bind:value={get, set} onchange={save} {placeholder} spellcheck="false"></textarea>
{/snippet}

<div class="pane settings">
  <PanelHeader title={t("settings.title")} onclose={isMobile ? undefined : onclose} closeLabel={t("pane.close")}>
    {#snippet actions()}<DockButton />{/snippet}
  </PanelHeader>
  <SettingsLayout {groups} {current} onselect={select} label={t("settings.title")}>
    <section>
      {#if page === "tracking"}
        <p class="help"><InlineMd source={t("settings.tracking.help")} /></p>
        {@render template(
          () => store.trackingTemplate,
          (v) => (store.trackingTemplate = v),
          () => store.saveMeta(),
          t("settings.tracking.placeholder"),
        )}
      {:else if page === "note"}
        <p class="help"><InlineMd source={t("settings.note.help")} /></p>
        {@render template(
          () => store.noteTemplate,
          (v) => (store.noteTemplate = v),
          () => store.saveMeta(),
          t("settings.note.placeholder"),
        )}
      {:else if page === "git"}
        <p class="help"><InlineMd source={t("settings.git.help")} /></p>
        {#if !isMobile}
          <label class="row">
            <input
              type="checkbox"
              class="checkbox"
              checked={store.gitEnabled}
              onchange={async (e) => {
                const box = e.currentTarget;
                if (store.gitEnabled) store.disableGit();
                else await store.enableGit();
                // Enabling can be declined (no repository): keep the box honest.
                box.checked = store.gitEnabled;
              }}
            />
            {t("settings.git.enable")}
          </label>
        {/if}
        {#if store.gitEnabled}
          <label class="row">
            {t("settings.git.every")}
            <input
              class="field-input num"
              type="number"
              min="1"
              max="120"
              bind:value={interval}
              onchange={() => ((interval = Math.max(1, Math.min(120, Math.round(interval) || 5))), store.setGitInterval(interval))}
            />
            {t("settings.git.minutes")}
          </label>
          <h4>{t("settings.git.repo")}</h4>
          <dl class="info">
            <dt>{t("settings.git.branch")}</dt>
            <dd>{store.gitStatus?.branch ?? t("app.dash")}</dd>
            <dt>{t("settings.git.remote")}</dt>
            <dd>
              {#if !store.gitStatus}{t("app.dash")}{:else if !store.gitStatus.has_remote}{t(
                  "settings.git.remote.none",
                )}{:else if !store.gitStatus.has_upstream}{t("settings.git.remote.unpushed")}{:else}{t("settings.git.remote.position", {
                  ahead: store.gitStatus.ahead,
                  behind: store.gitStatus.behind,
                })}{/if}
            </dd>
            <dt>{t("settings.git.lastSync")}</dt>
            <dd>
              {#if store.gitState === "syncing"}{t("settings.git.syncing")}{:else if store.gitState === "error"}<span class="err"
                  >{store.gitError}</span
                >{:else if store.gitLastSync}{relative(store.gitLastSync)}{:else}{t("settings.git.notYet")}{/if}
            </dd>
          </dl>
          <div class="actions">
            <button class="btn" onclick={() => store.syncNow(true)} disabled={store.gitState === "syncing"}
              >{t("settings.git.syncNow")}</button
            >
          </div>
        {/if}
      {:else if page === "github"}
        <h4>{t("settings.github.repos")}</h4>
        <p class="help"><InlineMd source={t("settings.github.help")} /></p>
        <ul class="repos">
          {#each Object.entries(store.repos) as [alias, repo] (alias)}
            <li>
              <span class="alias">{alias}</span>
              <span class="arrow">→</span>
              <span class="repo">{repo}</span>
              <IconButton label={t("settings.github.remove", { alias })} size="sm" danger onclick={() => store.setRepo(alias, null)}
                ><X /></IconButton
              >
            </li>
          {/each}
        </ul>
        <form
          class="add-repo"
          onsubmit={(e) => {
            e.preventDefault();
            addRepo();
          }}
        >
          <input class="field-input" placeholder={t("settings.github.alias")} bind:value={newAlias} spellcheck="false" />
          <input class="field-input grow" placeholder={t("settings.github.repo")} bind:value={newRepo} spellcheck="false" />
          <button class="btn" type="submit" disabled={!newAlias.trim() || !newRepo.trim()}><Plus /> {t("settings.github.add")}</button>
        </form>
        <h4>{t("settings.github.account")}</h4>
        <p class="help"><InlineMd source={t("settings.github.signin.help")} /></p>
        <GitHubSignIn />
      {:else if wf}
        <input class="field-input name" bind:value={wf.name} onchange={() => commit(wf)} placeholder={t("settings.wf.name")} />
        <p class="help">{t("settings.wf.help")}</p>
        <ol>
          {#each wf.stages as stage, i (i)}
            <li>
              <span class="n">{i + 1}</span>
              <button
                class="swatch"
                style:--c={stageColor(wf, stage.name)}
                title={t("settings.wf.pillColor")}
                aria-label={t("settings.wf.colorOf", { stage: stage.name })}
                onclick={(e) => (picking = picking?.index === i ? null : { index: i, anchor: e.currentTarget })}
              ></button>
              {#if picking?.index === i}
                <ColorPicker
                  anchor={picking.anchor}
                  value={stage.color ?? null}
                  allowAuto
                  onpick={(c) => {
                    stage.color = c;
                    commit(wf);
                  }}
                  onclose={() => (picking = null)}
                  label={t("settings.wf.stageColor")}
                />
              {/if}
              <input class="field-input stage" bind:value={stage.name} onchange={() => commit(wf)} />
              <label class="done" title={t("settings.wf.countsDone")}>
                <input type="checkbox" class="checkbox" bind:checked={stage.done} onchange={() => commit(wf)} />
                {t("settings.wf.done")}
              </label>
              <IconButton label={t("settings.wf.up")} size="sm" disabled={i === 0} onclick={() => move(wf, i, -1)}><ArrowUp /></IconButton>
              <IconButton label={t("settings.wf.down")} size="sm" disabled={i === wf.stages.length - 1} onclick={() => move(wf, i, 1)}
                ><ArrowDown /></IconButton
              >
              <IconButton
                label={t("settings.wf.removeStage")}
                size="sm"
                danger
                disabled={wf.stages.length <= 1}
                onclick={() => removeStage(wf, i)}><X /></IconButton
              >
            </li>
          {/each}
        </ol>
        <div class="actions">
          <button class="btn btn--sm" onclick={() => addStage(wf)}><Plus /> {t("settings.wf.addStage")}</button>
          <span class="spacer"></span>
          <span class="usage">{plural("settings.wf.usage", usage)}</span>
          <button class="btn btn--ghost btn--danger btn--sm" onclick={() => remove(wf)}>{t("settings.wf.delete")}</button>
        </div>
        {@render template(
          () => wf.template,
          (v) => (wf.template = v),
          () => commit(wf),
          t("settings.wf.placeholder"),
        )}
      {:else}
        <p class="help"><InlineMd source={t("settings.todo.help")} /></p>
        {@render template(
          () => store.defaultTemplate,
          (v) => (store.defaultTemplate = v),
          () => store.saveMeta(),
          t("settings.todo.placeholder"),
        )}
      {/if}
    </section>
  </SettingsLayout>
</div>

<style>
  /* Built-in marker; the tooltip explains it. */
  .builtin {
    display: inline-flex;
  }
  .repos {
    list-style: none;
    margin: 0 0 var(--gap-4);
    padding: 0;
  }
  .repos li {
    display: flex;
    align-items: center;
    gap: var(--gap-4);
    padding: var(--gap-1) 0;
    font-size: var(--fs-sm);
  }
  .alias {
    font-family: var(--mono);
    color: var(--theme2);
  }
  .arrow {
    color: var(--muted);
  }
  .repo {
    flex: 1;
    color: var(--color);
  }
  .add-repo {
    display: flex;
    gap: var(--gap-3);
    margin-bottom: var(--gap-2);
  }
  .add-repo input {
    width: 110px;
  }
  .add-repo .grow {
    flex: 1;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    margin: var(--gap-3) 0;
    font-size: var(--fs-sm);
    color: var(--color);
  }
  .num {
    width: 60px;
  }
  .info {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--gap-2) var(--sp-4);
    margin: var(--gap-3) 0 0;
    font-size: var(--fs-sm);
  }
  .info dt {
    color: var(--muted);
  }
  .info dd {
    margin: 0;
    color: var(--color);
  }
  .err {
    color: var(--danger);
  }
  .add {
    color: var(--theme2);
  }
  .name {
    font-size: var(--fs-lg);
    font-weight: 600;
  }
  .help {
    margin: var(--gap-4) 0 var(--sp-4);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--gap-2);
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    min-width: 0;
  }
  .n {
    width: 16px;
    font-size: var(--fs-micro);
    color: var(--muted);
    text-align: right;
  }
  .stage {
    flex: 1;
    /* Without this an input refuses to shrink past its intrinsic width and the
       row scrolls sideways to fit the buttons. */
    width: auto;
    min-width: 0;
  }
  .done {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-2);
    font-size: var(--fs-xs);
    color: var(--muted);
    cursor: pointer;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--gap-4);
    margin-top: var(--sp-4);
  }
  .spacer {
    flex: 1;
  }
  .usage {
    font-size: var(--fs-micro);
    color: var(--muted);
  }
  h4 {
    margin: var(--sp-5) 0 0;
    font-size: var(--fs-micro);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  h4 + .help {
    margin-top: var(--gap-2);
  }
  .template {
    font-family: var(--mono);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }
</style>
