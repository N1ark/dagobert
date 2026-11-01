<script lang="ts">
  import { noteIcon } from "./noteIcons.svelte";

  /** A note's icon, inline before its title; nothing when it has none. */
  let { name }: { name: string | null | undefined } = $props();

  const Icon = $derived(noteIcon(name));
</script>

{#if Icon}<span class="note-icon"><Icon /></span>{/if}

<style>
  .note-icon {
    display: inline-flex;
    flex: none;
    align-self: center;
    vertical-align: -0.15em;
    margin-right: 0.3em;
    font-size: 1.1em;
  }
</style>
