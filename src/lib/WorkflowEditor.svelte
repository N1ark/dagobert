<script lang="ts">
  import { store } from "./store.svelte";
  import type { Workflow } from "./types";
  import X from "phosphor-svelte/lib/X";
  import ArrowUp from "phosphor-svelte/lib/ArrowUp";
  import ArrowDown from "phosphor-svelte/lib/ArrowDown";
  import Plus from "phosphor-svelte/lib/Plus";
  import ColorPicker from "./ColorPicker.svelte";
  import { stageColor } from "./workflows";
  import { storedToken, setStoredToken } from "./github";
  import GithubLogo from "phosphor-svelte/lib/GithubLogo";
  import GitBranch from "phosphor-svelte/lib/GitBranch";
  import Circuitry from "phosphor-svelte/lib/Circuitry";
  import { tooltip } from "./tooltip";
  import { relative } from "./time";
  import InlineMd from "./InlineMd.svelte";
  import { t, plural } from "./i18n";

  type Section = "workflows" | "tracking" | "github" | "git";
  let { onclose, section = "workflows" }: { onclose: () => void; section?: Section } = $props();

  // svelte-ignore state_referenced_locally
  let page = $state<Section>(section);
  let interval = $state(store.gitInterval);
  $effect(() => {
    if (page === "git") store.refreshGitStatus();
  });
  let ghToken = $state(storedToken());
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

  let picking = $state<number | null>(null);
  let selectedId = $state<string | null>(store.workflows[0]?.id ?? null);
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
  function onKey(e: KeyboardEvent) {
    // The no-repo dialog stacked on top takes the Escape.
    if (e.key === "Escape" && !store.needsRepo) {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-label={t("settings.aria")} tabindex="-1">
    <header>
      <h3>
        {t(
          page === "github"
            ? "settings.github"
            : page === "git"
              ? "settings.git"
              : page === "tracking"
                ? "settings.tracking"
                : "settings.workflows",
        )}
      </h3>
      <button class="ghost" onclick={onclose} aria-label={t("settings.close")}><X size={16} /></button>
    </header>
    <div class="cols">
      <nav>
        <button
          class="ghost item"
          class:active={page === "workflows" && selectedId === null}
          onclick={() => ((page = "workflows"), (selectedId = null))}
        >
          {t("settings.nav.todo")}
          <span class="builtin" use:tooltip={t("settings.nav.builtin")}><Circuitry size={13} /></span>
        </button>
        <button class="ghost item" class:active={page === "tracking"} onclick={() => (page = "tracking")}>
          {t("settings.nav.tracking")}
          <span class="builtin" use:tooltip={t("settings.nav.builtin")}><Circuitry size={13} /></span>
        </button>
        {#each store.workflows as w (w.id)}
          <button
            class="ghost item"
            class:active={page === "workflows" && w.id === selectedId}
            onclick={() => ((page = "workflows"), (selectedId = w.id))}>{w.name || t("settings.nav.unnamed")}</button
          >
        {/each}
        <button class="ghost add" onclick={() => ((page = "workflows"), add())}><Plus size={13} /> {t("settings.nav.new")}</button>
        <div class="nav-sep"></div>
        <button class="ghost item" class:active={page === "github"} onclick={() => (page = "github")}
          ><GithubLogo size={14} /> {t("settings.github")}</button
        >
        <button class="ghost item" class:active={page === "git"} onclick={() => (page = "git")}
          ><GitBranch size={14} /> {t("settings.git")}</button
        >
      </nav>
      <section>
        {#if page === "tracking"}
          <p class="help"><InlineMd source={t("settings.tracking.help")} /></p>
          <h4>{t("settings.template")}</h4>
          <p class="help">{t("settings.template.hint")}</p>
          <textarea
            class="template"
            rows="6"
            bind:value={store.trackingTemplate}
            onchange={() => store.saveMeta()}
            placeholder={t("settings.tracking.placeholder")}
            spellcheck="false"></textarea>
        {:else if page === "git"}
          <p class="help"><InlineMd source={t("settings.git.help")} /></p>
          <label class="row">
            <input
              type="checkbox"
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
          {#if store.gitEnabled}
            <label class="row">
              {t("settings.git.every")}
              <input
                class="num"
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
              <button onclick={() => store.syncNow(true)} disabled={store.gitState === "syncing"}>{t("settings.git.syncNow")}</button>
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
                <button class="ghost sm" onclick={() => store.setRepo(alias, null)} aria-label={t("settings.github.remove", { alias })}
                  ><X size={13} /></button
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
            <input placeholder={t("settings.github.alias")} bind:value={newAlias} spellcheck="false" />
            <input class="grow" placeholder={t("settings.github.repo")} bind:value={newRepo} spellcheck="false" />
            <button type="submit" disabled={!newAlias.trim() || !newRepo.trim()}><Plus size={13} /> {t("settings.github.add")}</button>
          </form>
          <h4>{t("settings.github.token")}</h4>
          <p class="help"><InlineMd source={t("settings.github.token.help")} /></p>
          <input
            class="token"
            type="password"
            placeholder={t("settings.github.token.placeholder")}
            bind:value={ghToken}
            onchange={() => setStoredToken(ghToken)}
            spellcheck="false"
          />
        {:else if wf}
          <input class="name" bind:value={wf.name} onchange={() => commit(wf)} placeholder={t("settings.wf.name")} />
          <p class="help">{t("settings.wf.help")}</p>
          <ol>
            {#each wf.stages as stage, i (i)}
              <li>
                <span class="n">{i + 1}</span>
                <span class="dot-wrap">
                  <button
                    class="dot"
                    style="--c:{stageColor(wf, stage.name)}"
                    title={t("settings.wf.pillColor")}
                    aria-label={t("settings.wf.colorOf", { stage: stage.name })}
                    onclick={() => (picking = picking === i ? null : i)}
                  ></button>
                  {#if picking === i}
                    <ColorPicker
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
                </span>
                <input class="stage" bind:value={stage.name} onchange={() => commit(wf)} />
                <label class="done" title={t("settings.wf.countsDone")}>
                  <input type="checkbox" bind:checked={stage.done} onchange={() => commit(wf)} />
                  {t("settings.wf.done")}
                </label>
                <button class="ghost sm" disabled={i === 0} onclick={() => move(wf, i, -1)} aria-label={t("settings.wf.up")}
                  ><ArrowUp size={13} /></button
                >
                <button
                  class="ghost sm"
                  disabled={i === wf.stages.length - 1}
                  onclick={() => move(wf, i, 1)}
                  aria-label={t("settings.wf.down")}><ArrowDown size={13} /></button
                >
                <button
                  class="ghost sm"
                  disabled={wf.stages.length <= 1}
                  onclick={() => removeStage(wf, i)}
                  aria-label={t("settings.wf.removeStage")}><X size={13} /></button
                >
              </li>
            {/each}
          </ol>
          <div class="actions">
            <button onclick={() => addStage(wf)}><Plus size={13} /> {t("settings.wf.addStage")}</button>
            <span class="spacer"></span>
            <span class="usage">{plural("settings.wf.usage", usage)}</span>
            <button class="ghost danger" onclick={() => remove(wf)}>{t("settings.wf.delete")}</button>
          </div>
          <h4>{t("settings.template")}</h4>
          <p class="help">{t("settings.template.hint")}</p>
          <textarea
            class="template"
            rows="6"
            bind:value={wf.template}
            onchange={() => commit(wf)}
            placeholder={t("settings.wf.placeholder")}
            spellcheck="false"></textarea>
        {:else}
          <p class="help"><InlineMd source={t("settings.todo.help")} /></p>
          <h4>{t("settings.template")}</h4>
          <p class="help">{t("settings.template.hint")}</p>
          <textarea
            class="template"
            rows="6"
            bind:value={store.defaultTemplate}
            onchange={() => store.saveMeta()}
            placeholder={t("settings.todo.placeholder")}
            spellcheck="false"></textarea>
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
  /* Built-in marker: pushed to the right edge of the item; the tooltip explains it. */
  .builtin {
    display: inline-flex;
    margin-left: auto;
    padding-left: 8px;
    flex-shrink: 0;
    color: var(--color-dim);
  }
  .nav-sep {
    height: 1px;
    margin: 6px 4px;
    background: var(--border2);
  }
  .repos {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
  }
  .repos li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
    font-size: 13px;
  }
  .alias {
    font-family: var(--mono);
    color: var(--accent2);
  }
  .arrow {
    color: var(--color-dim);
  }
  .repo {
    flex: 1;
    color: var(--color);
  }
  .add-repo {
    display: flex;
    gap: 6px;
    margin-bottom: 4px;
  }
  .add-repo input {
    width: 110px;
    font-size: 13px;
  }
  .add-repo .grow {
    flex: 1;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0;
    font-size: 13px;
    color: var(--color);
  }
  .row input[type="checkbox"] {
    accent-color: var(--accent);
    margin: 0;
  }
  .num {
    width: 60px;
    font-size: 13px;
  }
  .info {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    margin: 6px 0 0;
    font-size: 13px;
  }
  .info dt {
    color: var(--color-dim);
  }
  .info dd {
    margin: 0;
    color: var(--color);
  }
  .err {
    color: var(--red);
  }
  .token {
    width: 100%;
    font-family: var(--mono);
    font-size: 12px;
  }
  section :global(code) {
    font-family: var(--mono);
    font-size: 0.9em;
    background: var(--code-bg);
    padding: 1px 4px;
    border-radius: 3px;
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
