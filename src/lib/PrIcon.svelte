<script lang="ts">
  // State icon for a PR or issue: pass `item`, or a `prCache` `key` to read it live; `host` takes the tooltip.
  import type { IssueRef } from "./github";
  import { prCache, stateLabel } from "./prs.svelte";
  import { tooltip } from "purr";
  import { t } from "./i18n";
  import {
    GitPullRequest,
    GitMerge,
    CheckCircle,
    ProhibitInset,
    IssueOpened,
    GitPullRequestClosed,
    GitPullRequestUnknown,
  } from "purr/icons";

  let {
    item,
    key,
    size = 13,
    detail = false,
    host,
  }: { item?: IssueRef | null; key?: string; size?: number; detail?: boolean; host?: HTMLElement } = $props();

  const ref = $derived(item !== undefined ? item : key ? prCache.details[key] : undefined);
  /** Not fetched yet (or being refreshed) and not known to be a plain issue. */
  const unknown = $derived(item === undefined && !!key && !(key in prCache.details) && prCache.stale[key] !== null);
  const label = $derived(
    ref
      ? detail
        ? t("prs.state.detail", { state: stateLabel(ref), title: ref.title })
        : stateLabel(ref)
      : unknown
        ? t("prs.loading")
        : "",
  );

  $effect(() => {
    if (!host) return;
    if (label) host.removeAttribute("title");
    const action = tooltip(host, () => label);
    return () => action?.destroy?.();
  });
</script>

{#if ref}
  <span
    class="pr-icon {ref.state}"
    class:draft={ref.draft}
    class:issue={!ref.isPr}
    class:not-planned={ref.notPlanned}
    use:tooltip={host ? null : label}
  >
    {#if !ref.isPr}
      {#if ref.notPlanned}<ProhibitInset {size} />{:else if ref.state === "closed"}<CheckCircle {size} />{:else}<IssueOpened {size} />{/if}
    {:else if ref.state === "merged"}<GitMerge {size} />{:else if ref.state === "closed"}<GitPullRequestClosed
        {size}
      />{:else}<GitPullRequest {size} />{/if}
  </span>
{:else if unknown}
  <span class="pr-icon unknown" use:tooltip={host ? null : label}><GitPullRequestUnknown {size} /></span>
{/if}

<style>
  .pr-icon {
    flex: none;
    display: inline-flex;
    color: var(--success);
  }
  .pr-icon.unknown,
  .pr-icon.draft,
  .pr-icon.not-planned {
    color: var(--muted);
  }
  .pr-icon.closed {
    color: var(--danger);
  }
  .pr-icon.merged,
  .pr-icon.issue.closed:not(.not-planned) {
    color: var(--theme2);
  }
</style>
