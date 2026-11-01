import { SvelteMap } from "svelte/reactivity";
import { toast } from "purr";
import { backend } from "./backend";
import { store } from "./store.svelte";
import { t } from "./i18n";
import type { FileTarget } from "./types";

/** Where each local link of the open project points and whether it's there, checked in batches. */
class FileTargets {
  #known = new SvelteMap<string, FileTarget>();
  #queued = new Set<string>();
  #pending = new Set<string>();

  #key = (raw: string) => `${store.path}\n${raw}`;

  /** The link's target, undefined until first checked (which this starts). */
  get(raw: string): FileTarget | undefined {
    const v = this.#known.get(this.#key(raw));
    if (!v) this.#queue(raw);
    return v;
  }

  #queue(raw: string) {
    if (!store.path || this.#pending.has(this.#key(raw))) return;
    if (!this.#queued.size) queueMicrotask(() => void this.#flush());
    this.#queued.add(raw);
    this.#pending.add(this.#key(raw));
  }

  async #flush(): Promise<void> {
    const path = store.path;
    const raws = [...this.#queued];
    this.#queued.clear();
    if (!path || !raws.length) return;
    try {
      const got = await backend.statLinks(path, raws);
      raws.forEach((r, i) => this.#known.set(`${path}\n${r}`, got[i]));
    } catch (e) {
      console.error(e);
    } finally {
      for (const r of raws) this.#pending.delete(`${path}\n${r}`);
    }
  }

  /** Checks every link seen in this project again (a note shown, the window back in focus). */
  recheck() {
    const prefix = `${store.path}\n`;
    for (const k of this.#known.keys()) if (k.startsWith(prefix)) this.#queue(k.slice(prefix.length));
  }

  /** A fresh check of one link. */
  async check(raw: string): Promise<FileTarget | null> {
    const path = store.path;
    if (!path) return null;
    const [got] = await backend.statLinks(path, [raw]);
    this.#known.set(`${path}\n${raw}`, got);
    return got;
  }

  async open(raw: string) {
    const target = await this.check(raw).catch(() => null);
    if (!target?.kind) return void toast.error(t("filelink.missing"));
    backend.openPath(target.path).catch((e) => toast.error(e));
  }

  async reveal(raw: string) {
    const target = await this.check(raw).catch(() => null);
    if (!target?.kind) return void toast.error(t("filelink.missing"));
    backend.revealPath(target.path).catch((e) => toast.error(e));
  }
}

export const fileTargets = new FileTargets();

if (typeof window !== "undefined") window.addEventListener("focus", () => fileTargets.recheck());
