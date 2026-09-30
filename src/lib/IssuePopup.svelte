<script lang="ts">
  import { searchIssues, recentIssues, type IssueRef } from "./github";
  import PrIcon from "./PrIcon.svelte";
  import { CircleNotch } from "purr/icons";
  import { t } from "./i18n";

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

  /** The repo's recent items, used to filter locally while the search request is in flight. */
  let recent = $state<IssueRef[]>([]);
  $effect(() => {
    const r = repo;
    recentIssues(r)
      .then((refs) => (recent = refs))
      .catch(() => {});
  });

  // Debounced fetch; stale responses are dropped and old results stay on screen meanwhile.
  let seq = 0;
  $effect(() => {
    const q = query;
    const r = repo;
    const my = ++seq;
    loading = true;
    error = null;
    if (q.trim()) {
      const ql = q.trim().toLowerCase();
      const local = recent.filter((i) => i.title.toLowerCase().includes(ql) || String(i.number).startsWith(ql));
      if (local.length) {
        results = local.slice(0, 15);
        active = 0;
      }
    }
    const t = setTimeout(
      async () => {
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
      },
      q ? 250 : 0,
    );
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

<div class="issues surface" style="left:{left}px; top:{top}px" role="listbox">
  <div class="head">
    <span class="alias">{alias}</span> → {repo}
    {#if loading}<span class="spin"><CircleNotch /></span>{/if}
  </div>
  {#if error}
    <div class="msg err">{error}</div>
  {:else if !results.length && !loading}
    <div class="msg">{t("editor.issue.noMatches")}</div>
  {/if}
  {#each results as r, i (r.number)}
    <button
      class="row-item"
      class:is-cursor={i === active}
      onmousedown={(e) => e.preventDefault()}
      onclick={() => onpick(r)}
      onmouseenter={() => (active = i)}
    >
      <PrIcon item={r} />
      <span class="num">#{r.number}</span>
      <span class="t">{r.title}</span>
    </button>
  {/each}
</div>

<style>
  .issues {
    position: absolute;
    z-index: var(--z-popover);
    width: 360px;
    padding: var(--gap-2);
    max-height: 300px;
    overflow-y: auto;
    box-shadow: var(--shadow-lg);
  }
  .head {
    padding: var(--gap-2) var(--gap-4) var(--gap-3);
    font-size: var(--fs-micro);
    color: var(--muted);
    display: flex;
    gap: var(--gap-2);
  }
  .alias {
    color: var(--theme2);
    font-weight: 600;
  }
  .spin {
    margin-left: auto;
    color: var(--theme2);
  }
  .msg {
    padding: var(--gap-3) var(--gap-4);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .msg.err {
    color: var(--danger);
  }
  .num {
    color: var(--muted);
    font-family: var(--mono);
    font-size: var(--fs-xs);
    flex: none;
  }
  .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
