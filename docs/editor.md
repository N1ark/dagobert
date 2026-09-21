# Note panel and editor

Read this when touching `NotePanel.svelte`, `LiveEditor.svelte`, `blocks.ts`,
`editor.ts`, `wikilinks.ts`, `MentionPopup.svelte`, `Markdown.svelte`, `InlineMd.svelte`
or `highlight.ts`.

## NotePanel.svelte

Right-hand editor, re-keyed per note id in `App.svelte` so local state resets on selection
change. The title field is a raw `<input>`; committing a title runs `renameLinks`. Owns the
`⌫`/`⌦` listener that arms its Delete button (second press deletes). Width is `panelW` in
`App.svelte` (localStorage `dagobert.panelWidth`, dragged via `.resizer`; `--panel-w` on
`.main`).

## LiveEditor.svelte

Obsidian-style live preview, per block. `blocks.ts` splits the body on blank lines (fenced
code and `<<<<<<< `…`>>>>>>> ` conflict regions kept whole; a region belongs to the
paragraph around it so resolving it never adds paragraph breaks; an unterminated
`<<<<<<< ` is ordinary text; blank-line runs collapse on re-join). A block holding a region
renders through `ConflictBlock.svelte` (two stacked `Markdown` panes showing the whole
paragraph as each side wrote it + keep mine / theirs / both, via `resolveConflict` and
`store.touch(id, { label: "resolve conflict" })`); clicking it edits the raw text.
`hasMarkers` (badge, toolbar count) is fence-aware through the same splitter.
`stripMarkers` / `MARKER_RE` keep marker lines out of search and card previews.

Every block renders via `Markdown.svelte` except the `active` one, which is a textarea
holding `draft`. Rules worth knowing:

- The draft is live-synced into `note.body` unless it's empty (an empty block can't be
  represented, so it's dropped only when leaving it — see `moveBy`'s `dropped` offset).
- Typing a blank line splits the draft and moves the caret to the right new block
  (`locate`); a "virtual" block (`active === blocks.length`) exists for appending.
- Backspace at offset 0 merges into the previous block; ↑/↓ on first/last line move
  between blocks; Esc leaves edit mode.
- Clicking a rendered block places the caret near the click via `caretRangeFromPoint` +
  text search; task checkboxes toggle in place (`toggleCheckbox`).

Shortcuts in the body: `⌘B` bold, `⌘I` italic, `⌘E` / `` ⌘` `` code, `⌘K` link, `⌘⇧X`
strike, `⌘H` ==highlight==, Enter continues lists, Tab/⇧Tab indents. They are pure
textarea commands in `editor.ts` (`toggleWrap`, `link`, `continueList`, `indent`,
`command`); test them with a node script (`node --experimental-strip-types`) rather than
in the browser.

## Links and mentions

`wikilinks.ts`: `[[Title]]` links resolve by title, case-insensitive (`resolve`).
`renderWikilinks` is a pre-pass before marked that skips code (resolved →
`<a class="wikilink" href="#note-<id>">`, missing → `.wikilink.missing`);
`wikilinkTarget` for click handling; `mentions` (backlinks); `renameLinks` rewrites bodies
when a title is committed; `caretCoords` measures the caret via a mirror div for the `@`
popup. Clicks go through `store.jump`, which App overrides to also centre the canvas.

`MentionPopup.svelte` is the `@` autocomplete; the parent forwards keys via `handleKey`.
Offers "Create …" when no title matches. `IssuePopup.svelte` (`alias#query`) follows the
same pattern — see [github.md](github.md). `LinkPicker.svelte` is the search dropdown for
adding deps/dependents.

## Rendering

- `Markdown.svelte` renders a block with marked + DOMPurify; `InlineMd.svelte` renders a
  title as inline markdown (`marked.parseInline` + DOMPurify) wherever a title is
  displayed (card, dep lists, picker, trash). `inline.ts`'s `inlineHtml` is the shared
  renderer (also accepted by `tooltip` as `{ html }`).
- `highlight.ts`: `highlight.js/lib/core` with a hand-picked language list (import per
  language; add there, plus aliases like `svelte` → `xml`) and `highlightExtension`, the
  marked renderer `Markdown.svelte` installs. Unknown or missing languages fall back to
  escaped plain text. Token colours are `.hljs-*` rules in `app.css` using the tag
  palette. Test: `tests/highlight.test.mjs`.
- `{@html}` is only ever DOMPurify output and carries an eslint-disable comment saying so.

## Templates

`Workflow.template` and `Meta.default_template` (for Todo) are edited in `WorkflowEditor`;
tracking issues have `Meta.tracking_template` (settings → "Tracking issue").
`store.create` fills `body` from `templateFor(workflow)` via `renderTemplate` only when
`init.body` is undefined (clones/pastes pass a body). `isEmpty` treats a body equal to its
template as blank so accidental notes are still discarded; `setWorkflow` swaps in the new
template only when the body is blank by that definition.
