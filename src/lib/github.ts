import { backend } from "./backend";

/** An issue or pull request as shown in the picker. */
export interface IssueRef {
  number: number;
  title: string;
  isPr: boolean;
  state: "open" | "closed" | "merged";
  url: string;
  updated: string;
  author: string;
  draft: boolean;
  comments: number;
}

const TOKEN_KEY = "dagobert.githubToken";

export function storedToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredToken(t: string) {
  try {
    if (t.trim()) localStorage.setItem(TOKEN_KEY, t.trim());
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
  cachedToken = undefined;
}

let cachedToken: string | null | undefined;

/** Personal token from settings, else the gh CLI's; null when neither exists. */
export async function token(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = storedToken() || (await backend.githubCliToken().catch(() => null)) || null;
  return cachedToken;
}

async function api<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const t = await token();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")
      throw new Error("GitHub rate limit hit — add a token in settings.");
    if (res.status === 401) throw new Error("GitHub token rejected.");
    if (res.status === 404) throw new Error("Repo not found (private? add a token).");
    throw new Error(`GitHub ${res.status}`);
  }
  return res.json() as Promise<T>;
}

interface RawIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  updated_at: string;
  user?: { login: string } | null;
  draft?: boolean;
  comments?: number;
  pull_request?: { merged_at: string | null };
}

function toRef(r: RawIssue): IssueRef {
  const isPr = !!r.pull_request;
  const state = isPr && r.pull_request?.merged_at ? "merged" : r.state === "closed" ? "closed" : "open";
  return {
    number: r.number,
    title: r.title,
    isPr,
    state,
    url: r.html_url,
    updated: r.updated_at,
    author: r.user?.login ?? "",
    draft: isPr && !!r.draft,
    comments: r.comments ?? 0,
  };
}

const cache = new Map<string, { at: number; refs: IssueRef[] }>();
/** Requests in flight, so concurrent callers share one fetch instead of each firing their own. */
const inflight = new Map<string, Promise<IssueRef[]>>();
const TTL = 5 * 60_000;

function cached(key: string, fetcher: () => Promise<IssueRef[]>): Promise<IssueRef[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.refs);
  let p = inflight.get(key);
  if (!p) {
    p = fetcher()
      .then((refs) => {
        cache.set(key, { at: Date.now(), refs });
        return refs;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Drop everything cached so the next call hits the network again. */
export function invalidate() {
  cache.clear();
}

/**
 * One issue/PR by number. Served from the repo's recent list when it's there,
 * otherwise fetched (and cached) on its own. Null when it doesn't exist.
 */
export async function issue(repo: string, number: number): Promise<IssueRef | null> {
  const recent = await recentIssues(repo);
  const hit = recent.find((r) => r.number === number);
  if (hit) return hit;
  const one = await cached(`issue ${repo} ${number}`, () =>
    api<RawIssue>(`/repos/${repo}/issues/${number}`)
      .then((r) => [toRef(r)])
      .catch((e: Error) => (/not found/i.test(e.message) ? [] : Promise.reject(e))),
  );
  return one[0] ?? null;
}

/** The 100 most recently updated issues + PRs of a repo (one request, cached). */
export function recentIssues(repo: string): Promise<IssueRef[]> {
  return cached(`recent ${repo}`, async () =>
    (await api<RawIssue[]>(`/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=100`)).map(toRef),
  );
}

function matches(ref: IssueRef, q: string): boolean {
  const ql = q.toLowerCase();
  return ref.title.toLowerCase().includes(ql) || String(ref.number).startsWith(ql);
}

/**
 * Issues + PRs of `repo` matching `query`, newest first. Substring-filters the
 * recent list locally (GitHub's search only matches whole words), and merges in
 * server search results for older items.
 */
export async function searchIssues(repo: string, query: string): Promise<IssueRef[]> {
  const q = query.trim();
  const recent = await recentIssues(repo);
  if (!q) return recent.slice(0, 15);
  const local = recent.filter((r) => matches(r, q));
  const extra = await cached(`search ${repo} ${q}`, async () => {
    const jobs: Promise<IssueRef[]>[] = [];
    if (/^\d+$/.test(q))
      jobs.push(
        api<RawIssue>(`/repos/${repo}/issues/${q}`)
          .then((r) => [toRef(r)])
          .catch(() => []),
      );
    jobs.push(
      api<{ items: RawIssue[] }>(`/search/issues?q=${encodeURIComponent(`repo:${repo} ${q} in:title`)}&sort=updated&order=desc&per_page=10`)
        .then((r) => r.items.map(toRef))
        .catch(() => []),
    );
    return (await Promise.all(jobs)).flat();
  });
  const seen = new Set(local.map((r) => r.number));
  const merged = [...local, ...extra.filter((r) => !seen.has(r.number))];
  merged.sort((a, b) => b.updated.localeCompare(a.updated));
  return merged.slice(0, 15);
}

/** GitHub URL for `alias#number` given the configured repo. */
export function issueUrl(repo: string, number: number): string {
  return `https://github.com/${repo}/issues/${number}`; // GitHub redirects to /pull/ when it's a PR
}
