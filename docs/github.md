# GitHub integration

Read this when touching `github.ts`, `auth.svelte.ts`, `github.rs`, `secrets.ts`,
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
- The session's name / email (`/user`, falling back to the `users.noreply` address for
  private emails) is the commit identity written into a clone; desktop commits use the
  repository's git config.

## REST client (`github.ts`)

- `api()` sends the token when signed in. A token that gets 404 / non-rate-limit 403 on a
  repo (app not installed there) retries anonymously and remembers the repo in
  `readAnonymously` (reset when the token changes), so public repos work without the
  install.
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
