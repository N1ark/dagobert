import { backend } from "./backend";
import { parsePreview, type LinkPreview } from "./preview";

type Entry = LinkPreview | "loading" | "failed";

const KEY = "dagobert.previews";
/** Previews kept across launches, newest last. */
const KEEP = 300;

function saved(): Record<string, Entry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Entry>;
  } catch {
    return {};
  }
}

/** Link previews by URL, fetched once each and remembered on this machine. */
class Previews {
  #cache = $state<Record<string, Entry>>(saved());

  /** The preview, or null until it's in (asking for it the first time); safe while rendering. */
  get(url: string): LinkPreview | null {
    const e = this.#cache[url];
    if (e === undefined) queueMicrotask(() => void this.#fetch(url));
    return typeof e === "object" ? e : null;
  }

  async #fetch(url: string) {
    if (this.#cache[url] !== undefined) return;
    this.#cache[url] = "loading";
    try {
      const page = await backend.linkPreview(url);
      const p = page.content_type.startsWith("image/")
        ? { url, title: null, description: null, image: null, site: null, icon: null, isImage: true }
        : { ...parsePreview(page.html ?? "", page.url), url };
      this.#cache[url] = p;
      this.#save();
    } catch {
      this.#cache[url] = "failed";
    }
  }

  #save() {
    const kept = Object.entries($state.snapshot(this.#cache)).filter(([, e]) => typeof e === "object");
    try {
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept.slice(-KEEP))));
    } catch {
      // Storage full or off: previews are fetched again next time.
    }
  }
}

export const previews = new Previews();
