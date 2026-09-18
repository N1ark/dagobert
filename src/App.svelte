<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "./lib/store.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import NotePanel from "./lib/NotePanel.svelte";
  import TagMenu from "./lib/TagMenu.svelte";
  import TrashDialog from "./lib/TrashDialog.svelte";
  import QuickOpen, { type Action } from "./lib/QuickOpen.svelte";
  import WorkflowEditor from "./lib/WorkflowEditor.svelte";
  import { backend } from "./lib/backend";
  import Plus from "phosphor-svelte/lib/Plus";
  import Tag from "phosphor-svelte/lib/Tag";
  import Trash from "phosphor-svelte/lib/Trash";
  import CornersOut from "phosphor-svelte/lib/CornersOut";
  import TreeStructure from "phosphor-svelte/lib/TreeStructure";
  import Crosshair from "phosphor-svelte/lib/Crosshair";
  import X from "phosphor-svelte/lib/X";

  // `?note=<id>&path=<project>` turns this window into a standalone note view.
  const params = new URLSearchParams(location.search);
  const standaloneId = params.get("note");
  const standalonePath = params.get("path");

  // Focus mode: dim everything outside the selected note's chain.
  const FOCUS_KEY = "dagobert.focus";
  let focus = $state(localStorage.getItem(FOCUS_KEY) !== "0");
  function toggleFocus() {
    focus = !focus;
    localStorage.setItem(FOCUS_KEY, focus ? "1" : "0");
  }

  const PANEL_KEY = "dagobert.panelWidth";
  let panelW = $state(Number(localStorage.getItem(PANEL_KEY)) || 440);
  let resizing = $state<{ startX: number; w: number } | null>(null);

  function onResizeDown(e: PointerEvent) {
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
    return [
      { label: "New note", hint: "⌘N", run: () => canvas?.createAtCenter() },
      { label: "Undo", hint: "⌘Z", run: () => store.undo() },
      { label: "Redo", hint: "⇧⌘Z", run: () => store.redo() },
      { label: "Fit to view", run: () => canvas?.fitAll() },
      { label: "Tidy layout", run: () => canvas?.tidy() },
      { label: "Open trash", run: () => (showTrash = true) },
      { label: "Manage workflows", run: () => ((settingsSection = "workflows"), (showWorkflows = true)) },
      { label: "GitHub repos…", run: () => ((settingsSection = "github"), (showWorkflows = true)) },
      { label: "Open folder…", hint: "⌘O", run: () => store.pickAndOpen() },
      ...(sel ? [{ label: `${store.isDone(sel) ? "Mark as not done" : "Mark as done"}: ${sel.title || "Untitled"}`, run: () => store.setDone(sel.id, !store.isDone(sel)) }] : []),
    ];
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
    if (e.key === "n" && store.path) {
      e.preventDefault();
      canvas?.createAtCenter();
    } else if (e.key === "k" && store.path) {
      e.preventDefault();
      showQuickOpen = !showQuickOpen;
    } else if (e.key === "f" && store.path) {
      e.preventDefault();
      searchEl?.focus();
      searchEl?.select();
    } else if (e.key === "o") {
      e.preventDefault();
      store.pickAndOpen();
    }
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
      <button class="ghost" class:on={focus} onclick={toggleFocus} title="Focus: dim notes outside the selected note's chain"><Crosshair size={15} /> Focus</button>
      <button class="ghost" onclick={() => canvas?.tidy()} title="Auto-layout (selection, or everything)"><TreeStructure size={15} /> Tidy</button>
      <button class="ghost" onclick={() => canvas?.fitAll()} title="Fit all notes in view"><CornersOut size={15} /> Fit</button>
      <button class="primary" onclick={() => canvas?.createAtCenter()} title="New note (⌘N)"><Plus size={15} weight="bold" /> Note</button>
    </div>
    <div class="main" style="--panel-w:{panelW}px">
      <Canvas bind:this={canvas} {matches} {focus} />
      {#if store.selected}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="resizer" class:active={!!resizing} onpointerdown={onResizeDown} onpointermove={onResizeMove} onpointerup={onResizeUp} onpointercancel={onResizeUp}></div>
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
  <QuickOpen actions={paletteActions} onjump={jump} oncreate={createTitled} onclose={() => (showQuickOpen = false)} />
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
  .resizer {
    flex: none;
    width: 5px;
    margin-right: -5px;
    z-index: 5;
    cursor: col-resize;
    transition: background 0.15s;
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
      radial-gradient(ellipse at 20% 0%, #45155166, transparent 60%),
      radial-gradient(ellipse at 80% 100%, #421a4066, transparent 60%),
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
