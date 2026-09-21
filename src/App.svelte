<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "./lib/store.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import NotePanel from "./lib/NotePanel.svelte";
  import TagMenu from "./lib/TagMenu.svelte";
  import TrashDialog from "./lib/TrashDialog.svelte";
  import QuickOpen, { type Action } from "./lib/QuickOpen.svelte";
  import WorkflowEditor from "./lib/WorkflowEditor.svelte";
  import PullRequests from "./lib/PullRequests.svelte";
  import { syncPRs } from "./lib/prs.svelte";
  import { backend } from "./lib/backend";
  import { setAppMenu, menuSignature } from "./lib/menu";
  import Plus from "phosphor-svelte/lib/Plus";
  import ArrowCounterClockwise from "phosphor-svelte/lib/ArrowCounterClockwise";
  import ArrowClockwise from "phosphor-svelte/lib/ArrowClockwise";
  import TreeStructure from "phosphor-svelte/lib/TreeStructure";
  import Crosshair from "phosphor-svelte/lib/Crosshair";
  import Sparkle from "phosphor-svelte/lib/Sparkle";
  import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";
  import Terminal from "phosphor-svelte/lib/Terminal";
  import FolderOpen from "phosphor-svelte/lib/FolderOpen";
  import GithubLogo from "phosphor-svelte/lib/GithubLogo";
  import GitPullRequest from "phosphor-svelte/lib/GitPullRequest";
  import Kanban from "phosphor-svelte/lib/Kanban";
  import CheckSquare from "phosphor-svelte/lib/CheckSquare";
  import ArrowSquareOut from "phosphor-svelte/lib/ArrowSquareOut";
  import Copy from "phosphor-svelte/lib/Copy";
  import ClipboardText from "phosphor-svelte/lib/ClipboardText";
  import CopySimple from "phosphor-svelte/lib/CopySimple";
  import Trash from "phosphor-svelte/lib/Trash";
  import CornersOut from "phosphor-svelte/lib/CornersOut";
  import X from "phosphor-svelte/lib/X";

  // `?note=<id>&path=<project>` turns this window into a standalone note view.
  const params = new URLSearchParams(location.search);
  const standaloneId = params.get("note");
  const standalonePath = params.get("path");

  syncPRs();

  // Focus mode: dim everything outside the selected note's chain.
  const FOCUS_KEY = "dagobert.focus";
  let focus = $state(localStorage.getItem(FOCUS_KEY) !== "0");
  function toggleFocus() {
    focus = !focus;
    localStorage.setItem(FOCUS_KEY, focus ? "1" : "0");
  }

  // Background grain shader (Grain.svelte); purely cosmetic.
  const GRAIN_KEY = "dagobert.grain";
  let grain = $state(localStorage.getItem(GRAIN_KEY) !== "0");
  function toggleGrain() {
    grain = !grain;
    localStorage.setItem(GRAIN_KEY, grain ? "1" : "0");
  }

  // Left sidebar listing the GitHub PRs referenced across notes.
  const PRS_KEY = "dagobert.prs";
  const PRS_W_KEY = "dagobert.prsWidth";
  let showPRs = $state(localStorage.getItem(PRS_KEY) === "1");
  let prsW = $state(Number(localStorage.getItem(PRS_W_KEY)) || 300);
  /** Shift the viewport as the canvas's left edge moves so the graph stays put on
   *  screen (the pane reads as an overlay). Canvas keeps the background still itself. */
  function absorb(dx: number) {
    if (!store.path || !dx) return;
    store.viewport.x -= dx;
    store.saveViewport();
  }
  function togglePRs() {
    showPRs = !showPRs;
    localStorage.setItem(PRS_KEY, showPRs ? "1" : "0");
    absorb(showPRs ? prsW : -prsW);
  }
  let prsResizing = $state<{ startX: number; w: number } | null>(null);
  function onPrsResizeDown(e: PointerEvent) {
    e.preventDefault(); // otherwise the drag also starts a text selection
    prsResizing = { startX: e.clientX, w: prsW };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPrsResizeMove(e: PointerEvent) {
    if (!prsResizing) return;
    const w = Math.round(Math.max(220, Math.min(window.innerWidth * 0.5, prsResizing.w + (e.clientX - prsResizing.startX))));
    absorb(w - prsW);
    prsW = w;
  }
  function onPrsResizeUp() {
    if (!prsResizing) return;
    prsResizing = null;
    localStorage.setItem(PRS_W_KEY, String(prsW));
  }

  const PANEL_KEY = "dagobert.panelWidth";
  let panelW = $state(Number(localStorage.getItem(PANEL_KEY)) || 440);
  let resizing = $state<{ startX: number; w: number } | null>(null);

  function onResizeDown(e: PointerEvent) {
    e.preventDefault(); // otherwise the drag also starts a text selection
    resizing = { startX: e.clientX, w: panelW };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResizeMove(e: PointerEvent) {
    if (!resizing) return;
    panelW = Math.round(Math.max(320, Math.min(window.innerWidth * 0.8, resizing.w - (e.clientX - resizing.startX))));
  }
  function onResizeUp() {
    if (!resizing) return;
    resizing = null;
    localStorage.setItem(PANEL_KEY, String(panelW));
  }

  let canvas = $state<Canvas | null>(null);
  let query = $state("");
  let searchEl = $state<HTMLInputElement | null>(null);
  let showTrash = $state(false);
  let showQuickOpen = $state(false);
  /** Which pane the palette shows. */
  let paletteMode = $state<"notes" | "commands">("notes");

  /** Run an action at most once per keystroke: the menu accelerator and the
   *  window keydown handler can both fire for the same key. */
  const lastRun = new Map<string, number>();
  function once(id: string, fn: () => void) {
    const now = Date.now();
    if (now - (lastRun.get(id) ?? 0) < 150) return;
    lastRun.set(id, now);
    fn();
  }

  function openPalette(mode: "notes" | "commands") {
    if (showQuickOpen && paletteMode === mode) showQuickOpen = false;
    else {
      paletteMode = mode;
      showQuickOpen = true;
    }
  }
  let showWorkflows = $state(false);
  let settingsSection = $state<"workflows" | "github">("workflows");

  // Notes that pass the search box AND the tag filter; null when neither is active.
  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const tags = store.tagFilter;
    if (!q && !tags.length) return null;
    const terms = q.split(/\s+/).filter(Boolean);
    return new Set(
      store.notes
        .filter((n) => !tags.length || n.tags.some((t) => tags.includes(t)))
        .filter((n) => {
          const hay = `${n.title} ${n.tags.map((t) => "#" + t).join(" ")} ${n.body}`.toLowerCase();
          return terms.every((t) => hay.includes(t));
        })
        .map((n) => n.id),
    );
  });

  const stats = $derived({
    total: store.notes.length,
    done: store.notes.filter((n) => store.isDone(n)).length,
    ready: store.notes.filter((n) => store.isReady(n)).length,
  });

  function jump(id: string) {
    store.select(id);
    canvas?.focusNode(id);
  }
  store.jump = jump;

  /** World coords of the visible canvas centre (for creating notes from the palette). */
  function viewCenter() {
    const r = document.querySelector(".canvas")?.getBoundingClientRect();
    const vp = store.viewport;
    const w = r?.width ?? window.innerWidth;
    const h = r?.height ?? window.innerHeight;
    return { x: (w / 2 - vp.x) / vp.zoom - 110, y: (h / 2 - vp.y) / vp.zoom - 20 };
  }

  function createTitled(title: string) {
    const c = viewCenter();
    const n = store.create(Math.round(c.x), Math.round(c.y), { title });
    jump(n.id);
  }

  const paletteActions = $derived.by((): Action[] => {
    const sel = store.selected;
    const has = !!store.path;
    const a = (id: string, label: string, run: () => void, extra: Partial<Action> = {}): Action => ({
      id,
      label,
      run: () => once(id, run),
      ...extra,
    });
    return [
      a("new-note", "New note", () => canvas?.createAtCenter(), { hint: "⌘N", icon: Plus, symbol: ["plus"], menu: "File", enabled: has }),
      a("open-folder", "Open folder…", () => store.pickAndOpen(), { hint: "⌘O", icon: FolderOpen, symbol: ["folder"], menu: "File" }),
      a("undo", "Undo", () => editUndo("undo"), {
        hint: "⌘Z",
        icon: ArrowCounterClockwise,
        symbol: ["arrow.uturn.backward"],
        menu: "Edit",
        enabled: has,
      }),
      a("redo", "Redo", () => editUndo("redo"), {
        hint: "⇧⌘Z",
        icon: ArrowClockwise,
        symbol: ["arrow.uturn.forward"],
        menu: "Edit",
        enabled: has,
      }),
      a(
        "toggle-done",
        sel ? `${store.isDone(sel) ? "Mark as not done" : "Mark as done"}: ${sel.title || "Untitled"}` : "Toggle done",
        () => {
          const n = store.selected;
          if (n) store.setDone(n.id, !store.isDone(n));
        },
        { icon: CheckSquare, symbol: ["checkmark.square"], menu: "Note", menuLabel: "Toggle done", enabled: !!sel && !sel.tracking },
      ),
      a("open-window", "Open in new window", () => store.selectedId && store.openInWindow(store.selectedId), {
        icon: ArrowSquareOut,
        symbol: ["macwindow.badge.plus", "macwindow"],
        menu: "Note",
        enabled: !!sel,
      }),
      a("reveal", "Reveal in Finder", () => store.selectedId && store.revealInFinder(store.selectedId), {
        icon: FolderOpen,
        symbol: ["folder.badge.questionmark", "folder"],
        menu: "Note",
        enabled: !!sel,
      }),
      a("copy-note", "Copy note", () => store.selectedId && store.copy(store.selectedId), {
        icon: Copy,
        symbol: ["doc.on.doc"],
        menu: "Note",
        enabled: !!sel,
      }),
      a("duplicate", "Duplicate note", () => duplicateSelected(), {
        hint: "⌘D",
        icon: CopySimple,
        symbol: ["plus.square.on.square"],
        menu: "Note",
        enabled: !!sel,
      }),
      a("paste-note", "Paste note", () => pasteNote(), {
        icon: ClipboardText,
        symbol: ["doc.on.clipboard"],
        menu: "Note",
        enabled: has && !!store.clipboard,
      }),
      a("quick-open", "Quick open", () => openPalette("notes"), {
        hint: "⌘K",
        icon: MagnifyingGlass,
        symbol: ["magnifyingglass"],
        menu: "View",
        enabled: has,
      }),
      a("commands", "Command palette", () => openPalette("commands"), {
        hint: "⇧⌘K",
        icon: Terminal,
        symbol: ["terminal", "command"],
        menu: "View",
        enabled: has,
      }),
      a("search", "Search", () => (searchEl?.focus(), searchEl?.select()), {
        hint: "⌘F",
        icon: MagnifyingGlass,
        symbol: ["text.magnifyingglass", "magnifyingglass"],
        menu: "View",
        enabled: has,
      }),
      a("fit", "Fit to view", () => canvas?.fitAll(), {
        icon: CornersOut,
        symbol: ["arrow.up.left.and.arrow.down.right"],
        menu: "View",
        enabled: has,
      }),
      a("tidy", "Tidy layout", () => canvas?.tidy(), {
        icon: TreeStructure,
        symbol: ["rectangle.3.group", "square.grid.2x2"],
        menu: "View",
        enabled: has,
      }),
      a("focus", `${focus ? "Disable" : "Enable"} focus mode`, () => toggleFocus(), {
        icon: Crosshair,
        symbol: ["scope"],
        menu: "View",
        menuLabel: "Toggle focus mode",
        enabled: has,
      }),
      a("grain", `${grain ? "Disable" : "Enable"} background grain`, () => toggleGrain(), {
        icon: Sparkle,
        symbol: ["sparkles"],
        menu: "View",
        menuLabel: "Toggle background grain",
      }),
      a("trash", "Open trash", () => (showTrash = true), { icon: Trash, symbol: ["trash"], menu: "Tools", enabled: has }),
      a("workflows", "Manage workflows", () => ((settingsSection = "workflows"), (showWorkflows = true)), {
        icon: Kanban,
        symbol: ["list.bullet.rectangle", "list.bullet"],
        menu: "Tools",
        enabled: has,
      }),
      a("prs", `${showPRs ? "Hide" : "Show"} pull requests`, () => togglePRs(), {
        hint: "⇧⌘P",
        icon: GitPullRequest,
        symbol: ["arrow.triangle.pull", "arrow.triangle.branch"],
        menu: "View",
        menuLabel: "Toggle pull requests",
        enabled: has,
      }),
      a("github", "GitHub repos…", () => ((settingsSection = "github"), (showWorkflows = true)), {
        icon: GithubLogo,
        symbol: ["link"],
        menu: "Tools",
        enabled: has,
      }),
    ];
  });

  /** Undo/redo from the menu: native inside text fields, ours elsewhere. */
  function editUndo(kind: "undo" | "redo") {
    const el = document.activeElement as HTMLElement | null;
    if (el && el.closest("input, textarea, [contenteditable]")) document.execCommand(kind);
    else if (kind === "undo") store.undo();
    else store.redo();
  }

  function duplicateSelected() {
    if (!store.selectedId) return;
    const n = store.duplicate(store.selectedId);
    if (n) jump(n.id);
  }

  function pasteNote() {
    const c = viewCenter();
    const n = store.paste(Math.round(c.x), Math.round(c.y));
    if (n) jump(n.id);
  }

  // Rebuild the native menu only when what it shows changes (main window only),
  // or when the system appearance flips (icon tint).
  let menuSig = "";
  let appearance = $state(window.matchMedia("(prefers-color-scheme: dark)").matches);
  onMount(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => (appearance = mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  });
  $effect(() => {
    if (standaloneId) return;
    const actions = paletteActions;
    const sig = `${appearance}|${menuSignature(actions)}`;
    if (sig === menuSig) return;
    menuSig = sig;
    setAppMenu(actions).catch((e) => console.error("menu", e));
  });

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === "Enter" && matches?.size) {
      jump([...matches][0]);
    } else if (e.key === "Escape") {
      query = "";
      searchEl?.blur();
    }
  }

  // Keep a standalone window's title in step with the note.
  $effect(() => {
    if (standaloneId && store.selected) backend.setWindowTitle(store.selected.title || "Untitled");
  });

  function onKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || standaloneId) return;
    const k = e.key.toLowerCase();
    const id =
      k === "n"
        ? "new-note"
        : k === "k"
          ? e.shiftKey
            ? "commands"
            : "quick-open"
          : k === "p" && e.shiftKey
            ? "prs"
            : k === "f"
              ? "search"
              : k === "o"
                ? "open-folder"
                : null;
    if (!id) return;
    const action = paletteActions.find((a) => a.id === id);
    if (!action || action.enabled === false) return;
    e.preventDefault();
    action.run();
  }

  onMount(() => {
    const unsub = backend.subscribe((m) => store.applySync(m));
    const unwatch = backend.onProjectChanged((c) => store.applyExternal(c));
    if (standaloneId && standalonePath) {
      store.open(standalonePath).then(() => store.select(standaloneId));
    } else {
      store.restore();
    }
    window.addEventListener("keydown", onKey);
    // Flush pending debounced saves whenever the page may be going away.
    const flush = () => store.flushAll();
    const onHide = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      unsub();
      unwatch();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  });
</script>

{#if standaloneId}
  <div class="standalone">
    {#if store.selected}
      {#key store.selected.id}
        <NotePanel note={store.selected} onjump={(id) => store.select(id)} standalone />
      {/key}
    {:else if store.path}
      <div class="gone">This note no longer exists.</div>
    {/if}
  </div>
{:else if store.path}
  <div class="app">
    <div class="toolbar" data-tauri-drag-region>
      <div class="brand" data-tauri-drag-region>
        <img class="mark" src="/icon.svg" alt="" draggable="false" />
        <span class="logo">Dagobert</span>
        <span class="sep">/</span>
        <button class="ghost project" onclick={() => store.close()} title={store.path}>{store.projectName}</button>
      </div>
      <input
        class="search"
        placeholder="Search notes…  (⌘F · ⌘K to jump)"
        bind:value={query}
        bind:this={searchEl}
        onkeydown={onSearchKey}
      />
      {#if matches}
        <span class="hint">{matches.size} match{matches.size === 1 ? "" : "es"}</span>
      {/if}
      <div class="spacer" data-tauri-drag-region></div>
      <span class="stats" title="ready · done · total">
        <span class="ready">{stats.ready} ready</span> · {stats.done}/{stats.total} done
      </span>
      <TagMenu />
      <button class="ghost" onclick={() => (showTrash = true)} title="Deleted notes"><Trash size={15} /> Trash</button>
      <button class="ghost" class:on={showPRs} onclick={togglePRs} title="Pull requests linked from notes (⇧⌘P)"
        ><GitPullRequest size={15} /> PRs</button
      >
      <button class="ghost" class:on={focus} onclick={toggleFocus} title="Focus: dim notes outside the selected note's chain"
        ><Crosshair size={15} /> Focus</button
      >
      <button class="ghost" onclick={() => canvas?.tidy()} title="Auto-layout (selection, or everything)"
        ><TreeStructure size={15} /> Tidy</button
      >
      <button class="ghost" onclick={() => canvas?.fitAll()} title="Fit all notes in view"><CornersOut size={15} /> Fit</button>
      <button class="primary" onclick={() => canvas?.createAtCenter()} title="New note (⌘N)"><Plus size={15} weight="bold" /> Note</button>
    </div>
    <div class="main" class:resizing={!!resizing || !!prsResizing} style="--panel-w:{panelW}px; --prs-w:{prsW}px">
      {#if showPRs}
        <PullRequests onclose={togglePRs} onjump={jump} />
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="resizer left"
          class:active={!!prsResizing}
          onpointerdown={onPrsResizeDown}
          onpointermove={onPrsResizeMove}
          onpointerup={onPrsResizeUp}
          onpointercancel={onPrsResizeUp}
        ></div>
      {/if}
      <Canvas bind:this={canvas} {matches} {focus} {grain} />
      {#if store.selected}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="resizer"
          class:active={!!resizing}
          onpointerdown={onResizeDown}
          onpointermove={onResizeMove}
          onpointerup={onResizeUp}
          onpointercancel={onResizeUp}
        ></div>
        {#key store.selected.id}
          <NotePanel note={store.selected} onjump={jump} />
        {/key}
      {/if}
    </div>
  </div>
{:else}
  <div class="welcome" data-tauri-drag-region>
    <div class="card">
      <img class="hero" src="/logo.svg" alt="" draggable="false" />
      <h1>Dagobert</h1>
      <p class="tagline">Notes that depend on each other.</p>
      <button class="primary big" onclick={() => store.pickAndOpen()}>Open a folder…</button>
      <p class="hint">Pick any folder. Notes are stored as markdown files inside it.</p>
      {#if store.recent.length}
        <h3>Recent</h3>
        <ul class="recent">
          {#each store.recent as r (r)}
            <li>
              <button class="ghost path" onclick={() => store.open(r)} title={r}>
                <span class="name">{r.split(/[\\/]/).filter(Boolean).pop()}</span>
                <span class="full">{r}</span>
              </button>
              <button class="ghost forget" onclick={() => store.forgetRecent(r)} aria-label="forget"><X size={14} /></button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

{#if showQuickOpen}
  {#key paletteMode}
    <QuickOpen mode={paletteMode} actions={paletteActions} onjump={jump} oncreate={createTitled} onclose={() => (showQuickOpen = false)} />
  {/key}
{/if}

{#if showWorkflows}
  <WorkflowEditor section={settingsSection} onclose={() => (showWorkflows = false)} />
{/if}

{#if showTrash}
  <TrashDialog
    onclose={() => (showTrash = false)}
    onrestored={(id) => {
      showTrash = false;
      jump(id);
    }}
  />
{/if}

{#if store.error}
  <div class="toast">{store.error}</div>
{:else if store.notice}
  <div class="toast notice">{store.notice}</div>
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .toolbar {
    height: var(--toolbar-h);
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px 0 84px; /* room for macOS traffic lights */
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    -webkit-user-select: none;
    user-select: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: 8px;
  }
  .mark {
    width: 18px;
    height: 18px;
    opacity: 0.9;
  }
  .logo {
    font-weight: 700;
    color: var(--color2);
    background: linear-gradient(90deg, var(--accent2), #d98adf);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .sep {
    color: #444;
  }
  .project {
    padding: 2px 6px;
    color: var(--color);
  }
  .search {
    width: 260px;
    font-size: 13px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--bg);
  }
  .hint {
    font-size: 11px;
    color: var(--color-dim);
  }
  .spacer {
    flex: 1;
  }
  .toolbar button.on {
    color: var(--accent2);
  }
  .stats {
    font-size: 12px;
    color: var(--color-dim);
    margin-right: 4px;
  }
  .stats .ready {
    color: var(--accent2);
  }
  .main {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  .main.resizing {
    -webkit-user-select: none;
    user-select: none;
    cursor: col-resize;
  }
  .resizer {
    flex: none;
    width: 5px;
    margin-right: -5px;
    z-index: 5;
    cursor: col-resize;
    transition: background 0.15s;
  }
  .resizer.left {
    margin-right: 0;
    margin-left: -5px;
  }
  .resizer:hover,
  .resizer.active {
    background: var(--accent);
  }
  .standalone {
    height: 100%;
    display: flex;
  }
  .standalone :global(.panel) {
    width: 100%;
    border-left: none;
  }
  .gone {
    margin: auto;
    color: var(--color-dim);
  }

  .welcome {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      radial-gradient(ellipse at 20% 0%, #45155166, transparent 60%), radial-gradient(ellipse at 80% 100%, #421a4066, transparent 60%),
      var(--bg);
  }
  .card {
    width: 380px;
    padding: 32px;
    background: var(--bg2);
    border-radius: 12px;
    box-shadow: var(--shadow-lg);
    text-align: center;
  }
  .hero {
    width: 96px;
    height: 96px;
    margin: -8px auto 12px;
    display: block;
    filter: drop-shadow(0 8px 24px #8a2aa244);
  }
  .card h1 {
    margin: 0;
    font-size: 32px;
    color: var(--color2);
    background: linear-gradient(90deg, var(--accent2), #d98adf);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .tagline {
    margin: 4px 0 24px;
    color: var(--color-dim);
  }
  .big {
    font-size: 15px;
    padding: 8px 20px;
  }
  .card .hint {
    margin: 12px 0 0;
    font-size: 12px;
  }
  .card h3 {
    margin: 28px 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-dim);
    text-align: left;
  }
  .recent {
    list-style: none;
    margin: 0;
    padding: 0;
    text-align: left;
  }
  .recent li {
    display: flex;
    align-items: center;
  }
  .path {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    min-width: 0;
    color: var(--color);
  }
  .path .name {
    color: var(--color2);
  }
  .path .full {
    font-size: 11px;
    color: #555;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
  }
  .forget {
    padding: 2px 8px;
  }

  .toast.notice {
    border-color: var(--border2);
    color: var(--color);
  }
  .toast {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg3);
    border: 1px solid var(--red);
    color: var(--color2);
    padding: 8px 14px;
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    font-size: 13px;
    z-index: 100;
  }
</style>
