<script lang="ts" module>
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  import { highlightExtension, highlighterReady, loadHighlighter } from "./highlight";
  import { mediaExtension } from "./media";
  import { backend } from "./backend";
  import { store } from "./store.svelte";

  // Once per app: `use` wraps the renderer again on every call.
  marked.use(highlightExtension, mediaExtension);

  // Project media load through the asset protocol, whose URLs DOMPurify's allowlist would drop.
  const MEDIA_TAGS = new Set(["IMG", "VIDEO", "AUDIO", "SOURCE"]);
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const src = MEDIA_TAGS.has(node.nodeName) ? node.getAttribute("src") : null;
    if (!src?.startsWith("assets/") || !store.path) return;
    const [link, frag] = src.split("#");
    node.setAttribute("src", backend.assetUrl(store.path, link) + (frag ? `#${frag}` : ""));
  });
</script>

<script lang="ts">
  import { renderWikilinks } from "./wikilinks";
  import { onLinkClick } from "./links";
  import { prIcons } from "./prIcons.svelte";
  import { t } from "./i18n";

  let { source }: { source: string } = $props();

  let highlighted = $state(highlighterReady());
  // A fence with a language loads the highlighter, then renders again.
  $effect(() => {
    if (!highlighted && /^ {0,3}(`{3,}|~{3,}) *\S/m.test(source)) void loadHighlighter().then(() => (highlighted = true));
  });

  // marked disables task checkboxes, which swallows the clicks the editor toggles them with.
  const html = $derived.by(() => {
    void highlighted;
    return DOMPurify.sanitize(marked.parse(renderWikilinks(source), { gfm: true, async: false }) as string).replace(
      /(<input\b[^>]*?)\s+disabled(?:=""|='')?(?=[\s>/])/g,
      "$1",
    );
  });
</script>

<!-- Links are intercepted so they open in the system browser. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md" use:prIcons={() => html} onclick={(e) => onLinkClick(e)}>
  {#if source.trim()}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify -->
    {@html html}
  {:else}
    <p class="placeholder">{t("editor.empty")}</p>
  {/if}
</div>

<style>
  .placeholder {
    color: var(--faint);
    font-style: italic;
  }
</style>
