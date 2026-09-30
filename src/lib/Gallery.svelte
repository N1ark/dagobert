<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "./store.svelte";
  import { backend, isMobile } from "./backend";
  import { assetNames, embed, kindOf, type MediaDrop, type MediaKind } from "./media";
  import type { Asset } from "./types";
  import { relative } from "./time";
  import InlineMd from "./InlineMd.svelte";
  import DockButton from "./DockButton.svelte";
  import MediaIcon from "./MediaIcon.svelte";
  import NoteLink from "./NoteLink.svelte";
  import { Chip, ConfirmButton, IconButton, Lightbox, PanelHeader, SearchInput, type LightboxItem } from "purr";
  import { Play, Trash, FolderOpen } from "purr/icons";
  import { t, plural, locale } from "./i18n";

  let { onclose }: { onclose: () => void } = $props();

  let filter = $state<MediaKind | null>(null);
  let query = $state("");
  /** The asset open in the viewer, by its index in `shown`. */
  let viewing = $state<number | null>(null);
  let confirmPurge = $state(false);

  onMount(() => {
    void store.loadAssets();
    void store.loadTrash();
  });

  const inTrash = $derived(new Set(store.trash.flatMap((n) => assetNames(n.body))));
  const kinds: (MediaKind | null)[] = [null, "image", "audio", "video"];
  const KIND_LABEL = { all: "gallery.all", image: "gallery.images", audio: "gallery.audio", video: "gallery.video" } as const;

  const refsOf = (a: Asset) => store.assetInfo.get(a.name)?.ids ?? [];
  const labelOf = (a: Asset) => [...(store.assetInfo.get(a.name)?.alts ?? [])][0] ?? a.name;
  const kindOfAsset = (a: Asset) => kindOf(a.name) ?? "image";
  const url = (a: Asset) => (store.path ? backend.assetUrl(store.path, `assets/${a.name}`) : "");
  const unused = (a: Asset) => !refsOf(a).length && !inTrash.has(a.name);

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return (store.assets ?? []).filter((a) => {
      if (filter && kindOfAsset(a) !== filter) return false;
      if (!q) return true;
      const alts = [...(store.assetInfo.get(a.name)?.alts ?? [])];
      const titles = refsOf(a).map((id) => store.byId(id)?.title ?? "");
      return [a.name, ...alts, ...titles].some((s) => s.toLowerCase().includes(q));
    });
  });
  const unusedCount = $derived((store.assets ?? []).filter(unused).length);

  const sizeFmt = new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 });
  const size = (bytes: number) => sizeFmt.format(Math.max(0.1, bytes / 1e6));

  const items = $derived(
    shown.map((a): LightboxItem => ({
      src: url(a),
      kind: kindOfAsset(a),
      alt: labelOf(a),
      detail: `${size(a.size)} · ${relative(a.modified)}`,
    })),
  );

  // ---- dragging a tile into the editor (pointer events: Tauri keeps HTML5 drags for files) ----

  let drag = $state<{ asset: Asset; x: number; y: number; moved: boolean } | null>(null);
  /** Set when a drag ends, so the click that follows doesn't open the viewer. */
  let dragged = false;

  function onDown(e: PointerEvent, a: Asset) {
    if (isMobile || e.button !== 0) return;
    drag = { asset: a, x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    drag = { ...drag, x: e.clientX, y: e.clientY, moved: true };
  }

  function onUp(e: PointerEvent) {
    const d = drag;
    drag = null;
    if (!d?.moved) return;
    dragged = true;
    setTimeout(() => (dragged = false));
    const alt = labelOf(d.asset) === d.asset.name ? "" : labelOf(d.asset);
    const detail: MediaDrop = {
      x: e.clientX,
      y: e.clientY,
      embeds: [embed(`assets/${d.asset.name}`, alt)],
      title: alt.replace(/\.[^.]*$/, ""),
    };
    // A popped-up gallery's backdrop covers the editor; drop through it.
    const target = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !el.closest(".scrim"));
    target?.dispatchEvent(new CustomEvent("media-drop", { bubbles: true, detail }));
  }

  function open(i: number) {
    if (!dragged) viewing = i;
  }
</script>

<div class="pane gallery">
  <PanelHeader
    title={t("gallery.title")}
    count={store.assets?.length}
    onclose={isMobile ? undefined : onclose}
    closeLabel={t("pane.close")}
  >
    {#snippet actions()}<DockButton />{/snippet}
  </PanelHeader>
  <div class="bar">
    {#each kinds as k (k)}
      <Chip on={filter === k} label={t(KIND_LABEL[k ?? "all"])} onclick={() => (filter = k)} />
    {/each}
    <SearchInput variant="field" bind:value={query} label={t("gallery.search")} placeholder={t("gallery.search")} spellcheck="false" />
  </div>
  <div class="grid-wrap">
    {#if !store.assets}
      <p class="empty">{t("gallery.loading")}</p>
    {:else if !store.assets.length}
      <p class="empty"><InlineMd source={t("gallery.empty")} /></p>
    {:else if !shown.length}
      <p class="empty">{t("gallery.noMatches")}</p>
    {:else}
      <ul class="grid">
        {#each shown as a, i (a.name)}
          {@const kind = kindOfAsset(a)}
          {@const refs = refsOf(a)}
          <li class:unused={unused(a)}>
            <button
              class="thumb"
              class:lifted={drag?.moved && drag.asset === a}
              onclick={() => open(i)}
              onpointerdown={(e) => onDown(e, a)}
              onpointermove={onMove}
              onpointerup={onUp}
              onpointercancel={() => (drag = null)}
              aria-label={labelOf(a)}
            >
              {#if kind === "image"}
                <img src={url(a)} alt="" loading="lazy" draggable="false" />
              {:else if kind === "video"}
                <video src={url(a) + "#t=0.001"} preload="metadata" muted playsinline></video>
                <span class="badge"><Play weight="fill" /></span>
              {:else}
                <span class="audio"><MediaIcon kind="audio" size={28} /><span class="name">{labelOf(a)}</span></span>
              {/if}
            </button>
            <div class="meta">
              {#each refs as id (id)}
                <NoteLink {id} />
              {:else}
                {#if inTrash.has(a.name)}
                  <span class="state">{t("gallery.inTrash")}</span>
                {:else}
                  <span class="state">{t("gallery.unused")}</span>
                  <ConfirmButton
                    variant="ghost"
                    size="sm"
                    class="btn--danger"
                    confirmLabel={t("gallery.confirm")}
                    onconfirm={() => store.deleteAsset(a.name)}><Trash /> {t("gallery.delete")}</ConfirmButton
                  >
                {/if}
              {/each}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  {#if unusedCount}
    <footer>
      {#if confirmPurge}
        <span class="warn">{plural("gallery.purge.confirm", unusedCount)}</span>
      {/if}
      <ConfirmButton
        variant="ghost"
        size="sm"
        class="btn--danger"
        bind:armed={confirmPurge}
        confirmLabel={t("gallery.purge.now")}
        onconfirm={() => store.deleteAssets((store.assets ?? []).filter(unused).map((a) => a.name))}
        >{plural("gallery.purge", unusedCount)}</ConfirmButton
      >
    </footer>
  {/if}
</div>
{#if viewing !== null}
  <Lightbox
    {items}
    bind:index={viewing}
    onclose={() => (viewing = null)}
    label={t("gallery.viewer")}
    closeLabel={t("pane.close")}
    previousLabel={t("gallery.previous")}
    nextLabel={t("gallery.next")}
  >
    {#snippet actions(_, i)}
      {#if !isMobile && shown[i]}
        <IconButton label={t("panel.reveal")} size="lg" onclick={() => store.revealAsset(shown[i].name)}><FolderOpen /></IconButton>
      {/if}
    {/snippet}
  </Lightbox>
{/if}
{#if drag?.moved}
  <div class="ghost-tile" style="left:{drag.x}px;top:{drag.y}px">
    {#if kindOfAsset(drag.asset) === "image"}<img src={url(drag.asset)} alt="" />{:else}<MediaIcon
        kind={kindOfAsset(drag.asset)}
        size={24}
      />{/if}
  </div>
{/if}

<style>
  .gallery {
    position: relative;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    padding: var(--sp-4) var(--sp-4) var(--gap-4);
  }
  .bar > :global(:last-child) {
    flex: 1;
    min-width: 80px;
    margin-left: var(--gap-3);
  }
  :global(body.mobile) .bar {
    flex-wrap: wrap;
  }
  :global(body.mobile) .bar > :global(:last-child) {
    flex-basis: 100%;
    margin: var(--gap-2) 0 0;
  }
  .grid-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--gap-2) var(--sp-4) var(--sp-4);
  }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .empty :global(code) {
    font-family: var(--mono);
    font-size: var(--fs-xs);
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
  }
  :global(body.mobile) .grid {
    grid-template-columns: 1fr 1fr;
  }
  li {
    min-width: 0;
  }
  .thumb {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 4 / 3;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    /* A faint checkerboard: letterboxing and transparency both read as the frame. */
    background:
      repeating-conic-gradient(var(--chip) 0 25%, transparent 0 50%) 0 0 / 16px 16px,
      var(--bg);
    cursor: pointer;
  }
  @media (hover: hover) {
    .thumb:hover {
      border-color: var(--border-strong);
    }
  }
  .thumb.lifted {
    opacity: 0.4;
  }
  .thumb img,
  .thumb video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }
  .unused .thumb {
    opacity: 0.55;
  }
  .badge {
    position: absolute;
    right: 6px;
    bottom: 6px;
    display: flex;
    padding: var(--gap-2);
    border-radius: var(--radius-pill);
    background: var(--scrim);
    font-size: var(--icon-md);
    color: var(--color2);
  }
  .audio {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 0 10px;
    color: var(--theme2);
  }
  .name {
    max-width: 100%;
    font-size: var(--fs-micro);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gap-1);
    margin-top: var(--sp-2);
    font-size: var(--fs-micro);
    color: var(--muted);
  }
  .state {
    font-style: italic;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--gap-4);
    padding: var(--sp-4) var(--sp-5);
    border-top: 1px solid var(--border);
  }
  .warn {
    font-size: var(--fs-xs);
    color: var(--muted);
    margin-right: auto;
  }
  .ghost-tile {
    position: fixed;
    z-index: var(--z-tooltip);
    width: 72px;
    height: 54px;
    display: flex;
    align-items: center;
    justify-content: center;
    transform: translate(-50%, -50%);
    border-radius: var(--radius);
    background: var(--bg3);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    pointer-events: none;
    color: var(--theme2);
  }
  .ghost-tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
