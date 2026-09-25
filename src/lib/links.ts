import { openUrl } from "@tauri-apps/plugin-opener";
import { wikilinkTarget } from "./wikilinks";
import { store } from "./store.svelte";

/** Clicks in rendered markdown: wikilinks jump to their note, web links open in the browser. */
export function onLinkClick(e: MouseEvent, stopPropagation = false) {
  const target = e.target as HTMLElement;
  const id = wikilinkTarget(target);
  const a = id ? null : target.closest("a");
  if (!id && !a) return;
  e.preventDefault();
  if (stopPropagation) e.stopPropagation();
  if (id) {
    store.jump(id);
    return;
  }
  const href = a!.getAttribute("href");
  if (href && /^(https?:|mailto:)/.test(href)) openUrl(href).catch(console.error);
}
