# GitHub integration

Read this when touching `github.ts`, `auth.svelte.ts`, `github.rs`, `gh.rs`, `GitHubCli.svelte`, `secrets.ts`,
`prs.svelte.ts`, `PullRequests.svelte`, `PrIcon.svelte`, `prIcons.svelte.ts`,
`IssuePopup.svelte` or `CloneDialog.svelte`.

## Sign-in

- `auth.svelte.ts` + `github.rs` — the GitHub App **device flow**: the app shows a short
  code, the browser takes the approval, the token comes back. Nothing is typed in and no
  token is made by hand. The device/token endpoints send no CORS headers, so those calls
  run in Rust (`ureq`); `/user` allows CORS and is fetched from the frontend.
  `GitHubSignIn.svelte` is the control (settings → GitHub, and the phone's welcome screen).
- One session authenticates both the REST API and git over HTTPS. `secrets.ts` is the only
  place it is stored (`localStorage` `dagobert.session` today, so a keychain plugin would
  replace that file alone). Every window re-reads it before use, since each holds its own
  copy.
- `auth.token()` refreshes a minute before expiry and collapses concurrent callers onto
  one request; apps with and without expiring tokens both work. Only a dead grant
  (`Refreshed::Rejected`) ends the sign-in, and not when another window already rotated
  the refresh token; an unreachable GitHub keeps it and the next call retries.
- The app's user token only reaches repositories the GitHub App is **installed** on, so a
  notes repo needs that one-time install before it will sync. `listRepos` (the clone
  picker) lists exactly those.
- **GitHub CLI token** (desktop; `GitHubCli.svelte` under the sign-in, app-wide flag
  `dagobert.useGh`, re-read on every `token()` so other windows follow): for orgs that
  block the app. `auth.token()` then returns `gh auth token` first and the sign-in's
  `appToken()` when gh has none, for the REST API **and** git (sync, quit, clone);
  `listRepos` stays on `appToken()`, since installations need an app token. `gh.rs` finds
  `gh` without the shell's PATH (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, PATH,
  then `$SHELL -lc 'command -v gh'`) and answers `gh-missing` / `gh-signed-out`; the
  command is a stub on mobile. The token lives only in `Auth`'s memory (never stored,
  logged or put in a URL); a failure isn't retried for a minute. A 401 with it
  (`auth.rejected`) asks `gh` again once; the same token again counts as refused and the
  sign-in takes over. `auth.gh` (`checkGh()`, run on toggle and when the page opens)
  shows the CLI's login from `/user`, or why it can't be used.
- The session's name / email (`/user`, falling back to the `users.noreply` address for
  private emails) is the commit identity written into a clone; desktop commits use the
  repository's git config.

## REST client (`github.ts`)

- `api()` sends the token when signed in. A token that gets 404 / non-rate-limit 403 on a
  repo (app not installed there) retries anonymously and remembers the repo in
  `readAnonymously` (reset when the token changes), so public repos work without the
  install.
- `send()` keeps the last body and ETag per request (200 at most, search excluded, reset with
  the token) and revalidates with `If-None-Match`: a 304 is served from memory and, signed
  in, doesn't count against the rate limit. `ApiError.retryAt` (`retryAt(e)`) carries
  `retry-after` / `x-ratelimit-reset`; 429 and secondary limits count as rate limited.
- `cached()`: 5 min TTL per key, concurrent callers share one request; `invalidate()`
  backs the refresh button. `recentIssues` is a repo's 100 most recently updated issues +
  PRs in one request; `issue(repo, n)` serves from it, else one request per number (a 404
  status means `null`); `searchIssues` merges a local pass over that list with GitHub's
  search.

## References

- Repo aliases live in `Meta.repos` (`store.repos`, `setRepo`); `renderRepoRefs` in
  `wikilinks.ts` auto-links `alias#123` at render time (class `.ghref`, `data-ref` =
  `prKey(repo, n)`), so the raw markdown stays plain. `repoRefs(md)` lists those refs.
- `IssuePopup.svelte` is the `alias#query` picker in `LiveEditor` (same `handleKey`
  pattern as mentions).
- `prs.svelte.ts` — `prCache` (module-level `$state`: `details` keyed `prKey`, where
  `null` = not found and never retried; `errors` per key; `stale`; `pending`),
  `linkedRefs()` (every ref across notes), `syncPRs()` (the fetch effect, started once in
  `App.svelte` so the cache fills whether or not the pane is open; batched and, in the
  first seconds after launch, deferred to an idle callback) and `refreshPRs()`, which moves
  `details` into `stale` so sidebar rows keep their place and old title/author while the
  state reloads.
- `syncPRs()` also polls: every `POLL` (5 min; 15 signed out, where 304s still count) it
  `invalidate()`s and reloads every ref quietly (`load(batch, true)`: no spinner, a failure
  keeps the shown state, only changed keys are written, so icons update in place). Failures
  double the wait up to an hour, and a rate limit waits for its reset. Nothing goes out
  while the window is `away()` (hidden; on the desktop, also unfocused): the timer skips,
  and coming back after `AWAY` (2 min) polls at once. Each window polls for itself, so with
  several open only the focused one does.
- `PrIcon.svelte` — shared state icon (PR open/draft/closed/merged, issue open/done/closed,
  closed = `state_reason` not "completed"): pass `item` or a cache `key`. A `key` not in
  `details` shows the grey `GitPullRequestUnknown` (unless `prCache.stale` says it wasn't
  found). Inline, the `prIcons` action (on `Markdown` and `InlineMd`) `mount()`s one into
  every `a.ghref` after render.
- `PullRequests.svelte` — left sidebar (toolbar "PRs", `⇧⌘P`, localStorage
  `dagobert.prs`) listing every PR referenced as `alias#123`: state icon, title (opens
  GitHub), author, updated, comment count and chips for the notes mentioning it (click =
  jump). Grouped per repo with a divider; plain issues are cached (for their icons) but
  not listed. Refs that failed to load follow under their repo, one row per error.
  "Hide closed/merged" persists in `dagobert.prsHideClosed`; the hidden count is a button
  that shows them. Width is `--prs-w` (`prsW` in `App.svelte`, localStorage
  `dagobert.prsWidth`, dragged via `.resizer.left`); toggling or resizing calls
  `absorb(dx)` so the graph doesn't move (see [canvas.md](canvas.md)).
