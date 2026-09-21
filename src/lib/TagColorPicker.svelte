<script lang="ts">
  import { store } from "./store.svelte";
  import ColorPicker from "./ColorPicker.svelte";
  import { t } from "./i18n";

  let { tag, onclose }: { tag: string; onclose: () => void } = $props();
</script>

<ColorPicker value={store.tagColor(tag)} onpick={(c) => store.setTagColor(tag, c)} {onclose} label={t("tags.colorLabel")} />
