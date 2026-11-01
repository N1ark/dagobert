<script lang="ts">
  // The icon of a local file link (`a.filelink`); `host` takes the state class and the path as its tooltip.
  import { tooltip } from "purr";
  import { File, Folder, Warning } from "purr/glyphs";
  import { fileTargets } from "./fileTargets.svelte";
  import { t } from "./i18n";

  let { raw, host }: { raw: string; host: HTMLElement } = $props();

  const target = $derived(fileTargets.get(raw));
  const missing = $derived(target?.kind === null);
  const dir = $derived(target ? target.kind === "dir" : !/\.\w+$/.test(raw));

  $effect(() => {
    host.classList.toggle("missing", missing);
    const action = tooltip(host, () => (missing ? t("filelink.missingAt", { path: target!.path }) : (target?.path ?? "")));
    return () => action?.destroy?.();
  });
</script>

<span class="filelink-icon" aria-hidden="true">
  {#if missing}<Warning size={13} />{:else if dir}<Folder size={13} />{:else}<File size={13} />{/if}
</span>
