# Note panel and editor

Read this when touching `NotePanel.svelte`, `LiveEditor.svelte`, `live*.ts`, `LiveBlock.svelte`, `blocks.ts`,
`editor.ts`, `wikilinks.ts`, `links.ts`, `filelinks.ts`, `MentionPopup.svelte`, `Markdown.svelte`,
`InlineMd.svelte`, `inlineIcons.ts`, `icons.svelte.ts`, `IconPopup.svelte` or `highlight.ts`.

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

Typora/Obsidian-style live preview on one CodeMirror 6 view whose doc is `note.body`, verbatim:
no blocks, no textarea, so clicks land where they're aimed and selection, copy and arrows work
across paragraphs natively. The pieces:

- `liveCore.ts`: the contract. `revealed(state, from, to)` is the one reveal rule (focused, and a
  selection range touches the element), so an unfocused editor reads as fully rendered.
  `editLabel` carries a store undo label on a transaction; `external` marks a body brought in from
  elsewhere; `replaceRange`, `diff`, `placeCaret` (keeps a clicked line under the pointer).
- `liveSyntax.ts` `liveMarkdown()`: lezer markdown + GFM, minus what marked doesn't render, plus
  `==highlight==`, `[[wikilinks]]`, `:icon:` and `alias#123` parsers (pure; whether an icon or
  alias is real is decided when drawing).
- `livePreview.ts` `livePreview()`: inline decorations over the visible ranges. Markers hide per
  element (`**`, `` ` ``, `[`/`](url)`, `[[`, escapes), per line for headings, quotes, rules and
  list markers. Real `strong`/`em`/`code`/`mark` tags and class `md` on `.cm-content` let purr's
  markdown.css style it. Bullets by CSS, a hanging indent from `--md-indent`, task `[ ]` → a
  checkbox (toggles with label `check`, caret stays), `:icon:` → the icon, a lone blank line between
  blocks shrinks to the paragraph gap. A plain click on an unrevealed link follows it (`links.ts`
  semantics); ⌥-click or the keyboard edits it. Reveals wait for the mouse-up, so a drag doesn't
  shift text. `liveWatch.svelte.ts` redraws when link targets, done-ness, repos or file targets change.
- `liveBlocks.ts` `liveBlocks(host)`: a StateField of block widgets (`LiveBlock.svelte`, mounting
  `Markdown`/`ConflictBlock`) for fenced and indented code, tables, HTML blocks, conflict regions
  (`conflictSpans`, only scanned when a line starts `<<<<<<< `), image-only paragraphs and gallery
  runs of them (`galleryGroups`). Revealed, a block shows its source (code in a code box at the
  rendered line height); a click on a widget reveals it with the caret near the click (`rawOffset`
  against its source). ↑/↓ step one doc line and stop on a widget's edge, which reveals it. Images
  inside text are inline widgets. Widgets compare by source, so typing elsewhere never remounts them.
  A conflict widget is `ConflictBlock.svelte`: the region's paragraph as each side wrote it, keep
  mine / theirs / both (`resolveConflict`, label `resolveConflict`). The store's `hasMarkers`
  (→ `conflictIds`) is fence-aware through `splitBlocks`; `MARKER_RE` / `stripMarkers` keep marker
  lines out of search and card previews.
- `LiveEditor.svelte`: mounts the view in `.live` (the scroll container; the editor grows with its
  content), writes the doc to `note.body` with `store.touch` (label from `editLabel`), and applies
  outside changes with `diff()` + `external`, out of CM's history. Keys: popups first, then Esc
  (blurs, keeping the caret's line in place), then the `editor.ts` commands through `applySel`
  (`liveCommands.ts`). `contentAttributes` turn spellcheck/autocorrect off inside code. A press
  below the text puts the caret at the end on a fresh paragraph; blank lines left there are
  trimmed on blur. `scrollTo(pos)` serves the TOC (`toc.ts` headings carry `from`).
- Undo: CM's history while typing; the menu's undo calls it (`editorHistory`, since
  `execCommand("undo")` doesn't reach CM), the store's undo everywhere else.

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
A link to a done note (`store.isDone`) gets `.done`, struck through and muted: `doneLinks.svelte.ts`, an
action on `Markdown` and `InlineMd`, toggles the class in an `$effect` reading each target, so ticking
a note restyles the links to it without rendering any HTML again (`NoteLink` pills do the same).
Clicks in rendered markdown go through `links.ts` `onLinkClick`: wikilinks call
`store.jump` (which App overrides to also centre the canvas), http/mailto links open in
the system browser.

`MentionPopup.svelte` is the `@` autocomplete; the parent forwards keys via `handleKey`.
The editor's popups sit in `.live`'s scrolled coordinates (`below`), not the textarea's block.
Offers "Create …" when no title matches. `IssuePopup.svelte` (`alias#query`) follows the
same pattern. `LinkPicker.svelte` is the search dropdown for adding deps/dependents.

## Inline icons

`:name:` draws an icon like an emoji, `name` being a purr or Phosphor icon in kebab case
(`:rocket:`, `:git-branch:`; `kebab` in `inlineIcons.ts`). It is a marked inline extension
(`iconExtension`, tested; registered once in `icons.svelte.ts`, which `inline.ts` and `Markdown`
import), so it renders in bodies, card previews and every `InlineMd` title, and code spans,
fences and URLs keep it as text. Only a real icon name renders, and not right after a letter or
digit (`10:30:00`, `a:b:`, `foo:bar:` stay text; `\:rocket:` escapes it). The HTML is an
`svg.ico` (1em, on the baseline, `currentColor`), or a blank `span.ico` of the same size until
the shapes chunk is in: the renderer reads that `$state`, so what drew a blank renders again.
The names ship in the main bundle, so the text never shows as `:name:` first. The source keeps
the text, so copying, git and other apps see `:rocket:`. Quick open shows a title with icons
through `InlineMd` rather than its match highlighting.

Typing `:` and two letters or more, not after a word or inside a code span (`typedIcon`, tested),
opens `IconPopup.svelte` in the editor and in the title field: ↑/↓, ↩ or ⇥ inserts `:name:`, Esc
closes it, and a closing `:` or a space leaves the text alone. "Insert icon…" (palette and Note
menu) fires a cancelable `insert-icon` window event that the selected note's editor takes: it
opens `IconPicker` at the caret and inserts there (a space first after a letter), or after the
last paragraph when nothing is being edited; unclaimed, App appends it as a paragraph.

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
  languages, code is escaped plain text. Token colours are purr's `code.css`, which maps
  `.hljs-*` onto its `--code-*` tokens.

## Media

`![alt](assets/<hash>.<ext>)`, relative to the note, so it renders unchanged on GitHub or in
Obsidian; `![alt|300](…)` (also `|300x200`, height ignored) sets the width. `media.ts` holds
the pure parts (`kindOf`, `parseAlt`, `mediaHtml`, `stripMedia`, `assetNames`) and the marked
`image` renderer `Markdown.svelte` installs. An `afterSanitizeAttributes` DOMPurify hook maps
`assets/…` sources to `backend.assetUrl` (the asset protocol; object URLs in the browser mock)
**after** sanitising, whose URI allowlist would drop `asset:`. Pasting files in `LiveEditor`
saves them (`store.addMedia`) and inserts each as its own paragraph at the caret
(`embedChange`, one undo step labelled `media`); typing resumes after them. Card previews
drop embeds and show a kind icon (`MediaIcon`); the search box matches their alt text.

The extension picks the element: `<img>`, `<video controls preload="metadata">` (its `src`
gets `#t=0.001` so WebKit shows the first frame; the DOMPurify hook keeps the fragment) or
`<audio>` spanning the block. Clicks on players never enter edit mode. The asset protocol
sniffs content types and serves range requests, so video seeks without loading the whole
file. Adding a file over 50 MB to a git-tracked project warns (GitHub refuses 100 MB).

Images and videos render inside a `span.media` carrying a `.resize` handle, shown only in
the editor's media widgets (`liveBlocks.ts`) on hover. Dragging it (`onPointerDown`, which stops
propagation; the widget's click ignores `.resize`) sets the width live, clamped to 32 px … the
block's width; on release `setMediaWidth(block, index, width)` (`editor.ts`, tested; code
spans skipped so `index` matches the rendered order) writes `|<width>` into the source, one
undo step labelled `resizeMedia`, through the widget's current range.

Galleries: `galleryGroups` (`media.ts`, tested) groups consecutive image-only paragraphs holding
two images or more (a revealed paragraph breaks a run); `liveBlocks` draws a run as one widget,
`.gallery`, whose `.md` and `<p>` are `display: contents`, so every `.media` is a flex item. Each grows by
its width/height ratio (`--r`, set when the image loads) from a base height (`--gallery-row`,
90 px), which makes justified rows; `max-width` caps a row that can't fill at 2.2× that. The
corner handle on any of its images sets the base height for the whole gallery (`resizeGallery`),
kept on its first image as `|x<height>` (`setMediaHeight`, `galleryHeight`; `parseAlt` reads the
height, which nothing else uses). A second press on any handle resets it (`resetSize`): the
first press's pointer capture keeps a real `dblclick` from arriving.
The gallery is hovered like a block and outlines the image under the pointer; a click between
images edits the nearest one.
Clicking an image opens it full screen in purr's `Lightbox`, with the note's other images a step
away (`viewImage`, the `BlockHost` the editor passes to `liveBlocks`); ⌥-click edits it instead.
`Markdown` tags a project image with `data-asset` (its name in `assets/`). On a Mac, a
right-click on an image (`onImageMenu`) and the viewer's buttons (`MediaActions`, also the
gallery's) save a copy (`export_asset` behind a save dialog), copy it (`images.ts`: redrawn as
PNG, the only image type WebKit's clipboard takes) or reveal it. A phone has no menu of ours:
a long press gets WebKit's own (share, Save to Photos, copy; `-webkit-touch-callout` is turned
back on for images, and `NSPhotoLibraryAddUsageDescription` is in the plist for the save), and
the viewer has a Share button (`navigator.share` with the file, fetched beforehand because
`share` must run straight in the tap).

Getting media in: every route ends in `store.addMedia(items)` (a path → `import_asset`, which
streams it on the Rust side; a `File` → `save_asset`), which links other paths on disk (below) and skips other files. Tauri
swallows HTML5 file drops, so `backend.onFileDrop` uses `onDragDropEvent` (window drag/drop
events in the browser) and App dispatches a bubbling `media-drop` (`MediaDrop`) at the
element under the point: `LiveEditor` inserts before the top-level block under the pointer (after it
past its middle), `Canvas` creates a note there named after the first file. "Insert media…"
(`insert-media`, the dialog plugin; the photo picker on iOS) fires a cancelable window
`insert-media` event that the selected note's editor takes to insert at the caret; unclaimed,
`store.appendBlocks` appends.

## Links to files and folders

A plain markdown link whose destination has no URL scheme, or is `file:`, points at the disk
(`filelinks.ts` `isLocalHref`, tested): `[spec](/Users/me/spec.pdf)`, `[repo](~/code/foo)`,
`[x](file:///…)`, or relative to the note, so `../docs/x.pdf` is `<project>/docs/x.pdf` (as GitHub
reads it). Destinations are percent-decoded; `fileLink` writes `%`, `<`, `>` and `\` encoded and
brackets one holding spaces or parentheses (`[a](</My Docs/a.pdf>)`). `Markdown.svelte`'s `link`
renderer emits `a.filelink[data-path]` (no `href`), and the `fileLinkIcons` action mounts
`FileLinkIcon` in each: file / folder / warning icon, the `missing` class, the full path as tooltip.

`fileTargets.svelte.ts` caches `stat_links` (`files.rs`: resolves `~`, `file://` and relative
paths, then `metadata` + opening it, so an unreadable path counts as missing) per project + raw
destination, batched in a microtask; a mounted `LiveEditor` and window focus re-check every link seen.
On a phone only paths inside the project are reachable. Clicking re-checks and opens it (`open_path`,
the opener plugin from Rust, so no path scope); right-click offers Open / Reveal in Finder / Copy path.

Making one: a dropped file or folder that isn't media is linked where it is rather than imported
(`store.addMedia`, through `link_targets`: `./…` inside `notes/`, `../…` elsewhere in the project,
`~/…` under home, else absolute); "Link a file…" / "Link a folder…" (desktop only) pick with the
dialog plugin and insert like "Insert media…".

## Link previews

`![](https://…)` whose URL has no media extension (`isLinkEmbed`) is a preview card rather than an
image: `Markdown.svelte` adds an `image` renderer that returns `cardHtml(url, previews.get(url))`
(or the image itself when the page turned out to be one, `isImage`), and `false` for anything
else so `mediaExtension` takes it. `previews.svelte.ts` fetches each URL once (`link_preview` in
`preview.rs`: http(s) only, 8 s, read up to the end of `<head>`, at most 2 MB; a stand-in in the
browser), parses it with `parsePreview` (`og:`, then `twitter:`, then `<title>` / `description` /
favicon, tested) and keeps the results in localStorage (`dagobert.previews`, 300 newest). A
fetch starts in a microtask, outside the `$derived` render. Right-clicking a web link in the
editor offers Open / Copy and "Show as preview" (`linkToEmbed`, its text kept as the alt); on a
card, "Show as link" (`embedToLink`: the alt, else the page's title, else `<url>`).

## Templates

`Workflow.template` and `Meta.default_template` (for Todo) are edited in `WorkflowEditor`;
tracking issues have `Meta.tracking_template` (settings → "Tracking issue"), permanent notes
`Meta.note_template` (settings → "Note") and checklists `Meta.checklist_template` (settings →
"Checklist"; `null` until set, read as `CHECKLIST_TEMPLATE`, one empty task item, so Enter
continues the list); `store.templateFor(note)` picks by the note's kind.
`store.create` fills `body` from `templateFor(note)` via `renderTemplate`
(`{{date}}`, `{{title}}`) only when `init.body` is undefined (clones/pastes pass a body).
`isEmpty` treats a body equal to its template as blank (`untouched`: whitespace aside,
`{{date}}` any day, `{{title}}` the title or nothing) so accidental notes are still discarded,
by `store.dropEmpty` on every way of leaving one (`select`, closing the project or window); `setWorkflow` swaps in the new template only when the body is blank by that
definition.
