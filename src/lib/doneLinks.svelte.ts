import { store } from "./store.svelte";
import { wikilinkTarget } from "./wikilinks";

/** Action: marks every `[[link]]` to a done note `.done`, kept live without rendering the HTML again. */
export function doneLinks(node: HTMLElement, html: () => string) {
  $effect(() => {
    if (!html().includes("wikilink")) return;
    for (const a of node.querySelectorAll<HTMLAnchorElement>("a.wikilink")) {
      const id = wikilinkTarget(a);
      const n = id && store.byId(id);
      a.classList.toggle("done", !!n && store.isDone(n));
    }
  });
}
