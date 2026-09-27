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
  import { tooltip } from "./tooltip";
  import X from "phosphor-svelte/lib/X";
  import Play from "phosphor-svelte/lib/Play";
  import Trash from "phosphor-svelte/lib/Trash";
  import FolderOpen from "phosphor-svelte/lib/FolderOpen";
  import { t, plural, locale } from "./i18n";

  let { onclose }: { onclose: () => void } = $props();

  let filter = $state<MediaKind | null>(null);
  let query = $state("");
  let viewing = $state<Asset | null>(null);
  /** The asset whose Delete was pressed once; a second press deletes it. */
  let armed = $state<string | null>(null);
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

  function remove(a: Asset) {
    if (armed !== a.name) return void (armed = a.name);
    armed = null;
    void store.deleteAsset(a.name);
  }

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
    const target = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !el.closest(".backdrop"));
    target?.dispatchEvent(new CustomEvent("media-drop", { bubbles: true, detail }));
  }

  function open(a: Asset) {
    if (!dragged) viewing = a;
  }

  function onKey(e: KeyboardEvent) {
    if (!viewing || e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    viewing = null;
  }
</script>

<svelte:window onkeydowncapture={onKey} />

<div class="dialog bare gallery">
  <header>
    <h3>{t("gallery.title")} <span class="count">{store.assets?.length ?? ""}</span></h3>
    {#if !isMobile}
      <span class="pane-tools">
        <DockButton />
        <button class="ghost icon" onclick={onclose} use:tooltip={t("pane.close")} aria-label={t("pane.close")}><X size={15} /></button>
      </span>
    {/if}
  </header>
  <div class="bar">
    {#each kinds as k (k)}
      <button class="ghost chip" class:on={filter === k} onclick={() => (filter = k)}>{t(KIND_LABEL[k ?? "all"])}</button>
    {/each}
    <input type="search" bind:value={query} placeholder={t("gallery.search")} spellcheck="false" />
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
        {#each shown as a (a.name)}
          {@const kind = kindOfAsset(a)}
          {@const refs = refsOf(a)}
          <li class:unused={unused(a)}>
            <button
              class="thumb"
              class:lifted={drag?.moved && drag.asset === a}
              onclick={() => open(a)}
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
                <span class="badge"><Play size={14} weight="fill" /></span>
              {:else}
                <span class="audio"><MediaIcon kind="audio" size={28} /><span class="name">{labelOf(a)}</span></span>
              {/if}
            </button>
            <div class="meta">
              {#each refs as id (id)}
                <button class="ghost link ref" onclick={() => store.jump(id)}
                  ><InlineMd source={store.byId(id)?.title ?? ""} fallback={t("app.untitled")} /></button
                >
              {:else}
                {#if inTrash.has(a.name)}
                  <span class="state">{t("gallery.inTrash")}</span>
                {:else}
                  <span class="state">{t("gallery.unused")}</span>
                  <button class="ghost sm danger" onclick={() => remove(a)} onblur={() => (armed = null)}
                    ><Trash size={12} /> {t(armed === a.name ? "gallery.confirm" : "gallery.delete")}</button
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
        <button
          class="danger sm"
          onclick={() => store.deleteAssets((store.assets ?? []).filter(unused).map((a) => a.name)).then(() => (confirmPurge = false))}
          >{t("gallery.purge.now")}</button
        >
        <button class="ghost sm" onclick={() => (confirmPurge = false)}>{t("trash.cancel")}</button>
      {:else}
        <button class="ghost sm danger" onclick={() => (confirmPurge = true)}>{plural("gallery.purge", unusedCount)}</button>
      {/if}
    </footer>
  {/if}
  {#if viewing}
    {@const kind = kindOfAsset(viewing)}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="viewer" onclick={(e) => e.target === e.currentTarget && (viewing = null)}>
      <div class="stage">
        {#if kind === "image"}
          <img src={url(viewing)} alt={labelOf(viewing)} />
        {:else if kind === "video"}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={url(viewing)} controls autoplay playsinline></video>
        {:else}
          <MediaIcon kind="audio" size={48} />
          <audio src={url(viewing)} controls autoplay></audio>
        {/if}
      </div>
      <div class="caption">
        <span class="label">{labelOf(viewing)}</span>
        <span class="sub">{size(viewing.size)} · {relative(new Date(viewing.modified).toISOString())}</span>
        {#if !isMobile}
          <button
            class="ghost icon"
            onclick={() => viewing && store.revealAsset(viewing.name)}
            use:tooltip={t("panel.reveal")}
            aria-label={t("panel.reveal")}><FolderOpen size={15} /></button
          >
        {/if}
        <button class="ghost icon" onclick={() => (viewing = null)} use:tooltip={t("pane.close")} aria-label={t("pane.close")}
          ><X size={15} /></button
        >
      </div>
    </div>
  {/if}
</div>
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
  .dialog h3 {
    font-size: 15px;
  }
  .count {
    font-weight: 400;
    color: var(--color-dim);
    margin-left: 4px;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 12px 8px;
  }
  .chip {
    font-size: 12px;
    padding: 3px 9px;
    border-radius: 999px;
  }
  .chip.on {
    background: var(--bg3);
    color: var(--color2);
  }
  .bar input {
    flex: 1;
    min-width: 80px;
    margin-left: 6px;
    font-size: 12px;
    padding: 4px 8px;
  }
  :global(body.mobile) .bar {
    flex-wrap: wrap;
  }
  :global(body.mobile) .bar input {
    flex-basis: 100%;
    margin: 4px 0 0;
  }
  .grid-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 12px 12px;
  }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--color-dim);
    font-size: 13px;
  }
  .empty :global(code) {
    font-family: var(--mono);
    font-size: 12px;
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
      repeating-conic-gradient(#ffffff06 0 25%, transparent 0 50%) 0 0 / 16px 16px,
      var(--bg);
    cursor: pointer;
  }
  .thumb:hover {
    border-color: var(--border2);
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
    padding: 4px;
    border-radius: 999px;
    background: #000a;
    color: #fff;
  }
  .audio {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 0 10px;
    color: var(--accent2);
  }
  .name {
    max-width: 100%;
    font-size: 11px;
    color: var(--color-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    margin-top: 5px;
    font-size: 11px;
    color: var(--color-dim);
  }
  .ref {
    max-width: 100%;
    justify-content: flex-start;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    font-style: italic;
  }
  .sm {
    font-size: 11px;
    padding: 1px 6px;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
  }
  footer .sm {
    font-size: 12px;
    padding: 3px 8px;
  }
  .warn {
    font-size: 12px;
    color: var(--color-dim);
    margin-right: auto;
  }
  .viewer {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    background: color-mix(in srgb, var(--bg) 94%, transparent);
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 16px;
    color: var(--accent2);
    pointer-events: none;
  }
  .stage > * {
    pointer-events: auto;
  }
  .stage img,
  .stage video {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 6px;
  }
  .stage audio {
    width: min(100%, 420px);
  }
  .caption {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    font-size: 12px;
  }
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color2);
  }
  .sub {
    margin-right: auto;
    color: var(--color-dim);
    white-space: nowrap;
  }
  .ghost-tile {
    position: fixed;
    z-index: 200;
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
    color: var(--accent2);
  }
  .ghost-tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
