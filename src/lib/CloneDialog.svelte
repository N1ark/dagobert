<script lang="ts">
  import { errorMessage, Modal, PanelHeader, rank, SearchInput } from "purr";
  import { CloudArrowDown, LockSimple } from "purr/icons";
  import { backend } from "./backend";
  import { auth } from "./auth.svelte";
  import { store } from "./store.svelte";
  import { listRepos, type RepoRef } from "./github";
  import GitHubSignIn from "./GitHubSignIn.svelte";
  import InlineMd from "./InlineMd.svelte";
  import { t } from "./i18n";

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
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void auth.session;
    void load();
  });

  const shown = $derived(rank(repos, query, { keys: [(r) => r.full_name] }).map((x) => x.item));

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
      error = errorMessage(e);
    } finally {
      cloning = null;
    }
  }
</script>

<Modal label={t("clone.aria")} {onclose} width="460px" closeLabel={t("clone.close")}>
  <PanelHeader title={t("clone.title")} icon={CloudArrowDown} {onclose} closeLabel={t("clone.close")} />
  <div class="body">
    {#if !auth.signedIn}
      <p class="help"><InlineMd source={t("clone.help")} /></p>
      <GitHubSignIn compact />
    {:else}
      <SearchInput
        variant="field"
        bind:value={query}
        label={t("clone.search")}
        placeholder={t("clone.search")}
        spellcheck="false"
        autocapitalize="off"
        data-autofocus
      />
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
            <button class="row-item repo" disabled={!!cloning} onclick={() => clone(repo)}>
              <span class="name">{repo.full_name}</span>
              {#if repo.private}<span class="lock" aria-label={t("clone.private")}><LockSimple /></span>{/if}
              {#if cloning === repo.full_name}<span class="hint">{t("clone.cloning")}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
      <p class="help">
        <button class="btn btn--link" onclick={() => backend.openExternal("https://github.com/settings/installations")}
          >{t("clone.manage")}</button
        >
      </p>
    {/if}
    {#if error}<p class="err">{error}</p>{/if}
  </div>
</Modal>

<style>
  .body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    max-height: 70vh;
    padding: var(--sp-5);
  }
  .repos {
    flex: 1;
    min-height: 0;
    overflow: auto;
    list-style: none;
    margin: var(--gap-4) 0 0;
    padding: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lock {
    color: var(--muted);
    display: inline-flex;
  }
  .help {
    margin: var(--gap-4) 0 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .help :global(code) {
    font-family: var(--mono);
    font-size: 0.9em;
    background: var(--code-bg);
    padding: 1px var(--gap-2);
    border-radius: var(--radius-sm);
  }
  .hint {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .err {
    margin: var(--gap-4) 0 0;
    font-size: var(--fs-xs);
    color: var(--danger);
  }
</style>
