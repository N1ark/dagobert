<script lang="ts">
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { renderWikilinks, wikilinkTarget } from "./wikilinks";
  import { store } from "./store.svelte";

  /** Renders a single line of markdown (bold, code, links…) with no block wrapper. */
  let { source, fallback = "" }: { source: string; fallback?: string } = $props();

  const html = $derived(
    source.trim() ? DOMPurify.sanitize(marked.parseInline(renderWikilinks(source), { gfm: true, async: false }) as string) : "",
  );

  function onClick(e: MouseEvent) {
    const id = wikilinkTarget(e.target as HTMLElement);
    if (id) {
      e.preventDefault();
      e.stopPropagation();
      store.jump(id);
      return;
    }
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const href = a.getAttribute("href");
    if (href && /^(https?:|mailto:)/.test(href)) openUrl(href).catch(console.error);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
{#if html}
  <span class="inline-md" onclick={onClick}>{@html html}</span>
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
  .inline-md :global(a:hover) {
    text-decoration: underline;
  }
  .inline-md :global(img) {
    max-height: 1.2em;
    vertical-align: middle;
  }
</style>
