import { t } from "./i18n";
import { auth } from "./auth.svelte";
import { demo, demoIssues } from "./demo";

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
  /** A closed issue that wasn't completed: not planned, or a duplicate. */
  notPlanned: boolean;
  comments: number;
}

/** The signed-in session's token; null when nobody is signed in. */
export async function token(): Promise<string | null> {
  return auth.token();
}

function send(path: string, tok: string | null) {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  return fetch(`https://api.github.com${path}`, { headers });
}

/** Rate limiting, rather than the repo being missing or out of reach. */
function rateLimited(res: Response) {
  return res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0";
}

/** Repos the token can't reach, learned as we go, so the next read skips straight to anonymous. */
const readAnonymously = new Set<string>();
let scopeOf: string | null = null;

async function scopedToken(repo?: string): Promise<string | null> {
  const tok = await token();
  // A different sign-in reaches different repos; start the memo over.
  if (tok !== scopeOf) {
    scopeOf = tok;
    readAnonymously.clear();
  }
  return repo && readAnonymously.has(repo) ? null : tok;
}

async function api<T>(path: string, repo?: string): Promise<T> {
  const tok = await scopedToken(repo);
  let res = await send(path, tok);
  // An app token 404s on repos it isn't installed on; public data needs no token, so retry without.
  if (tok && !res.ok && (res.status === 404 || (res.status === 403 && !rateLimited(res)))) {
    const anon = await send(path, null);
    if (anon.ok) {
      readAnonymously.add(repo ?? "");
      res = anon;
    } else if (rateLimited(anon)) res = anon;
  }
  if (!res.ok) {
    if (rateLimited(res)) throw new Error(t("github.rateLimit"));
    if (res.status === 401) throw new Error(t("github.tokenRejected"));
    if (res.status === 404) throw new Error(t("github.notFound"));
    throw new Error(t("github.status", { status: res.status }));
  }
  return res.json() as Promise<T>;
}

/** A repository the signed-in user reached through the app's installations. */
export interface RepoRef {
  full_name: string;
  clone_url: string;
  private: boolean;
}

/** Every page of `path`, following GitHub's `per_page` cap. */
async function pages<T>(path: string, pick: (body: never) => T[]): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 10; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const batch = pick((await api(`${path}${sep}per_page=100&page=${page}`)) as never);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/** The repositories the app can reach, alphabetically; the one place worth a full listing. */
export async function listRepos(): Promise<RepoRef[]> {
  const installs = await pages<{ id: number }>("/user/installations", (b: { installations: { id: number }[] }) => b.installations);
  const repos: RepoRef[] = [];
  for (const i of installs) {
    repos.push(...(await pages<RepoRef>(`/user/installations/${i.id}/repositories`, (b: { repositories: RepoRef[] }) => b.repositories)));
  }
  const seen = new Set<string>();
  return repos
    .filter((r) => !seen.has(r.full_name) && seen.add(r.full_name))
    .sort((a, b) => a.full_name.toLowerCase().localeCompare(b.full_name.toLowerCase()));
}

interface RawIssue {
  number: number;
  title: string;
  state: string;
  state_reason?: string | null;
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
    notPlanned: !isPr && state === "closed" && !!r.state_reason && r.state_reason !== "completed",
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

/** One issue/PR by number, from the recent list or fetched on its own; null when missing. */
export async function issue(repo: string, number: number): Promise<IssueRef | null> {
  const recent = await recentIssues(repo);
  const hit = recent.find((r) => r.number === number);
  if (hit) return hit;
  const one = await cached(`issue ${repo} ${number}`, () =>
    api<RawIssue>(`/repos/${repo}/issues/${number}`, repo)
      .then((r) => [toRef(r)])
      .catch((e: Error) => (/not found/i.test(e.message) ? [] : Promise.reject(e))),
  );
  return one[0] ?? null;
}

/** The 100 most recently updated issues + PRs of a repo (one request, cached). */
export function recentIssues(repo: string): Promise<IssueRef[]> {
  if (demo) return Promise.resolve(Object.values(demoIssues));
  return cached(`recent ${repo}`, async () =>
    (await api<RawIssue[]>(`/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=100`, repo)).map(toRef),
  );
}

function matches(ref: IssueRef, q: string): boolean {
  const ql = q.toLowerCase();
  return ref.title.toLowerCase().includes(ql) || String(ref.number).startsWith(ql);
}

/** Issues + PRs matching `query`, newest first: a local substring pass plus GitHub's search. */
export async function searchIssues(repo: string, query: string): Promise<IssueRef[]> {
  const q = query.trim();
  const recent = await recentIssues(repo);
  if (!q) return recent.slice(0, 15);
  const local = recent.filter((r) => matches(r, q));
  const extra = await cached(`search ${repo} ${q}`, async () => {
    const jobs: Promise<IssueRef[]>[] = [];
    if (/^\d+$/.test(q))
      jobs.push(
        api<RawIssue>(`/repos/${repo}/issues/${q}`, repo)
          .then((r) => [toRef(r)])
          .catch(() => []),
      );
    jobs.push(
      api<{ items: RawIssue[] }>(
        `/search/issues?q=${encodeURIComponent(`repo:${repo} ${q} in:title`)}&sort=updated&order=desc&per_page=10`,
        repo,
      )
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
