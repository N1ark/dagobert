<script lang="ts">
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  import { renderWikilinks } from "./wikilinks";
  import { onLinkClick } from "./links";
  import { prIcons } from "./prIcons.svelte";
  import { highlightExtension } from "./highlight";
  import { t } from "./i18n";

  marked.use(highlightExtension);

  let { source }: { source: string } = $props();

  // marked disables task checkboxes, which swallows the clicks the editor toggles them with.
  const html = $derived(
    DOMPurify.sanitize(marked.parse(renderWikilinks(source), { gfm: true, async: false }) as string).replace(
      /(<input\b[^>]*?)\s+disabled(?:=""|='')?(?=[\s>/])/g,
      "$1",
    ),
  );
</script>

<!-- Links are intercepted so they open in the system browser. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="markdown" use:prIcons={() => html} onclick={(e) => onLinkClick(e)}>
  {#if source.trim()}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify -->
    {@html html}
  {:else}
    <p class="placeholder">{t("editor.empty")}</p>
  {/if}
</div>

<style>
  .placeholder {
    color: #555;
    font-style: italic;
  }
</style>
