# GitHub integration

Read this when touching `github.ts`, `prs.svelte.ts`, `PullRequests.svelte`,
`PrIcon.svelte`, `prIcons.svelte.ts` or `IssuePopup.svelte`.

- `github.ts` — REST client (`searchIssues`, 60 s cache; the token is the signed-in
  session's, else nothing — reads fall back to anonymous).
- `auth.svelte.ts` + `github.rs` — sign-in through the GitHub App **device flow**: the app
  shows a short code, the browser takes the approval, the token comes back. Nothing is
  typed in and no token is made by hand. The endpoints send no CORS headers, so the calls
  run in Rust (`ureq`); the token is handed to the frontend and never written to disk
  there. One session authenticates both the REST API and git over HTTPS, and supplies the
  commit identity (`/user`, falling back to the `users.noreply` address for private
  emails). `secrets.ts` is the only place it is stored — `localStorage` today, so a
  keychain plugin would replace that file alone. Refresh tokens are handled whether or
  not the app issues expiring ones; `auth.token()` refreshes a minute before expiry and
  collapses concurrent callers onto one request.
- The app's user token only reaches repositories the GitHub App is **installed** on, so a
  notes repo needs that one-time install before it will sync.
  `github.issue(repo, n)` serves each from the cached recent list, else one request per
  number; `invalidate()` backs the refresh button.
- Repo aliases live in `Meta.repos` (`store.repos`, `setRepo`); `renderRepoRefs` in
  `wikilinks.ts` auto-links `alias#123` at render time (class `.ghref`, `data-ref` on each
  anchor), so the raw markdown stays plain. `repoRefs(md)` lists those refs.
- `IssuePopup.svelte` is the `alias#query` picker in `LiveEditor` (same `handleKey`
  pattern as mentions).
- `prs.svelte.ts` — `prCache` (module-level `$state`, keyed `prKey(repo, n)`),
  `linkedRefs()` (every ref across notes), `syncPRs()` (the fetch effect, started once in
  `App.svelte` so the cache fills whether or not the pane is open; batched and, in the
  first seconds after launch, deferred to an idle callback) and `refreshPRs()`, which moves
  `details` into `stale` so sidebar rows keep their place and old title/author while the
  state reloads.
- `PrIcon.svelte` — shared state icon (PR open/draft/closed/merged, issue open/done/closed,
  closed = `state_reason` not "completed"):
  pass `item` or a cache `key`. A `key` not in `details` shows a grey question mark (unless
  `prCache.stale` says it wasn't found). Inline, the `prIcons` action (on `Markdown` and
  `InlineMd`) `mount()`s one into every `.ghref` after render.
- `PullRequests.svelte` — left sidebar (toolbar "PRs", `⇧⌘P`, localStorage
  `dagobert.prs`) listing every PR referenced as `alias#123`: state icon, title (opens
  GitHub), author, updated, comment count and chips for the notes mentioning it (click =
  jump). Grouped per repo with a divider; plain issues are cached (for
  their icons) but not listed. "Hide closed/merged"
  persists in `dagobert.prsHideClosed`. Width is `--prs-w` (`prsW` in `App.svelte`,
  localStorage `dagobert.prsWidth`, dragged via `.resizer.left`); toggling or resizing calls
  `absorb(dx)` so the graph doesn't move (see [canvas.md](canvas.md)). Overflowing titles
  use `tooltip` with a per-hover function.
