<script lang="ts">
  // The media viewer's buttons for the item on show: share on a phone; save, copy, reveal on a Mac.
  import { IconButton } from "purr";
  import { Copy, DownloadSimple, Export, FolderOpen } from "purr/icons";
  import { isMobile } from "./backend";
  import { canShare, copyImage, share, shareable } from "./images";
  import { store } from "./store.svelte";
  import { t } from "./i18n";

  /** `name`: the file in `assets/`, when the item is one of the project's. */
  let { src, name, image }: { src: string; name: string | null; image: boolean } = $props();

  let file = $state<File | null>(null);
  $effect(() => {
    file = null;
    if (!isMobile || !canShare()) return;
    let live = true;
    shareable(src, name ?? (src.split("/").pop() || "image"))
      .then((f) => live && (file = f))
      .catch(console.error);
    return () => (live = false);
  });
</script>

{#if isMobile}
  {#if file}
    {@const f = file}
    <IconButton label={t("media.share")} size="lg" onclick={() => share(f)}><Export /></IconButton>
  {/if}
{:else}
  {#if name}
    <IconButton label={t("media.save")} size="lg" onclick={() => store.exportAsset(name)}><DownloadSimple /></IconButton>
  {/if}
  {#if image}
    <IconButton label={t("media.copy")} size="lg" onclick={() => copyImage(src)}><Copy /></IconButton>
  {/if}
  {#if name}
    <IconButton label={t("panel.reveal")} size="lg" onclick={() => store.revealAsset(name)}><FolderOpen /></IconButton>
  {/if}
{/if}
