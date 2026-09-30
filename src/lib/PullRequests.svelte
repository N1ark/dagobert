<script lang="ts">
  import { store } from "./store.svelte";
  import type { IssueRef } from "./github";
  import { prCache, linkedRefs, refreshPRs, type Linked } from "./prs.svelte";
  import PrIcon from "./PrIcon.svelte";
  import DockButton from "./DockButton.svelte";
  import { formatAbsolute, IconButton, PanelHeader, persistedFlag, tooltip } from "purr";
  import { relative } from "./time";
  import { t, plural } from "./i18n";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import InlineMd from "./InlineMd.svelte";
  import NoteLink from "./NoteLink.svelte";
  import { inlineHtml } from "./inline";
  import { isMobile } from "./backend";
  import { ArrowsClockwise, ChatCircle, EyeSlash, WarningCircle } from "purr/icons";

  let { onclose, onjump }: { onclose: () => void; onjump: (id: string) => void } = $props();

  const hide = persistedFlag("dagobert.prsHideClosed", false);
  const hideClosed = $derived(hide.value);
  const toggleHide = () => (hide.value = !hide.value);

  const refs = $derived(linkedRefs());
  const details = $derived(prCache.details);
  const stale = $derived(prCache.stale);
  const errors = $derived(prCache.errors);
  const pending = $derived(prCache.pending);

  interface Row {
    ref: Linked;
    pr: IssueRef;
  }
  const rows = $derived.by((): Row[] => {
    const out: Row[] = [];
    for (const ref of refs) {
      const pr = details[ref.key] ?? (ref.key in details ? null : stale[ref.key]);
      if (!pr?.isPr) continue;
      if (hideClosed && pr.state !== "open") continue;
      out.push({ ref, pr });
    }
    out.sort((a, b) => b.pr.updated.localeCompare(a.pr.updated));
    return out;
  });
  function groupBy<T>(list: T[], key: (x: T) => string): [string, T[]][] {
    const by = new Map<string, T[]>();
    for (const x of list) (by.get(key(x)) ?? by.set(key(x), []).get(key(x))!).push(x);
    return [...by];
  }
  /** Grouped per repo (`owner/name`), repos alphabetical, order kept inside. */
  function byRepo<T extends { ref: Linked }>(list: T[]) {
    return groupBy(list, (x) => x.ref.repo)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([repo, items]) => ({ repo, items }));
  }
  const groups = $derived(byRepo(rows));
  const hiddenCount = $derived(hideClosed ? Object.values(details).filter((d) => d?.isPr && d.state !== "open").length : 0);
  /** References that couldn't be read, per repo and then per error, listed under the working ones. */
  const failed = $derived(
    byRepo(refs.filter((ref) => errors[ref.key]).map((ref) => ({ ref }))).map(({ repo, items }) => ({
      repo,
      messages: groupBy(
        items.map((x) => x.ref),
        (ref) => errors[ref.key],
      ),
    })),
  );
  const noRepos = $derived(!Object.keys(store.repos).length);

  function open(url: string) {
    openUrl(url).catch(() => window.open(url, "_blank"));
  }

  /** Whether the clamped title inside a row button is cut off. */
  function overflows(button: HTMLElement): boolean {
    const t = button.querySelector(".t");
    return !!t && t.scrollHeight > t.clientHeight + 1;
  }
</script>

{#snippet notes(list: Linked["notes"])}
  <div class="notes">
    {#each list as n (n.id)}
      <NoteLink id={n.id} {onjump} />
    {/each}
  </div>
{/snippet}

<aside class="prs">
  <PanelHeader
    title={t("prs.title")}
    count={rows.length || hiddenCount ? rows.length : undefined}
    onclose={isMobile ? undefined : onclose}
    closeLabel={t("pane.close")}
  >
    {#if pending}<span class="spin" use:tooltip={t("prs.loading")}><ArrowsClockwise /></span>{/if}
    {#snippet actions()}
      <IconButton label={t(hideClosed ? "prs.showClosed" : "prs.hideClosed")} pressed={hideClosed} onclick={toggleHide}
        ><EyeSlash /></IconButton
      >
      <IconButton label={t("prs.refresh")} disabled={pending} onclick={refreshPRs}><ArrowsClockwise /></IconButton>
      <DockButton />
    {/snippet}
  </PanelHeader>
  <div class="list">
    {#if noRepos}
      <p class="empty"><InlineMd source={t("prs.noRepos")} /></p>
    {:else if !refs.length}
      <p class="empty"><InlineMd source={t("prs.noRefs")} /></p>
    {:else if !rows.length && !pending && !failed.length}
      {#if hiddenCount}
        <button class="empty" onclick={toggleHide}>{plural("prs.allClosed", hiddenCount)}</button>
      {:else}
        <p class="empty">{t("prs.none")}</p>
      {/if}
    {/if}
    {#each groups as { repo, items } (repo)}
      <div class="divider"><span>{repo}</span></div>
      {#each items as { ref, pr } (ref.key)}
        <div class="row">
          <span class="state"><PrIcon key={ref.key} /></span>
          <div class="body">
            <button class="title" onclick={() => open(pr.url)} use:tooltip={(n) => (overflows(n) ? { html: inlineHtml(pr.title) } : null)}>
              <span class="t"><InlineMd source={pr.title} /></span>
            </button>
            <div class="meta">
              <span class="ref">{ref.alias}#{pr.number}</span>
              <span class="author">{pr.author}</span>
              <span use:tooltip={formatAbsolute(pr.updated)}>{relative(pr.updated)}</span>
              {#if pr.comments}<span class="comments"><ChatCircle /> {pr.comments}</span>{/if}
            </div>
            {@render notes(ref.notes)}
          </div>
        </div>
      {/each}
    {/each}
    {#each failed as { repo, messages } (repo)}
      <div class="divider fail"><span>{repo}</span></div>
      {#each messages as [message, list] (message)}
        <div class="row">
          <span class="state fail"><WarningCircle /></span>
          <div class="body">
            <p class="msg">{message}</p>
            {#each list as ref (ref.key)}
              <div class="failed">
                <div class="meta"><span class="ref">{ref.alias}#{ref.number}</span></div>
                {@render notes(ref.notes)}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    {/each}
    {#if hiddenCount && rows.length}
      <button class="foot" onclick={toggleHide}>{t("prs.hidden", { n: hiddenCount })}</button>
    {/if}
  </div>
</aside>

<style>
  .prs {
    -webkit-user-select: none;
    user-select: none;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .spin {
    margin-right: var(--gap-2);
    font-size: var(--icon-sm);
    color: var(--theme2);
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: var(--gap-2);
  }
  .empty {
    margin: 0;
    padding: 20px var(--sp-4);
    text-align: center;
    color: var(--muted);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }
  .empty :global(code) {
    font-family: var(--mono);
    font-size: var(--fs-micro);
  }
  .divider {
    display: flex;
    align-items: center;
    gap: var(--gap-4);
    margin: var(--gap-4) var(--gap-2) var(--gap-1);
    font-family: var(--mono);
    font-size: var(--fs-nano);
    color: var(--muted);
    white-space: nowrap;
  }
  .divider::after {
    content: "";
    flex: 1;
    border-top: 1px solid var(--border-strong);
  }
  .divider:first-child {
    margin-top: 2px;
  }
  .divider.fail {
    color: var(--danger);
  }
  .row {
    display: flex;
    gap: var(--sp-3);
    padding: var(--gap-2) var(--gap-4);
    border-radius: var(--radius);
  }
  @media (hover: hover) {
    .row:hover {
      background: var(--bg3);
    }
  }
  .state {
    flex: none;
    display: inline-flex;
    margin-top: 2px;
  }
  .state.fail {
    color: var(--danger);
  }
  .msg {
    margin: 0;
    font-size: var(--fs-xs);
    line-height: 1.3;
    color: var(--color2);
  }
  .failed {
    margin-top: 6px;
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .title {
    display: block;
    width: 100%;
    text-align: left;
    color: var(--color2);
    font-size: var(--fs-xs);
    font-weight: 500;
    line-height: 1.3;
  }
  @media (hover: hover) {
    .title:hover {
      color: var(--theme2);
    }
  }
  .t :global(code) {
    font-family: var(--mono);
    font-size: 0.92em;
    background: var(--code-bg);
    padding: 0 var(--gap-1);
    border-radius: var(--radius-sm);
  }
  .t {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin-top: 1px;
    font-size: var(--fs-micro);
    color: var(--muted);
    white-space: nowrap;
  }
  .ref {
    font-family: var(--mono);
    color: var(--theme2);
  }
  .author {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .comments {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .notes {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 3px;
  }
  button.empty,
  .foot {
    display: block;
    width: 100%;
  }
  @media (hover: hover) {
    button.empty:hover,
    .foot:hover {
      color: var(--theme2);
    }
  }
  .foot {
    margin: var(--gap-2) 0 0;
    padding: var(--gap-4);
    text-align: center;
    font-size: var(--fs-micro);
    color: var(--faint);
  }
</style>
