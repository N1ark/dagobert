<script lang="ts">
  import Image from "phosphor-svelte/lib/Image";
  import FilmStrip from "phosphor-svelte/lib/FilmStrip";
  import Waveform from "phosphor-svelte/lib/Waveform";
  import type { MediaKind } from "./media";

  let { kind, size = 12 }: { kind: MediaKind; size?: number } = $props();
</script>

{#if kind === "video"}
  <FilmStrip {size} />
{:else if kind === "audio"}
  <Waveform {size} />
{:else}
  <Image {size} />
{/if}
