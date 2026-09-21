# GitHub integration

Read this when touching `github.ts`, `prs.svelte.ts`, `PullRequests.svelte`,
`PrIcon.svelte`, `prIcons.svelte.ts` or `IssuePopup.svelte`.

- `github.ts` — REST client (`searchIssues`, 60 s cache; token from localStorage
  `dagobert.githubToken` or `gh auth token` via the `github_cli_token` command).
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
- `PrIcon.svelte` — shared state icon (PR open/draft/closed/merged, issue open/closed):
  pass `item` or a cache `key`. A `key` not in `details` shows a grey question mark (unless
  `prCache.stale` says it's a plain issue). Inline, the `prIcons` action (on `Markdown` and
  `InlineMd`) `mount()`s one into every `.ghref` after render.
- `PullRequests.svelte` — left sidebar (toolbar "PRs", `⇧⌘P`, localStorage
  `dagobert.prs`) listing every PR referenced as `alias#123`: state icon, title (opens
  GitHub), author, updated, comment count and chips for the notes mentioning it (click =
  jump). Grouped per repo with a divider; plain issues are dropped. "Hide closed/merged"
  persists in `dagobert.prsHideClosed`. Width is `--prs-w` (`prsW` in `App.svelte`,
  localStorage `dagobert.prsWidth`, dragged via `.resizer.left`); toggling or resizing calls
  `absorb(dx)` so the graph doesn't move (see [canvas.md](canvas.md)). Overflowing titles
  use `tooltip` with a per-hover function.
