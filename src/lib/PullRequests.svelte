<script lang="ts">
  import { store } from "./store.svelte";
  import { repoRefs, type RepoRef } from "./wikilinks";
  import { issue, invalidate, type IssueRef } from "./github";
  import { prCache } from "./prs.svelte";
  import { relative, absolute } from "./time";
  import { tooltip } from "./tooltip";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import InlineMd from "./InlineMd.svelte";
  import { inlineHtml } from "./inline";
  import X from "phosphor-svelte/lib/X";
  import ArrowsClockwise from "phosphor-svelte/lib/ArrowsClockwise";
  import GitPullRequest from "phosphor-svelte/lib/GitPullRequest";
  import GitMerge from "phosphor-svelte/lib/GitMerge";
  import XCircle from "phosphor-svelte/lib/XCircle";
  import ChatCircle from "phosphor-svelte/lib/ChatCircle";
  import EyeSlash from "phosphor-svelte/lib/EyeSlash";

  /** `requestIdleCallback` with a timeout, falling back to a short timer. */
  const idle = (fn: () => void): number =>
    typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 250);
  const cancelIdle = (h: number) => (typeof cancelIdleCallback === "function" ? cancelIdleCallback(h) : clearTimeout(h));

  let { onclose, onjump }: { onclose: () => void; onjump: (id: string) => void } = $props();

  const HIDE_KEY = "dagobert.prsHideClosed";
  let hideClosed = $state(localStorage.getItem(HIDE_KEY) === "1");
  function toggleHide() {
    hideClosed = !hideClosed;
    localStorage.setItem(HIDE_KEY, hideClosed ? "1" : "0");
  }

  /** A referenced item and the notes that mention it. */
  interface Linked extends RepoRef {
    key: string;
    notes: { id: string; title: string }[];
  }

  // Every alias#123 across all notes, grouped by repo + number. Cheap enough to
  // rescan on each edit: it's a regex over the bodies.
  const refs = $derived.by((): Linked[] => {
    const by = new Map<string, Linked>();
    for (const n of store.notes) {
      for (const r of repoRefs(`${n.title}\n${n.body}`)) {
        const key = `${r.repo}#${r.number}`;
        let l = by.get(key);
        if (!l) by.set(key, (l = { ...r, key, notes: [] }));
        if (!l.notes.some((x) => x.id === n.id)) l.notes.push({ id: n.id, title: n.title });
      }
    }
    return [...by.values()];
  });

  // Fetched details, keyed like `refs`. Refs that turn out to be plain issues
  // (or don't exist) are recorded as null so they aren't retried.
  const details = $derived(prCache.details);
  const errors = $derived(prCache.errors);
  let pending = $state(false);
  /** Keys with a request in flight (not reactive: only guards double fetches). */
  const inflight = new Set<string>();

  /** Fetch a batch and commit every result in one state update. */
  async function load(batch: Linked[]) {
    for (const l of batch) inflight.add(l.key);
    pending = true;
    const results = await Promise.allSettled(batch.map((l) => issue(l.repo, l.number)));
    const d = { ...details };
    const e = { ...errors };
    results.forEach((r, i) => {
      const key = batch[i].key;
      if (r.status === "fulfilled") {
        d[key] = r.value && r.value.isPr ? r.value : null;
        delete e[key];
      } else e[key] = r.reason instanceof Error ? r.reason.message : String(r.reason);
      inflight.delete(key);
    });
    prCache.details = d;
    prCache.errors = e;
    pending = inflight.size > 0;
  }

  // Fetch whatever hasn't been fetched yet whenever the set of refs changes.
  // Only `refs`, `details` and `errors` are tracked; the work is scheduled for
  // when the browser is idle so opening the app (or a project) paints first, and
  // the writes happen untracked after an await so the effect never re-triggers
  // itself. Refs added while a batch is in flight wait for the next idle slot.
  $effect(() => {
    const missing = refs.filter((l) => !(l.key in details) && !(l.key in errors) && !inflight.has(l.key));
    if (!missing.length) return;
    // Right after launch, wait for an idle slot so the first paint isn't delayed;
    // once the app is up, fetch straight away.
    if (performance.now() > 5000) {
      void load(missing);
      return;
    }
    let cancelled = false;
    const handle = idle(() => !cancelled && void load(missing));
    return () => {
      cancelled = true;
      cancelIdle(handle);
    };
  });

  function refresh() {
    invalidate();
    prCache.details = {};
    prCache.errors = {};
  }

  interface Row {
    ref: Linked;
    pr: IssueRef;
  }
  const rows = $derived.by((): Row[] => {
    const out: Row[] = [];
    for (const ref of refs) {
      const pr = details[ref.key];
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
  const firstError = $derived(Object.values(errors)[0] ?? null);
  const noRepos = $derived(!Object.keys(store.repos).length);

  function open(url: string) {
    openUrl(url).catch(() => window.open(url, "_blank"));
  }

  /** Whether the clamped title inside a row button is cut off. */
  function overflows(button: HTMLElement): boolean {
    const t = button.querySelector(".t");
    return !!t && t.scrollHeight > t.clientHeight + 1;
  }

  function stateLabel(pr: IssueRef) {
    return pr.state === "merged" ? "Merged" : pr.state === "closed" ? "Closed" : pr.draft ? "Draft" : "Open";
  }
</script>

<aside class="prs">
  <header>
    <h3>
      Pull requests
      {#if rows.length || hiddenCount}<span class="count">{rows.length}</span>{/if}
    </h3>
    {#if pending}<span class="spin" use:tooltip={"Loading…"}><ArrowsClockwise size={13} /></span>{/if}
    <button
      class="ghost icon"
      class:on={hideClosed}
      onclick={toggleHide}
      use:tooltip={hideClosed ? "Show closed and merged" : "Hide closed and merged"}><EyeSlash size={15} /></button
    >
    <button class="ghost icon" onclick={refresh} disabled={pending} use:tooltip={"Refresh"}><ArrowsClockwise size={15} /></button>
    <button class="ghost icon" onclick={onclose} aria-label="close"><X size={15} /></button>
  </header>
  <div class="list">
    {#if noRepos}
      <p class="empty">No repos configured. Add an alias under Tools → GitHub repos…, then write <code>alias#123</code> in a note.</p>
    {:else if firstError}
      <p class="empty err">{firstError}</p>
    {:else if !refs.length}
      <p class="empty">No <code>alias#123</code> references in your notes yet.</p>
    {:else if !rows.length && !pending}
      <p class="empty">
        {#if hiddenCount}All {hiddenCount} linked PR{hiddenCount === 1 ? " is" : "s are"} closed or merged.{:else}No pull requests among the
          linked references.{/if}
      </p>
    {/if}
    {#each groups as { repo, items } (repo)}
      <div class="divider"><span>{repo}</span></div>
      {#each items as { ref, pr } (ref.key)}
        <div class="row">
          <span class="state {pr.state}" class:draft={pr.draft} use:tooltip={stateLabel(pr)}>
            {#if pr.state === "merged"}<GitMerge size={13} />{:else if pr.state === "closed"}<XCircle size={13} />{:else}<GitPullRequest
                size={13}
              />{/if}
          </span>
          <div class="body">
            <button
              class="ghost title"
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
                  <InlineMd source={n.title} fallback="Untitled" />
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/each}
    {/each}
    {#if hiddenCount && rows.length}
      <p class="foot">{hiddenCount} closed or merged hidden</p>
    {/if}
  </div>
</aside>

<style>
  .prs {
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
  .empty.err {
    color: var(--red);
  }
  .empty code {
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
  .row {
    display: flex;
    gap: 7px;
    padding: 4px 8px;
    border-radius: var(--radius);
  }
  .row:hover {
    background: #ffffff06;
  }
  .state {
    flex: none;
    display: inline-flex;
    margin-top: 2px;
    color: var(--green);
  }
  .state.draft {
    color: var(--color-dim);
  }
  .state.closed {
    color: var(--red);
  }
  .state.merged {
    color: var(--accent2);
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .title {
    display: block;
    width: 100%;
    padding: 0;
    text-align: left;
    color: var(--color2);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.3;
  }
  .title:hover {
    color: var(--accent2);
    background: none;
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
