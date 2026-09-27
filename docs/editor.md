# Note panel and editor

Read this when touching `NotePanel.svelte`, `LiveEditor.svelte`, `blocks.ts`,
`editor.ts`, `wikilinks.ts`, `links.ts`, `MentionPopup.svelte`, `Markdown.svelte`,
`InlineMd.svelte` or `highlight.ts`.

## NotePanel.svelte

Right-hand editor, wrapped in `{#key store.selected.id}` in `App.svelte` so local state
resets on selection change. The title field is a raw `<input>`, overlaid by its `InlineMd`
rendering while unfocused and non-empty; committing a title (change or blur) runs
`renameLinks`. Owns the `⌫`/`⌦` window listener (outside text fields) that arms its
Delete button; a second press deletes. With `standalone` it also shows a table of
contents (`toc.ts` `headings`, which records each heading's block index to scroll to).
Width is `panelW` in `App.svelte` (localStorage `dagobert.panelWidth`, dragged via
`.resizer`; `--panel-w` on `.main`).

## LiveEditor.svelte

Obsidian-style live preview, per block. `blocks.ts` splits the body on blank lines (fenced
code and `<<<<<<< `…`>>>>>>> ` conflict regions kept whole; a region belongs to the
paragraph around it so resolving it never adds paragraph breaks; an unterminated
`<<<<<<< ` is ordinary text; blank-line runs collapse on re-join). A block holding a region
renders through `ConflictBlock.svelte` (two stacked `Markdown` panes showing the whole
paragraph as each side wrote it + keep mine / theirs / both, via `resolveConflict`, one
undo step labelled `resolveConflict`); clicking it edits the raw text. The store's
`hasMarkers` (→ `conflictIds`: badge, toolbar count) is fence-aware through the same
splitter. `MARKER_RE` / `stripMarkers` keep marker lines out of search and card previews.

Every block renders via `Markdown.svelte` except the `active` one, which is a textarea
holding `draft`. Rules worth knowing:

- The draft is live-synced into `note.body` unless it's empty (an empty block can't be
  represented, so it's dropped only when leaving it — see `moveBy`'s `dropped` offset).
- Typing a blank line splits the draft and moves the caret to the right new block
  (`locate`); a "virtual" block (`active === blocks.length`) exists for appending.
- A body changed from elsewhere (another window) while a block is active reloads the
  draft, keeping the caret.
- Backspace at offset 0 merges into the previous block; ↑/↓ on first/last line move
  between blocks; Esc leaves edit mode.
- Clicking a rendered block places the caret near the click via `caretRangeFromPoint` +
  text search; task checkboxes toggle in place (`toggleCheckbox`; `Markdown` strips
  marked's `disabled` so the click arrives).

Body shortcuts (bold, italic, code, link, strike, ==highlight== from `keys.ts`; Enter
continues lists, Tab/⇧Tab indents; pasting a URL over a selection makes a link) are pure
`Sel → Sel` functions in `editor.ts` (`command`, `toggleWrap`, `link`, `pasteLink`,
`continueList`, `indent`), tested in `tests/editor.test.mjs` rather than in the browser.

## Links and mentions

`wikilinks.ts`: `[[Title]]` links resolve by title, trimmed and case-insensitive
(`resolve`). `renderWikilinks` is a pre-pass before marked that skips code spans and
fences (resolved → `<a class="wikilink" href="#note-<id>">`, missing →
`<span class="wikilink missing">`) and also turns `alias#123` into `.ghref` links (see
[github.md](github.md)). `mentions` = backlinks; `renameLinks` rewrites bodies when a
title is committed; `caretCoords` measures the caret via a mirror div for the popups.
Clicks in rendered markdown go through `links.ts` `onLinkClick`: wikilinks call
`store.jump` (which App overrides to also centre the canvas), http/mailto links open in
the system browser.

`MentionPopup.svelte` is the `@` autocomplete; the parent forwards keys via `handleKey`.
Offers "Create …" when no title matches. `IssuePopup.svelte` (`alias#query`) follows the
same pattern. `LinkPicker.svelte` is the search dropdown for adding deps/dependents.

## Rendering

- `Markdown.svelte` renders a block with marked + DOMPurify. `InlineMd.svelte` renders a
  single line (`inline.ts` `inlineHtml`: `marked.parseInline` + DOMPurify) wherever a
  title or short string is displayed (card title and preview, panel title, dep lists,
  pickers, trash, TOC, help text); `tooltip` also accepts `inlineHtml` output as
  `{ html }`. Text with no markdown, link or ref characters (`isPlain`) skips marked and
  DOMPurify and renders as a text node, which keeps opening a big project cheap.
- `highlight.ts`: `highlightExtension`, the marked renderer `Markdown.svelte` installs
  once (`<script module>`). `hljs.ts` holds `highlight.js/lib/core` with a hand-picked
  language list (import per language; add there, plus aliases like `svelte` → `xml`) and
  is a separate chunk: `Markdown` loads it (`loadHighlighter`) when its source has a fence
  with a language and re-renders once it's in; until then, and for unknown or missing
  languages, code is escaped plain text. Token colours are `.hljs-*` rules in `app.css` using the tag
  palette.

## Media

`![alt](assets/<hash>.<ext>)`, relative to the note, so it renders unchanged on GitHub or in
Obsidian; `![alt|300](…)` (also `|300x200`, height ignored) sets the width. `media.ts` holds
the pure parts (`kindOf`, `parseAlt`, `mediaHtml`, `stripMedia`, `assetNames`) and the marked
`image` renderer `Markdown.svelte` installs. An `afterSanitizeAttributes` DOMPurify hook maps
`assets/…` sources to `backend.assetUrl` (the asset protocol; object URLs in the browser mock)
**after** sanitising, whose URI allowlist would drop `asset:`. Pasting files in `LiveEditor`
saves them (`store.saveFiles`) and inserts each as its own block at the caret
(`insertBlocks`, one undo step labelled `media`); typing resumes after them. Card previews
drop embeds and show a kind icon (`MediaIcon`); the search box matches their alt text.

## Templates

`Workflow.template` and `Meta.default_template` (for Todo) are edited in `WorkflowEditor`;
tracking issues have `Meta.tracking_template` (settings → "Tracking issue").
`store.create` fills `body` from `templateFor(workflow, tracking)` via `renderTemplate`
(`{{date}}`, `{{title}}`) only when `init.body` is undefined (clones/pastes pass a body).
`isEmpty` treats a body equal to its template as blank so accidental notes are still
discarded; `setWorkflow` swaps in the new template only when the body is blank by that
definition.
