<script lang="ts">
  import { Image, FilmStrip, Waveform } from "purr/icons";
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
