import { mount, unmount } from "svelte";
import PrIcon from "./PrIcon.svelte";

/** Action: mounts a live PR state icon into every `alias#123` anchor whenever `html()` changes. */
export function prIcons(node: HTMLElement, html: () => string) {
  $effect(() => {
    void html();
    const mounted = [...node.querySelectorAll<HTMLAnchorElement>("a.ghref[data-ref]")].map((a) =>
      mount(PrIcon, { target: a, anchor: a.firstChild ?? undefined, props: { key: a.dataset.ref!, detail: true } }),
    );
    return () => {
      for (const m of mounted) void unmount(m);
    };
  });
}
