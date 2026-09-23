<script lang="ts">
  import { store } from "./store.svelte";
  import type { IssueRef } from "./github";
  import { prCache, linkedRefs, refreshPRs, type Linked } from "./prs.svelte";
  import PrIcon from "./PrIcon.svelte";
  import { relative, absolute } from "./time";
  import { tooltip } from "./tooltip";
  import { t, plural } from "./i18n";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import InlineMd from "./InlineMd.svelte";
  import { inlineHtml } from "./inline";
  import X from "phosphor-svelte/lib/X";
  import ArrowsClockwise from "phosphor-svelte/lib/ArrowsClockwise";
  import ChatCircle from "phosphor-svelte/lib/ChatCircle";
  import EyeSlash from "phosphor-svelte/lib/EyeSlash";
  import WarningCircle from "phosphor-svelte/lib/WarningCircle";

  let { onclose, onjump, sheet = false }: { onclose: () => void; onjump: (id: string) => void; sheet?: boolean } = $props();

  const HIDE_KEY = "dagobert.prsHideClosed";
  let hideClosed = $state(localStorage.getItem(HIDE_KEY) === "1");
  function toggleHide() {
    hideClosed = !hideClosed;
    localStorage.setItem(HIDE_KEY, hideClosed ? "1" : "0");
  }

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
      if (!pr) continue;
      if (hideClosed && pr.state !== "open") continue;
      out.push({ ref, pr });
    }
    out.sort((a, b) => b.pr.updated.localeCompare(a.pr.updated));
    return out;
  });
  /** Rows grouped per repo (`owner/name`), repos alphabetical, newest PR first inside. */
  const groups = $derived.by(() => {
    const by = new Map<string, Row[]>();
    for (const r of rows) (by.get(r.ref.repo) ?? by.set(r.ref.repo, []).get(r.ref.repo)!).push(r);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([repo, items]) => ({ repo, items }));
  });
  const hiddenCount = $derived(hideClosed ? Object.values(details).filter((d) => d && d.state !== "open").length : 0);
  /** References that couldn't be read, grouped per repo and listed under the working ones. */
  const failed = $derived.by(() => {
    const by = new Map<string, { ref: Linked; message: string }[]>();
    for (const ref of refs) {
      const message = errors[ref.key];
      if (!message) continue;
      (by.get(ref.repo) ?? by.set(ref.repo, []).get(ref.repo)!).push({ ref, message });
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([repo, items]) => ({ repo, items }));
  });
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

<aside class="prs" class:bare={sheet}>
  <header>
    <h3>
      {t("prs.title")}
      {#if rows.length || hiddenCount}<span class="count">{rows.length}</span>{/if}
    </h3>
    {#if pending}<span class="spin" use:tooltip={t("prs.loading")}><ArrowsClockwise size={13} /></span>{/if}
    <button class="ghost icon" class:on={hideClosed} onclick={toggleHide} use:tooltip={t(hideClosed ? "prs.showClosed" : "prs.hideClosed")}
      ><EyeSlash size={15} /></button
    >
    <button class="ghost icon" onclick={refreshPRs} disabled={pending} use:tooltip={t("prs.refresh")}><ArrowsClockwise size={15} /></button>
    {#if !sheet}
      <button class="ghost icon" onclick={onclose} aria-label={t("prs.close")}><X size={15} /></button>
    {/if}
  </header>
  <div class="list">
    {#if noRepos}
      <p class="empty"><InlineMd source={t("prs.noRepos")} /></p>
    {:else if !refs.length}
      <p class="empty"><InlineMd source={t("prs.noRefs")} /></p>
    {:else if !rows.length && !pending && !failed.length}
      <p class="empty">
        {#if hiddenCount}{plural("prs.allClosed", hiddenCount)}{:else}{t("prs.none")}{/if}
      </p>
    {/if}
    {#each groups as { repo, items } (repo)}
      <div class="divider"><span>{repo}</span></div>
      {#each items as { ref, pr } (ref.key)}
        <div class="row">
          <span class="state"><PrIcon key={ref.key} /></span>
          <div class="body">
            <button
              class="ghost link title"
              onclick={() => open(pr.url)}
              use:tooltip={(n) => (overflows(n) ? { html: inlineHtml(pr.title) } : null)}
            >
              <span class="t"><InlineMd source={pr.title} /></span>
            </button>
            <div class="meta">
              <span class="ref">{ref.alias}#{pr.number}</span>
              <span class="author">{pr.author}</span>
              <span use:tooltip={absolute(pr.updated)}>{relative(pr.updated)}</span>
              {#if pr.comments}<span class="comments"><ChatCircle size={11} /> {pr.comments}</span>{/if}
            </div>
            <div class="notes">
              {#each ref.notes as n (n.id)}
                <button class="ghost note" class:current={n.id === store.selectedId} onclick={() => onjump(n.id)}>
                  <InlineMd source={n.title} fallback={t("app.untitled")} />
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/each}
    {/each}
    {#each failed as { repo, items } (repo)}
      <div class="divider fail"><span>{repo}</span></div>
      {#each items as { ref, message } (ref.key)}
        <div class="row">
          <span class="state fail"><WarningCircle size={15} /></span>
          <div class="body">
            <p class="msg">{message}</p>
            <div class="meta"><span class="ref">{ref.alias}#{ref.number}</span></div>
            <div class="notes">
              {#each ref.notes as n (n.id)}
                <button class="ghost note" class:current={n.id === store.selectedId} onclick={() => onjump(n.id)}>
                  <InlineMd source={n.title} fallback={t("app.untitled")} />
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/each}
    {/each}
    {#if hiddenCount && rows.length}
      <p class="foot">{t("prs.hidden", { n: hiddenCount })}</p>
    {/if}
  </div>
</aside>

<style>
  /* Inside the mobile sheet it just fills what it is given. */
  .prs.bare {
    width: 100%;
    border-right: none;
  }
  .prs {
    -webkit-user-select: none;
    user-select: none;
    flex: none;
    width: var(--prs-w, 300px);
    height: 100%;
    background: var(--bg2);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 2;
  }
  header {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 8px 8px 8px 14px;
    border-bottom: 1px solid var(--border);
  }
  h3 {
    flex: 1;
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--color2);
  }
  .count {
    font-weight: 400;
    color: var(--color-dim);
    margin-left: 4px;
  }
  .icon {
    padding: 3px 5px;
  }
  .icon.on {
    color: var(--accent2);
  }
  .spin {
    display: inline-flex;
    margin-right: 4px;
    color: var(--accent2);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
  }
  .empty {
    margin: 0;
    padding: 20px 12px;
    text-align: center;
    color: var(--color-dim);
    font-size: 12px;
    line-height: 1.5;
  }
  .empty :global(code) {
    font-family: var(--mono);
    font-size: 11px;
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 4px 2px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--color-dim);
    white-space: nowrap;
  }
  .divider::after {
    content: "";
    flex: 1;
    border-top: 1px solid var(--border2);
  }
  .divider:first-child {
    margin-top: 2px;
  }
  .divider.fail {
    color: var(--red);
  }
  .row {
    display: flex;
    gap: 7px;
    padding: 4px 8px;
    border-radius: var(--radius);
  }
  @media (hover: hover) {
    .row:hover {
      background: #ffffff06;
    }
  }
  .state {
    flex: none;
    display: inline-flex;
    margin-top: 2px;
  }
  .state.fail {
    color: var(--red);
  }
  .msg {
    margin: 0;
    font-size: 12px;
    line-height: 1.3;
    color: var(--color2);
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
    font-size: 12px;
    font-weight: 500;
    line-height: 1.3;
  }
  @media (hover: hover) {
    .title:hover {
      color: var(--accent2);
    }
  }
  .t :global(code) {
    font-family: var(--mono);
    font-size: 0.92em;
    background: var(--code-bg);
    padding: 0 3px;
    border-radius: 3px;
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
    gap: 7px;
    margin-top: 1px;
    font-size: 10.5px;
    color: var(--color-dim);
    white-space: nowrap;
  }
  .ref {
    font-family: var(--mono);
    color: var(--accent2);
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
  .note {
    padding: 0 6px;
    font-size: 10.5px;
    line-height: 1.5;
    border-radius: 999px;
    background: #ffffff0a;
    color: var(--color);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note.current {
    background: var(--accent-soft);
    color: var(--color2);
  }
  .foot {
    margin: 4px 0 0;
    padding: 8px;
    text-align: center;
    font-size: 11px;
    color: #555;
  }
</style>
