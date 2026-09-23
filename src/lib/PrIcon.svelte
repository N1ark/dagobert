<script lang="ts">
  // State icon for a PR or issue; pass `item`, or a `prCache` `key` to read it live
  // (a grey question-marked PR while the key is still unknown, so nothing shifts on refresh).
  import type { IssueRef } from "./github";
  import { prCache, stateLabel } from "./prs.svelte";
  import { tooltip } from "./tooltip";
  import { t } from "./i18n";
  import GitPullRequest from "phosphor-svelte/lib/GitPullRequest";
  import GitMerge from "phosphor-svelte/lib/GitMerge";
  import Circle from "phosphor-svelte/lib/Circle";
  import CheckCircle from "phosphor-svelte/lib/CheckCircle";
  import GitPullRequestClosed from "./GitPullRequestClosed.svelte";
  import GitPullRequestUnknown from "./GitPullRequestUnknown.svelte";

  let { item, key, size = 13, detail = false }: { item?: IssueRef | null; key?: string; size?: number; detail?: boolean } = $props();

  const ref = $derived(item !== undefined ? item : key ? prCache.details[key] : undefined);
  /** Not fetched yet (or being refreshed) and not known to be a plain issue. */
  const unknown = $derived(item === undefined && !!key && !(key in prCache.details) && prCache.stale[key] !== null);
  const label = $derived(ref ? (detail ? t("prs.state.detail", { state: stateLabel(ref), title: ref.title }) : stateLabel(ref)) : "");
</script>

{#if ref}
  <span class="pr-icon {ref.state}" class:draft={ref.draft} use:tooltip={label}>
    {#if !ref.isPr}
      {#if ref.state === "closed"}<CheckCircle {size} />{:else}<Circle {size} />{/if}
    {:else if ref.state === "merged"}<GitMerge {size} />{:else if ref.state === "closed"}<GitPullRequestClosed
        {size}
      />{:else}<GitPullRequest {size} />{/if}
  </span>
{:else if unknown}
  <span class="pr-icon unknown" use:tooltip={t("prs.loading")}><GitPullRequestUnknown {size} /></span>
{/if}

<style>
  .pr-icon {
    flex: none;
    display: inline-flex;
    color: var(--green);
  }
  .pr-icon.unknown,
  .pr-icon.draft {
    color: var(--color-dim);
  }
  .pr-icon.closed {
    color: var(--red);
  }
  .pr-icon.merged {
    color: var(--accent2);
  }
</style>
