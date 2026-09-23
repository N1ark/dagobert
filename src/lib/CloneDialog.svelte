<script lang="ts">
  import { backend } from "./backend";
  import { auth } from "./auth.svelte";
  import { store } from "./store.svelte";
  import { listRepos, type RepoRef } from "./github";
  import { fuzzyMatch } from "./fuzzy";
  import X from "phosphor-svelte/lib/X";
  import CloudArrowDown from "phosphor-svelte/lib/CloudArrowDown";
  import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";
  import LockSimple from "phosphor-svelte/lib/LockSimple";
  import GitHubSignIn from "./GitHubSignIn.svelte";
  import InlineMd from "./InlineMd.svelte";
  import { t } from "./i18n";
  import { onEscape } from "./keys";

  let { onclose }: { onclose: () => void } = $props();

  let repos = $state<RepoRef[]>([]);
  let query = $state("");
  let loading = $state(false);
  let cloning = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function load() {
    if (!auth.signedIn) return;
    loading = true;
    error = null;
    try {
      repos = await listRepos();
    } catch (e) {
      error = typeof e === "string" ? e : ((e as Error)?.message ?? String(e));
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void auth.session;
    void load();
  });

  const shown = $derived(
    query.trim()
      ? repos
          .map((r) => ({ r, m: fuzzyMatch(query.trim(), r.full_name) }))
          .filter((x) => x.m.score > 0)
          .sort((a, b) => b.m.score - a.m.score)
          .map((x) => x.r)
      : repos,
  );

  async function clone(repo: RepoRef) {
    if (cloning) return;
    cloning = repo.full_name;
    error = null;
    try {
      const s = auth.session;
      const p = await backend.cloneProject(repo.clone_url, await auth.token(), s?.name ?? "", s?.email ?? "");
      onclose();
      await store.open(p.path);
      // A phone only ever syncs; a clone that arrived untracked still tracks.
      if (!store.gitEnabled) await store.enableGit();
    } catch (e) {
      error = typeof e === "string" ? e : ((e as Error)?.message ?? String(e));
    } finally {
      cloning = null;
    }
  }
</script>

<svelte:window onkeydown={(e) => onEscape(e, onclose)} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-label={t("clone.aria")} tabindex="-1">
    <header>
      <h3><CloudArrowDown size={15} /> {t("clone.title")}</h3>
      <button class="ghost" onclick={onclose} aria-label={t("clone.close")}><X size={16} /></button>
    </header>
    <div class="body">
      {#if !auth.signedIn}
        <p class="help"><InlineMd source={t("clone.help")} /></p>
        <GitHubSignIn compact />
      {:else}
        <div class="search">
          <MagnifyingGlass size={14} />
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={query} placeholder={t("clone.search")} spellcheck="false" autocapitalize="off" autofocus />
        </div>
        {#if loading}
          <p class="hint">{t("clone.loading")}</p>
        {:else if !repos.length}
          <p class="hint">{t("clone.noRepos")}</p>
        {:else if !shown.length}
          <p class="hint">{t("clone.noMatch")}</p>
        {/if}
        <ul class="repos">
          {#each shown as repo (repo.full_name)}
            <li>
              <button class="ghost repo" disabled={!!cloning} onclick={() => clone(repo)}>
                <span class="name">{repo.full_name}</span>
                {#if repo.private}<span class="lock" aria-label={t("clone.private")}><LockSimple size={12} /></span>{/if}
                {#if cloning === repo.full_name}<span class="hint">{t("clone.cloning")}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
        <p class="help">
          <button class="ghost link" onclick={() => backend.openExternal("https://github.com/settings/installations")}
            >{t("clone.manage")}</button
          >
        </p>
      {/if}
      {#if error}<p class="err">{error}</p>{/if}
    </div>
  </div>
</div>

<style>
  .dialog {
    display: flex;
    flex-direction: column;
    width: 460px;
    max-height: 80vh;
  }
  .dialog h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 14px 16px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--bg);
    color: var(--color-dim);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    padding: 6px 2px;
  }
  .repos {
    flex: 1;
    min-height: 0;
    overflow: auto;
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }
  .repo {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 8px;
    text-align: left;
    color: var(--color);
    border-radius: var(--radius);
  }
  .repo:hover:not(:disabled) {
    background: var(--bg3);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lock {
    color: var(--color-dim);
    display: inline-flex;
  }
  .help {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--color-dim);
  }
  .help :global(code) {
    font-family: var(--mono);
    font-size: 0.9em;
    background: var(--code-bg);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .link {
    padding: 0;
    color: var(--accent2);
    text-decoration: underline;
  }
  .hint {
    font-size: 12px;
    color: var(--color-dim);
  }
  .err {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--red);
  }
</style>
