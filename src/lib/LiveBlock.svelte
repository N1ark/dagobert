<script lang="ts">
  import Markdown from "./Markdown.svelte";
  import ConflictBlock from "./ConflictBlock.svelte";

  /** A block widget of the live editor: rendered markdown, a gallery of image paragraphs, a conflict region, or an inline embed. */
  interface Props {
    kind: "md" | "gallery" | "conflict" | "inline";
    sources: string[];
    /** A gallery's base row height in px (its first image's `|x…`). */
    rowHeight?: number | null;
    /** Code nested in a list item sits at its text, `indent` characters in. */
    indent?: number;
    onresolve?: (keep: "mine" | "theirs" | "both") => void;
    onedit?: (e: MouseEvent) => void;
  }
  let { kind, sources, rowHeight = null, indent = 0, onresolve = () => {}, onedit = () => {} }: Props = $props();
</script>

{#if kind === "inline"}
  <span class="inline"><Markdown source={sources[0]} /></span>
{:else if kind === "conflict"}
  <div class="block conflict"><ConflictBlock block={sources[0]} {onresolve} {onedit} /></div>
{:else if kind === "gallery"}
  <div class="block gallery" style:--gallery-row={rowHeight ? `${rowHeight}px` : null}>
    {#each sources as source, k (k)}
      <div class="para" data-para={k}><Markdown {source} /></div>
    {/each}
  </div>
{:else}
  <div class="block" style:margin-left={indent ? `calc(${indent}ch - 8px)` : null}><Markdown source={sources[0]} /></div>
{/if}

<style>
  .block {
    position: relative;
    padding: 2px 8px;
    margin: 0 -8px;
    cursor: text;
  }
  @media (hover: hover) {
    .block:hover {
      background: color-mix(in srgb, var(--color2) 2%, transparent);
    }
  }
  /* The blank lines around a block space it, as they do paragraphs. */
  .block :global(.md > :first-child) {
    margin-top: 0;
  }
  .block :global(.md > :last-child) {
    margin-bottom: 0;
  }
  .conflict {
    padding-block: 0;
  }
  :is(.block, .inline) :global(.media img) {
    cursor: zoom-in;
  }
  /* A long press on a picture offers the system's menu: share, save to Photos, copy. */
  :global(body.mobile) :is(.block, .inline) :global(.media img) {
    -webkit-touch-callout: default;
  }
  :is(.block, .inline) :global(.media:hover .resize) {
    display: block;
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
    border-radius: var(--radius-sm);
    background: linear-gradient(
      135deg,
      transparent 45%,
      var(--on-media) 45%,
      var(--on-media) 55%,
      transparent 55%,
      transparent 70%,
      var(--on-media) 70%,
      var(--on-media) 80%,
      transparent 80%
    );
    filter: drop-shadow(0 0 1px var(--media-chrome));
  }
  /* An embed in a line of text: the image itself, in the flow. */
  .inline :global(:is(.md, .md > p)) {
    display: inline;
    margin: 0;
  }
  .inline :global(.media) {
    vertical-align: bottom;
  }
  /* Justified rows: each image grows by its width-to-height ratio, so a row shares one height. */
  .gallery {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-2);
    padding: 2px 8px;
  }
  @media (hover: hover) {
    .gallery :global(.media:hover img) {
      outline: 2px solid color-mix(in srgb, var(--theme2) 60%, transparent);
      outline-offset: 1px;
    }
  }
  .gallery::after {
    content: "";
    flex-grow: 1e4;
  }
  .gallery :global(:is(.para, .md, p)) {
    display: contents;
  }
  .gallery :global(.media) {
    flex: var(--r, 1) 1 calc(var(--r, 1) * var(--gallery-row, 90px));
    min-width: 0;
    /* A row that can't fill stops growing at about twice its base height instead of one huge image. */
    max-width: calc(var(--r, 1) * var(--gallery-row, 90px) * 2.2);
  }
  .gallery :global(.media img) {
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--radius-sm);
  }
</style>
