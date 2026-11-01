import { mount, unmount } from "svelte";
import FileLinkIcon from "./FileLinkIcon.svelte";

/** Action: mounts the file / folder / missing icon into every local file link whenever `html()` changes. */
export function fileLinkIcons(node: HTMLElement, html: () => string) {
  $effect(() => {
    void html();
    const mounted = [...node.querySelectorAll<HTMLElement>("a.filelink[data-path]")].map((a) =>
      mount(FileLinkIcon, { target: a, anchor: a.firstChild ?? undefined, props: { raw: a.dataset.path!, host: a } }),
    );
    return () => {
      for (const m of mounted) void unmount(m);
    };
  });
}
