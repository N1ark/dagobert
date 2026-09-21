<script lang="ts">
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { renderWikilinks, wikilinkTarget } from "./wikilinks";
  import { store } from "./store.svelte";
  import { mount, unmount } from "svelte";
  import PrIcon from "./PrIcon.svelte";

  let { source }: { source: string } = $props();

  // marked emits task checkboxes as `disabled`, which swallows clicks; the
  // live editor toggles them, so re-enable.
  const html = $derived(
    DOMPurify.sanitize(marked.parse(renderWikilinks(source), { gfm: true, async: false }) as string).replace(
      /(<input\b[^>]*?)\s+disabled(?:=""|='')?(?=[\s>/])/g,
      "$1",
    ),
  );

  let root = $state<HTMLDivElement>();

  // Mount a live PR state icon into every `alias#123` anchor.
  $effect(() => {
    void html;
    if (!root) return;
    const mounted = [...root.querySelectorAll<HTMLAnchorElement>("a.ghref[data-ref]")].map((a) =>
      mount(PrIcon, { target: a, anchor: a.firstChild ?? undefined, props: { key: a.dataset.ref!, detail: true } }),
    );
    return () => {
      for (const m of mounted) void unmount(m);
    };
  });

  function onClick(e: MouseEvent) {
    const id = wikilinkTarget(e.target as HTMLElement);
    if (id) {
      e.preventDefault();
      store.jump(id);
      return;
    }
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href");
    if (href && /^(https?:|mailto:)/.test(href)) openUrl(href).catch(console.error);
  }
</script>

<!-- Links are intercepted so they open in the system browser. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="markdown" bind:this={root} onclick={onClick}>
  {#if source.trim()}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify -->
    {@html html}
  {:else}
    <p class="placeholder">Nothing here yet.</p>
  {/if}
</div>

<style>
  .placeholder {
    color: #555;
    font-style: italic;
  }
</style>
