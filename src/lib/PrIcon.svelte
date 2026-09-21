<script lang="ts">
  // State icon for a PR or issue; pass `item`, or a `prCache` `key` to read it live.
  import type { IssueRef } from "./github";
  import { prCache, stateLabel } from "./prs.svelte";
  import { tooltip } from "./tooltip";
  import GitPullRequest from "phosphor-svelte/lib/GitPullRequest";
  import GitMerge from "phosphor-svelte/lib/GitMerge";
  import XCircle from "phosphor-svelte/lib/XCircle";
  import Circle from "phosphor-svelte/lib/Circle";
  import CheckCircle from "phosphor-svelte/lib/CheckCircle";

  let { item, key, size = 13, detail = false }: { item?: IssueRef | null; key?: string; size?: number; detail?: boolean } = $props();

  const ref = $derived(item !== undefined ? item : key ? prCache.details[key] : undefined);
  const label = $derived(ref ? (detail ? `${stateLabel(ref)} · ${ref.title}` : stateLabel(ref)) : "");
</script>

{#if ref}
  <span class="pr-icon {ref.state}" class:draft={ref.draft} use:tooltip={label}>
    {#if !ref.isPr}
      {#if ref.state === "closed"}<CheckCircle {size} />{:else}<Circle {size} />{/if}
    {:else if ref.state === "merged"}<GitMerge {size} />{:else if ref.state === "closed"}<XCircle {size} />{:else}<GitPullRequest
        {size}
      />{/if}
  </span>
{/if}

<style>
  .pr-icon {
    flex: none;
    display: inline-flex;
    color: var(--green);
  }
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
