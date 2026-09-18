<script lang="ts">
  import { store } from "./store.svelte";
  import ColorPicker from "./ColorPicker.svelte";

  let { tag, onclose }: { tag: string; onclose: () => void } = $props();
</script>

<ColorPicker value={store.tagColor(tag)} onpick={(c) => store.setTagColor(tag, c)} {onclose} label="tag colour" />
