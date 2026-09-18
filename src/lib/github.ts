import { backend } from "./backend";

/** An issue or pull request as shown in the picker. */
export interface IssueRef {
  number: number;
  title: string;
  isPr: boolean;
  state: "open" | "closed" | "merged";
  url: string;
  updated: string;
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
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") throw new Error("GitHub rate limit hit — add a token in settings.");
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
  pull_request?: { merged_at: string | null };
}

function toRef(r: RawIssue): IssueRef {
  const isPr = !!r.pull_request;
  const state = isPr && r.pull_request?.merged_at ? "merged" : r.state === "closed" ? "closed" : "open";
  return { number: r.number, title: r.title, isPr, state, url: r.html_url, updated: r.updated_at };
}

const cache = new Map<string, { at: number; refs: IssueRef[] }>();
const TTL = 60_000;

/** Issues + PRs of `repo` ("owner/name") matching `query` (recent ones when empty). */
export async function searchIssues(repo: string, query: string): Promise<IssueRef[]> {
  const q = query.trim();
  const key = `${repo} ${q}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.refs;
  let refs: IssueRef[];
  if (/^\d+$/.test(q)) {
    // A bare number: fetch that one directly, plus whatever search finds.
    const [one, rest] = await Promise.all([
      api<RawIssue>(`/repos/${repo}/issues/${q}`).then(toRef).catch(() => null),
      api<{ items: RawIssue[] }>(`/search/issues?q=${encodeURIComponent(`repo:${repo} ${q}`)}&per_page=8`).then((r) => r.items.map(toRef)).catch(() => []),
    ]);
    refs = one ? [one, ...rest.filter((r) => r.number !== one.number)] : rest;
  } else if (!q) {
    refs = (await api<RawIssue[]>(`/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=15`)).map(toRef);
  } else {
    const r = await api<{ items: RawIssue[] }>(`/search/issues?q=${encodeURIComponent(`repo:${repo} ${q} in:title`)}&sort=updated&order=desc&per_page=10`);
    refs = r.items.map(toRef);
  }
  refs.sort((a, b) => b.updated.localeCompare(a.updated));
  cache.set(key, { at: Date.now(), refs });
  return refs;
}

/** GitHub URL for `alias#number` given the configured repo. */
export function issueUrl(repo: string, number: number): string {
  return `https://github.com/${repo}/issues/${number}`; // GitHub redirects to /pull/ when it's a PR
}
