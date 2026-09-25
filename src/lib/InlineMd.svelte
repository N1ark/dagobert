<script lang="ts">
  import { inlineHtml } from "./inline";
  import { onLinkClick } from "./links";
  import { prIcons } from "./prIcons.svelte";

  /** Renders a single line of markdown (bold, code, links…) with no block wrapper. */
  let { source, fallback = "" }: { source: string; fallback?: string } = $props();

  const html = $derived(inlineHtml(source));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
{#if html}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify -->
  <span class="inline-md" use:prIcons={() => html} onclick={(e) => onLinkClick(e, true)}>{@html html}</span>
{:else}
  <span class="inline-md fallback">{fallback}</span>
{/if}

<style>
  .inline-md :global(code) {
    font-family: var(--mono);
    font-size: 0.85em;
    background: var(--code-bg);
    border-radius: 4px;
    padding: 1px 4px;
  }
  .inline-md :global(a) {
    color: var(--accent2);
    text-decoration: none;
  }
  .inline-md :global(a:not(.ghref):hover) {
    text-decoration: underline;
  }
  .inline-md :global(img) {
    max-height: 1.2em;
    vertical-align: middle;
  }
</style>
