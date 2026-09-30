<script lang="ts">
  import { ColorGrid, Popover } from "purr";
  import { normalizeColor, TAG_PALETTE } from "./tags";
  import { store } from "./store.svelte";
  import { t } from "./i18n";

  /** Swatch popover hung off `anchor`. `value` is the current colour; `onpick(null)` means "automatic". */
  let {
    anchor,
    value,
    onpick,
    onclose,
    allowAuto = false,
    label = t("color.label"),
  }: {
    anchor: HTMLElement;
    value: string | null;
    onpick: (color: string | null) => void;
    onclose: () => void;
    allowAuto?: boolean;
    label?: string;
  } = $props();

  function pick(c: string | null) {
    onpick(c);
    onclose();
  }
  /** Swatch this panel session added to the palette, so tuning replaces it rather than piling up entries. */
  let added: string | null = null;

  /** Applied live: WebKit fires both `input` and `change` per selection, so neither can close the popover. */
  function commit(value: string) {
    const c = normalizeColor(value);
    if (!c) return;
    if (added && added !== c) {
      store.removePaletteColor(added);
      added = null;
    }
    const existed = TAG_PALETTE.includes(c) || store.palette.includes(c);
    store.addPaletteColor(c);
    if (!existed) added = c;
    onpick(c);
  }
  function remove(e: MouseEvent, c: string) {
    if (!store.palette.includes(c)) return;
    e.preventDefault();
    store.removePaletteColor(c);
  }
</script>

<Popover {anchor} {onclose} {label} padding="var(--sp-4)">
  <ColorGrid
    colors={[...TAG_PALETTE, ...store.palette]}
    {value}
    onpick={pick}
    {label}
    columns={5}
    auto={allowAuto}
    autoLabel={t("color.auto")}
    custom
    customLabel={t("color.custom")}
    oncustominput={(c) => onpick(c)}
    oncustom={commit}
    onswatchcontextmenu={remove}
    colorTip={(c) => (store.palette.includes(c) ? t("color.remove") : null)}
  />
</Popover>
