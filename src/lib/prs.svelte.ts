import { t } from "./i18n";
import { store } from "./store.svelte";
import type { Note } from "./types";
import { repoRefs, type RepoRef } from "./wikilinks";
import { authed, issue, invalidate, prKey, retryAt, type IssueRef } from "./github";
import { isMobile } from "./backend";

/** A referenced item and the notes that mention it. */
export interface Linked extends RepoRef {
  key: string;
  notes: { id: string; title: string }[];
}

/** Issue and PR details keyed `prKey(repo, n)`; `null` = not found, never retried. */
export const prCache = $state({
  details: {} as Record<string, IssueRef | null>,
  errors: {} as Record<string, string>,
  /** What `details` held before the last refresh, so rows keep their place while it reloads. */
  stale: {} as Record<string, IssueRef | null>,
  /** Whether a fetch is in flight. */
  pending: false,
});

/** Per note, its refs; rescanned only when its text or the repo aliases change. */
const noteRefs = new Map<string, { title: string; body: string; repos: string; refs: RepoRef[] }>();

function refsOf(n: Note, repos: string): RepoRef[] {
  const c = noteRefs.get(n.id);
  if (c && c.title === n.title && c.body === n.body && c.repos === repos) return c.refs;
  const refs = repoRefs(`${n.title}\n${n.body}`);
  if (noteRefs.size > store.notes.length * 2) noteRefs.clear();
  noteRefs.set(n.id, { title: n.title, body: n.body, repos, refs });
  return refs;
}

let lastRefs: Linked[] = [];
let lastKey = "";

const refs = $derived.by((): Linked[] => {
  const repos = JSON.stringify(store.repos);
  const by = new Map<string, Linked>();
  for (const n of store.notes) {
    for (const r of refsOf(n, repos)) {
      const key = prKey(r.repo, r.number);
      let l = by.get(key);
      if (!l) by.set(key, (l = { ...r, key, notes: [] }));
      if (!l.notes.some((x) => x.id === n.id)) l.notes.push({ id: n.id, title: n.title });
    }
  }
  // Typing rarely changes the refs; an equal result keeps the sidebar and fetch effect still.
  const out = [...by.values()];
  const key = JSON.stringify(out);
  if (key === lastKey) return lastRefs;
  lastKey = key;
  return (lastRefs = out);
});

export function linkedRefs(): Linked[] {
  return refs;
}

const inflight = new Set<string>();
/** Loads the user is waiting on (not background refreshes), for the spinner. */
let loud = 0;

/** Fetches `batch` into the cache; `quiet` keeps what's shown on failure and only writes what changed. */
async function load(batch: Linked[], quiet = false): Promise<{ failed: boolean; retry: number | null }> {
  for (const l of batch) inflight.add(l.key);
  if (!quiet) loud++;
  prCache.pending = loud > 0;
  const results = await Promise.allSettled(batch.map((l) => issue(l.repo, l.number)));
  const d = { ...prCache.details };
  const e = { ...prCache.errors };
  let changed = false;
  let failed = false;
  let retry = 0;
  for (const [i, r] of results.entries()) {
    const key = batch[i].key;
    inflight.delete(key);
    if (r.status === "fulfilled") {
      if (!quiet || key in e || JSON.stringify(d[key]) !== JSON.stringify(r.value)) {
        d[key] = r.value;
        delete e[key];
        changed = true;
      }
      continue;
    }
    failed = true;
    retry = Math.max(retry, retryAt(r.reason) ?? 0);
    if (quiet && d[key]) continue;
    e[key] = r.reason instanceof Error ? r.reason.message : String(r.reason);
    changed = true;
  }
  if (changed) {
    prCache.details = d;
    prCache.errors = e;
  }
  if (!quiet) loud--;
  prCache.pending = loud > 0;
  return { failed, retry: retry || null };
}

/** Background refresh period, longer signed out where every request counts against 60 an hour. */
const POLL = 5 * 60_000;
const POLL_ANON = 15 * 60_000;
/** Coming back to the window after this long refreshes straight away. */
const AWAY = 2 * 60_000;
const MAX_WAIT = 60 * 60_000;

let polledAt = Date.now();
let wait = POLL;
let backingOff = false;
let polling = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Hidden, or on the desktop another window in front: no one is looking, so no requests. */
const away = () => (isMobile ? document.hidden : document.hidden || !document.hasFocus());

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => !away() && void poll(), wait);
}

/** Revalidates every loaded ref (ETags make unchanged ones nearly free), backing off on failure. */
async function poll() {
  if (polling) return;
  polling = true;
  polledAt = Date.now();
  const batch = refs.filter((l) => prCache.details[l.key] !== null && !inflight.has(l.key));
  invalidate();
  const { failed, retry } = batch.length ? await load(batch, true) : { failed: false, retry: null };
  const base = authed() ? POLL : POLL_ANON;
  wait = failed ? Math.min(Math.max(wait * 2, base), MAX_WAIT) : base;
  if (retry) wait = Math.max(wait, retry - Date.now());
  backingOff = failed;
  polling = false;
  schedule();
}

function front() {
  if (!away() && Date.now() - polledAt >= (backingOff ? wait : AWAY)) void poll();
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
  $effect(() => {
    schedule();
    window.addEventListener("focus", front);
    document.addEventListener("visibilitychange", front);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", front);
      document.removeEventListener("visibilitychange", front);
    };
  });
}

export function refreshPRs() {
  polledAt = Date.now();
  invalidate();
  prCache.stale = { ...prCache.stale, ...prCache.details };
  prCache.details = {};
  prCache.errors = {};
}

export function stateLabel(r: IssueRef): string {
  if (!r.isPr && r.state === "closed") return t(r.notPlanned ? "prs.state.closed" : "prs.state.done");
  return t(
    r.state === "merged" ? "prs.state.merged" : r.state === "closed" ? "prs.state.closed" : r.draft ? "prs.state.draft" : "prs.state.open",
  );
}
