<script lang="ts">
  import { searchIssues, type IssueRef } from "./github";
  import GitPullRequest from "phosphor-svelte/lib/GitPullRequest";
  import GitMerge from "phosphor-svelte/lib/GitMerge";
  import Circle from "phosphor-svelte/lib/Circle";
  import CheckCircle from "phosphor-svelte/lib/CheckCircle";

  let {
    alias,
    repo,
    query,
    left,
    top,
    onpick,
  }: {
    alias: string;
    repo: string;
    query: string;
    left: number;
    top: number;
    onpick: (ref: IssueRef) => void;
  } = $props();

  let results = $state<IssueRef[]>([]);
  let active = $state(0);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // Debounced fetch as the query changes; ignore stale responses.
  let seq = 0;
  $effect(() => {
    const q = query;
    const r = repo;
    const my = ++seq;
    loading = true;
    error = null;
    const t = setTimeout(async () => {
      try {
        const refs = await searchIssues(r, q);
        if (my === seq) {
          results = refs;
          active = 0;
        }
      } catch (e) {
        if (my === seq) error = (e as Error).message;
      } finally {
        if (my === seq) loading = false;
      }
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  });

  /** Returns true when the key was consumed. */
  export function handleKey(e: KeyboardEvent): boolean {
    if (e.key === "ArrowDown") {
      active = (active + 1) % Math.max(1, results.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      active = (active - 1 + results.length) % Math.max(1, results.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      if (!results[active]) return false;
      onpick(results[active]);
      return true;
    }
    return false;
  }
</script>

<div class="issues" style="left:{left}px; top:{top}px" role="listbox">
  <div class="head"><span class="alias">{alias}</span> → {repo}{#if loading}<span class="spin">…</span>{/if}</div>
  {#if error}
    <div class="msg err">{error}</div>
  {:else if !results.length && !loading}
    <div class="msg">No matches</div>
  {/if}
  {#each results as r, i (r.number)}
    <button class="ghost row" class:active={i === active} onmousedown={(e) => e.preventDefault()} onclick={() => onpick(r)} onmouseenter={() => (active = i)}>
      <span class="icon {r.state}">
        {#if r.isPr}
          {#if r.state === "merged"}<GitMerge size={13} />{:else}<GitPullRequest size={13} />{/if}
        {:else if r.state === "closed"}<CheckCircle size={13} />{:else}<Circle size={13} />{/if}
      </span>
      <span class="num">#{r.number}</span>
      <span class="t">{r.title}</span>
    </button>
  {/each}
</div>

<style>
  .issues {
    position: absolute;
    z-index: 30;
    width: 360px;
    padding: 4px;
    background: var(--bg3);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    max-height: 300px;
    overflow-y: auto;
  }
  .head {
    padding: 4px 8px 6px;
    font-size: 11px;
    color: var(--color-dim);
    display: flex;
    gap: 4px;
  }
  .alias {
    color: var(--accent2);
    font-weight: 600;
  }
  .spin {
    margin-left: auto;
  }
  .msg {
    padding: 6px 8px;
    font-size: 12px;
    color: var(--color-dim);
  }
  .msg.err {
    color: var(--red);
  }
  .row {
    width: 100%;
    gap: 8px;
    text-align: left;
    color: var(--color);
    font-size: 13px;
  }
  .row.active {
    background: #ffffff10;
    color: var(--color2);
  }
  .icon {
    display: inline-flex;
    color: var(--green);
  }
  .icon.closed {
    color: var(--red);
  }
  .icon.merged {
    color: var(--accent2);
  }
  .num {
    color: var(--color-dim);
    font-family: var(--mono);
    font-size: 12px;
    flex: none;
  }
  .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
