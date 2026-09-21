import { t } from "./i18n";
import { store } from "./store.svelte";
import { repoRefs, type RepoRef } from "./wikilinks";
import { issue, invalidate, type IssueRef } from "./github";

/** A referenced item and the notes that mention it. */
export interface Linked extends RepoRef {
  key: string;
  notes: { id: string; title: string }[];
}

/** PR details keyed `prKey(repo, n)`; `null` = not a PR, never retried. */
export const prCache = $state({
  details: {} as Record<string, IssueRef | null>,
  errors: {} as Record<string, string>,
  /** Whether a fetch is in flight. */
  pending: false,
});

export function prKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

const refs = $derived.by((): Linked[] => {
  const by = new Map<string, Linked>();
  for (const n of store.notes) {
    for (const r of repoRefs(`${n.title}\n${n.body}`)) {
      const key = prKey(r.repo, r.number);
      let l = by.get(key);
      if (!l) by.set(key, (l = { ...r, key, notes: [] }));
      if (!l.notes.some((x) => x.id === n.id)) l.notes.push({ id: n.id, title: n.title });
    }
  }
  return [...by.values()];
});

export function linkedRefs(): Linked[] {
  return refs;
}

const inflight = new Set<string>();

async function load(batch: Linked[]) {
  for (const l of batch) inflight.add(l.key);
  prCache.pending = true;
  const results = await Promise.allSettled(batch.map((l) => issue(l.repo, l.number)));
  const d = { ...prCache.details };
  const e = { ...prCache.errors };
  results.forEach((r, i) => {
    const key = batch[i].key;
    if (r.status === "fulfilled") {
      d[key] = r.value && r.value.isPr ? r.value : null;
      delete e[key];
    } else e[key] = r.reason instanceof Error ? r.reason.message : String(r.reason);
    inflight.delete(key);
  });
  prCache.details = d;
  prCache.errors = e;
  prCache.pending = inflight.size > 0;
}

const idle = (fn: () => void): number =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 250);
const cancelIdle = (h: number) => (typeof cancelIdleCallback === "function" ? cancelIdleCallback(h) : clearTimeout(h));

/** Keeps `prCache` filled for every ref; call once during component init. */
export function syncPRs() {
  $effect(() => {
    const { details, errors } = prCache;
    const missing = refs.filter((l) => !(l.key in details) && !(l.key in errors) && !inflight.has(l.key));
    if (!missing.length) return;
    // Right after launch, wait for an idle slot so the first paint isn't delayed.
    if (performance.now() > 5000) {
      void load(missing);
      return;
    }
    let cancelled = false;
    const handle = idle(() => !cancelled && void load(missing));
    return () => {
      cancelled = true;
      cancelIdle(handle);
    };
  });
}

export function refreshPRs() {
  invalidate();
  prCache.details = {};
  prCache.errors = {};
}

export function stateLabel(r: IssueRef): string {
  return t(
    r.state === "merged" ? "prs.state.merged" : r.state === "closed" ? "prs.state.closed" : r.draft ? "prs.state.draft" : "prs.state.open",
  );
}
